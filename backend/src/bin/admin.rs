use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use chrono::{Duration as ChronoDuration, Utc};
use clap::{Parser, Subcommand, ValueEnum};
use diesel::{dsl::exists, pg::PgConnection, prelude::*, select};
use diesel_migrations::MigrationHarness;
use rand::{rngs::OsRng, TryRngCore};
use reqwest::{Client, Method, StatusCode};
use sha2::{Digest, Sha256};
use tokio::task;
use uuid::Uuid;

use papercrate::{
    auth::capability_sets::{ensure_capability_set, owner_capabilities},
    config::{redact_database_url, AppConfig},
    db::{self, PgPool},
    documents::search::ensure_quickwit_index,
    jobs::{enqueue_job, JOB_ANALYZE_DOCUMENT, JOB_DELETE_TENANT},
    migrations::MIGRATIONS,
    models::{
        DocumentAsset, MagicToken, MagicTokenKind, NewUser, NewUserMembership, Tenant,
        TenantStatus, User,
    },
    schema::{document_assets, documents, magic_tokens, tenants, user_memberships, users},
    storage::TenantStorage,
    tenants::{TenantGucGuard, TenantService},
    utils::{text::normalize_identifier, tracing::init_tracing},
    workers::tenants::{build_delete_proof_message, sign_delete_proof, DeleteAction},
};

#[derive(Parser)]
#[command(
    name = "papercrate-admin",
    version,
    about = "Papercrate administration utility"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    CreateUser {
        username: String,
        #[arg(long = "with-token")]
        with_token: bool,
        #[arg(long = "personal-tenant", help = "Create a personal tenant for this user")]
        personal_tenant: bool,
    },
    ListUsers,
    DeleteUser {
        username: String,
    },
    CreateTenant {
        name: String,
        #[arg(long = "storage-root")]
        storage_root: Option<String>,
        #[arg(long = "quickwit-index")]
        quickwit_index: Option<String>,
    },
    DeleteTenant {
        tenant_id: Uuid,
        #[arg(long = "tenant-name")]
        tenant_name: String,
    },
    ResetTenant {
        tenant_id: Uuid,
        #[arg(long = "tenant-name")]
        tenant_name: String,
        #[arg(long = "final-status", value_enum, default_value_t = TenantFinalStatusArg::Active)]
        final_status: TenantFinalStatusArg,
    },
    AddUserToTenant {
        username: String,
        tenant_id: Uuid,
    },
    RemoveUserFromTenant {
        username: String,
        tenant_id: Uuid,
    },
    ReanalyzeDocuments {
        tenant_id: Uuid,
    },
    ListTenants,
    DeleteAssets {
        tenant_id: Uuid,
        #[arg(long = "asset-type")]
        asset_type: Option<String>,
        #[arg(long = "all", help = "Confirm deleting every asset for the tenant")]
        delete_all: bool,
    },
    QuickwitCreate {
        tenant_id: Uuid,
    },
    QuickwitDelete {
        tenant_id: Uuid,
    },
    EnqueueDeleteTenant {
        tenant_id: Uuid,
        #[arg(long = "tenant-name")]
        tenant_name: String,
        #[arg(long = "remove-tenant")]
        remove_tenant: bool,
        #[arg(long = "final-status", value_enum)]
        final_status: Option<TenantFinalStatusArg>,
    },
    MagicToken {
        username: String,
        #[arg(long = "ttl-minutes", default_value_t = 10)]
        ttl_minutes: i64,
        #[arg(
            long = "max-uses",
            value_name = "MAX_USES",
            help = "Maximum number of uses before the token is rejected (default: unlimited)"
        )]
        max_uses: Option<i32>,
        #[arg(long = "kind", value_enum, default_value_t = MagicTokenKindArg::EmailLogin)]
        kind: MagicTokenKindArg,
    },
    MigrateDatabase {
        #[arg(
            long = "database-url",
            value_name = "URL",
            help = "Override the migrations database URL (defaults to MIGRATIONS_DATABASE_URL or DATABASE_URL)"
        )]
        database_url: Option<String>,
    },
}

#[derive(Copy, Clone, Debug, ValueEnum)]
enum MagicTokenKindArg {
    #[value(name = "email_login")]
    EmailLogin,
    #[value(name = "demo_login")]
    DemoLogin,
}

impl From<MagicTokenKindArg> for MagicTokenKind {
    fn from(value: MagicTokenKindArg) -> Self {
        match value {
            MagicTokenKindArg::EmailLogin => MagicTokenKind::EmailLogin,
            MagicTokenKindArg::DemoLogin => MagicTokenKind::DemoLogin,
        }
    }
}

#[derive(Copy, Clone, Debug, ValueEnum)]
enum TenantFinalStatusArg {
    Active,
    Suspended,
}

impl TenantFinalStatusArg {
    fn as_str(&self) -> &'static str {
        match self {
            TenantFinalStatusArg::Active => "active",
            TenantFinalStatusArg::Suspended => "suspended",
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing("info");
    let cli = Cli::parse();
    let config = AppConfig::load_and_log("admin")?;
    let pool = db::init_pool_with_size(&config.database_url, config.database_max_pool_size)?;

    match cli.command {
        Command::CreateUser {
            username,
            with_token,
            personal_tenant,
        } => create_user(&pool, &username, with_token, personal_tenant)?,
        Command::ListUsers => list_users(&pool)?,
        Command::DeleteUser { username } => delete_user(&pool, &username)?,
        Command::CreateTenant {
            name,
            storage_root,
            quickwit_index,
        } => create_tenant(&pool, &name, storage_root, quickwit_index)?,
        Command::DeleteTenant {
            tenant_id,
            tenant_name,
        } => delete_tenant(&config, &pool, tenant_id, &tenant_name)?,
        Command::ResetTenant {
            tenant_id,
            tenant_name,
            final_status,
        } => reset_tenant(&config, &pool, tenant_id, &tenant_name, final_status)?,
        Command::AddUserToTenant {
            username,
            tenant_id,
        } => add_user_to_tenant(&pool, &username, tenant_id)?,
        Command::RemoveUserFromTenant {
            username,
            tenant_id,
        } => remove_user_from_tenant(&pool, &username, tenant_id)?,
        Command::ReanalyzeDocuments { tenant_id } => reanalyze_documents(&pool, tenant_id)?,
        Command::ListTenants => list_tenants(&pool)?,
        Command::DeleteAssets {
            tenant_id,
            asset_type,
            delete_all,
        } => {
            let asset_type = asset_type.as_deref();
            if asset_type.is_none() && !delete_all {
                bail!("refusing to delete all assets without --all confirmation");
            }

            delete_assets_for_tenant(&config, &pool, tenant_id, asset_type).await?
        }
        Command::QuickwitCreate { tenant_id } => {
            quickwit_index(&config, &pool, tenant_id, Method::POST).await?
        }
        Command::QuickwitDelete { tenant_id } => {
            quickwit_index(&config, &pool, tenant_id, Method::DELETE).await?
        }
        Command::EnqueueDeleteTenant {
            tenant_id,
            tenant_name,
            remove_tenant,
            final_status,
        } => {
            let mode = if remove_tenant {
                DeletionMode::HardDelete
            } else {
                DeletionMode::Reset
            };
            enqueue_delete_tenant_job_internal(
                &config,
                &pool,
                tenant_id,
                &tenant_name,
                mode,
                final_status,
            )?
        }
        Command::MagicToken {
            username,
            ttl_minutes,
            max_uses,
            kind,
        } => {
            create_magic_token(&pool, &username, ttl_minutes, max_uses, kind.into())?;
        }
        Command::MigrateDatabase { database_url } => {
            let url = database_url.unwrap_or_else(|| config.migrations_database_url().to_string());
            migrate_database(url).await?;
        }
    }

    Ok(())
}

async fn migrate_database(database_url: String) -> Result<()> {
    let redacted = redact_database_url(&database_url);
    tracing::info!(database_url = %redacted, "running pending migrations");

    let result = task::spawn_blocking(move || -> Result<()> {
        let mut conn =
            PgConnection::establish(&database_url).context("failed to connect to database")?;
        conn.run_pending_migrations(MIGRATIONS)
            .map_err(|err| anyhow!("failed to run migrations: {err}"))?;
        Ok(())
    })
    .await
    .context("migration task panicked")?;

    result?;
    tracing::info!(database_url = %redacted, "migrations completed");
    Ok(())
}

fn create_user(
    pool: &PgPool,
    username: &str,
    with_token: bool,
    personal_tenant: bool,
) -> Result<()> {
    let username = normalize_identifier(
        username,
        100,
        "username must not be empty",
        "username must not exceed 100 characters",
        Some("username may only contain printable characters"),
        |ch| !ch.is_control(),
    )
    .map_err(|err| anyhow!("{:?}", err))?;

    let mut conn = pool.get().context("failed to get database connection")?;
    let user_id = Uuid::new_v4();
    let new_user = NewUser {
        id: user_id,
        username: username.clone(),
    };

    diesel::insert_into(users::table)
        .values(&new_user)
        .execute(&mut conn)
        .map_err(|err| match err {
            diesel::result::Error::DatabaseError(diesel::result::DatabaseErrorKind::UniqueViolation, _) => {
                if with_token {
                    anyhow!("User '{}' already exists. Use the 'magic-token' command to generate a new token for existing users.", username)
                } else {
                    anyhow!("User '{}' already exists.", username)
                }
            }
            _ => anyhow::Error::new(err).context(format!("failed to create user '{}'", username)),
        })?;

    println!("created user '{}' (id: {})", username, new_user.id);
    
    if personal_tenant {
        // Drop connection to allow TenantService to use the pool
        drop(conn); 
        
        // Create personal tenant (same name as user)
        let tenant_service = TenantService::new(pool.clone());
        if let Err(e) = tenant_service.create_tenant(
            &username,
            None,
            None,
            TenantStatus::Active,
            &[user_id],
            Some(user_id), // Default capabilities for owner
        ) {
            eprintln!("Failed to create personal tenant: {:#}", e);
            eprintln!("Rolling back: Deleting user '{}'...", username);
            
            // Manual Rollback: precise deletion of the user we just created
            let mut conn = pool.get().context("failed to recover connection for rollback")?;
             diesel::delete(users::table.filter(users::id.eq(user_id)))
                .execute(&mut conn)
                .context("failed to rollback user creation")?;
                
            bail!("failed to create personal tenant (user creation rolled back)");
        }
        
        println!("created personal tenant '{}'", username);
    }

    if with_token {
        create_magic_token(pool, &username, 24 * 60, None, MagicTokenKind::EmailLogin)?;
    }

    Ok(())
}


fn list_users(pool: &PgPool) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;

    // Perform a LEFT JOIN to fetch users and their tenant memberships in one go.
    // Result: List of (User, Option<String>) where String is the tenant name.
    let data: Vec<(User, Option<String>)> = users::table
        .left_join(user_memberships::table.inner_join(tenants::table))
        .select((users::all_columns, tenants::name.nullable()))
        .order((users::username.asc(), tenants::name.asc()))
        .load(&mut conn)?;

    if data.is_empty() {
        println!("No users found.");
        return Ok(());
    }

    // Since results are ordered by username, we can iterate sequentially to group tenants.
    let mut current_user: Option<&User> = None;
    let mut current_tenants: Vec<String> = Vec::new();

    for (user, tenant_name) in &data {
        if let Some(curr) = current_user {
            if curr.id != user.id {
                // Flush previous user
                print_user_entry(curr, &current_tenants);
                current_tenants.clear();
                current_user = Some(user);
            }
        } else {
            current_user = Some(user);
        }

        if let Some(t_name) = tenant_name {
            current_tenants.push(t_name.clone());
        }
    }

    // Flush last user
    if let Some(curr) = current_user {
        print_user_entry(curr, &current_tenants);
    }

    Ok(())
}

fn print_user_entry(user: &User, tenants: &[String]) {
    if tenants.is_empty() {
        println!("{} ({})", user.username, user.id);
    } else {
        println!("{} ({}) -> {}", user.username, user.id, tenants.join(", "));
    }
}

fn delete_user(pool: &PgPool, username: &str) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;

    let user: User = users::table
        .filter(users::username.eq(username))
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("user '{}' not found", username))?;

    let has_memberships: bool = select(exists(
        user_memberships::table.filter(user_memberships::user_id.eq(user.id)),
    ))
    .get_result(&mut conn)?;
    if has_memberships {
        bail!(
            "user '{}' is still a member of one or more tenants; remove memberships first",
            username
        );
    }

    diesel::delete(users::table.filter(users::id.eq(user.id))).execute(&mut conn)?;

    println!("deleted user '{}'", username);
    Ok(())
}

fn create_tenant(
    pool: &PgPool,
    name: &str,
    storage_root_arg: Option<String>,
    quickwit_index_arg: Option<String>,
) -> Result<()> {
    let service = TenantService::new(pool.clone());
    let tenant = service
        .create_tenant(
            name,
            storage_root_arg.as_deref(),
            quickwit_index_arg.as_deref(),
            TenantStatus::Creating,
            &[],
            None,
        )
        .map_err(|err| anyhow!(format!("{err:?}")))?;

    let storage_root = tenant.storage_root.as_deref().unwrap_or("<none>");
    let quickwit_index = tenant.quickwit_index.as_deref().unwrap_or("<none>");

    println!(
        "created tenant '{}' with id {}, storage_root '{}', quickwit_index '{}', status '{}'",
        tenant.name,
        tenant.id,
        storage_root,
        quickwit_index,
        tenant.status.as_str()
    );
    Ok(())
}

fn create_magic_token(
    pool: &PgPool,
    username: &str,
    ttl_minutes: i64,
    max_uses: Option<i32>,
    kind: MagicTokenKind,
) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;

    let user: User = users::table
        .filter(users::username.eq(username))
        .first(&mut conn)
        .with_context(|| format!("user '{}' not found", username))?;

    let raw_token = generate_random_token();
    let token_hash = hash_token(&raw_token);
    let expires_at = Utc::now() + ChronoDuration::minutes(ttl_minutes);

    let new_token = MagicToken {
        id: Uuid::new_v4(),
        user_id: user.id,
        kind,
        token_hash,
        metadata: serde_json::json!({ "source": "admin-cli" }),
        expires_at: expires_at.naive_utc(),
        max_uses,
        used_count: 0,
        created_at: Utc::now().naive_utc(),
        created_by: None,
        last_used_at: None,
    };

    diesel::insert_into(magic_tokens::table)
        .values(&new_token)
        .execute(&mut conn)?;

    println!(
        "\nMagic token created for '{}' (kind: {}, expires_at: {}, max_uses: {})",
        username,
        kind.as_str(),
        expires_at,
        max_uses.map_or("∞".to_string(), |v| v.to_string())
    );
    println!("Token: {}\n", raw_token);

    Ok(())
}

fn generate_random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .expect("failed to read random bytes");
    hex::encode(bytes)
}

fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn delete_tenant(
    config: &AppConfig,
    pool: &PgPool,
    tenant_id: Uuid,
    tenant_name: &str,
) -> Result<()> {
    enqueue_delete_tenant_job_internal(config, pool, tenant_id, tenant_name, DeletionMode::HardDelete, None)?;
    println!(
        "delete job enqueued; tenant '{}' will be permanently removed",
        tenant_name
    );
    Ok(())
}

fn reset_tenant(
    config: &AppConfig,
    pool: &PgPool,
    tenant_id: Uuid,
    tenant_name: &str,
    final_status: TenantFinalStatusArg,
) -> Result<()> {
    enqueue_delete_tenant_job_internal(
        config,
        pool,
        tenant_id,
        tenant_name,
        DeletionMode::Reset,
        Some(final_status),
    )?;
    println!(
        "reset job enqueued; tenant '{}' will be wiped and set to {}",
        tenant_name,
        final_status.as_str()
    );
    Ok(())
}

enum DeletionMode {
    HardDelete,
    Reset,
}

fn enqueue_delete_tenant_job_internal(
    config: &AppConfig,
    pool: &PgPool,
    tenant_id: Uuid,
    expected_name: &str,
    mode: DeletionMode,
    final_status: Option<TenantFinalStatusArg>,
) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;

    let tenant: Tenant = tenants::table
        .find(tenant_id)
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("tenant '{}' not found", tenant_id))?;

    {
        let guard = TenantGucGuard::new(&mut conn, tenant.id)
            .map_err(|err| anyhow!("failed to set tenant context for {}: {err:?}", tenant.name))?;

        if tenant.name != expected_name {
            bail!(
                "tenant name mismatch: expected '{}', database has '{}'",
                expected_name,
                tenant.name
            );
        }

        diesel::update(tenants::table.find(tenant.id))
            .set(tenants::status.eq(TenantStatus::Deleting))
            .execute(guard.conn)?;

        let nonce = generate_random_token();
        let issued_at = Utc::now();
        let issued_at_str = issued_at.to_rfc3339();
        let action = match mode {
            DeletionMode::HardDelete => DeleteAction::Delete,
            DeletionMode::Reset => DeleteAction::Reset,
        };
        let remove_tenant = matches!(mode, DeletionMode::HardDelete);

        let resolved_final_status = match mode {
            DeletionMode::HardDelete => None,
            DeletionMode::Reset => Some(
                final_status
                    .unwrap_or(TenantFinalStatusArg::Suspended)
                    .as_str(),
            ),
        };

        let message = build_delete_proof_message(
            tenant.id,
            expected_name,
            action,
            &nonce,
            &issued_at_str,
            resolved_final_status,
        );
        let signature =
            sign_delete_proof(&config.jwt_secret, &message).map_err(|err| anyhow!(err))?;

        let mut payload = serde_json::json!({
            "remove_tenant": remove_tenant,
            "tenant_name": tenant.name.clone(),
            "action": action.as_str(),
            "nonce": nonce,
            "issued_at": issued_at_str,
            "signature": signature,
        });
        if let Some(status) = resolved_final_status {
            payload["final_status"] = serde_json::json!(status);
        }

        enqueue_job(guard.conn, tenant.id, JOB_DELETE_TENANT, payload, None)?;
        let status_label = if remove_tenant {
            "deleted"
        } else {
            final_status.map(|s| s.as_str()).unwrap_or("suspended")
        };
        println!(
            "delete-tenant job enqueued for '{}' (remove_tenant={}, final_status={})",
            tenant.name, remove_tenant, status_label
        );
    }

    Ok(())
}


fn add_user_to_tenant(pool: &PgPool, username: &str, tenant_id: Uuid) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;

    let user: User = users::table
        .filter(users::username.eq(username))
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("user '{}' not found", username))?;

    let tenant: Tenant = tenants::table
        .find(tenant_id)
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("tenant '{}' not found", tenant_id))?;

    let guard = TenantGucGuard::new(&mut conn, tenant.id)
        .map_err(|err| anyhow!("failed to set tenant context for {}: {err:?}", tenant.name))?;

    let owner_capability_set_id = ensure_capability_set(guard.conn, tenant.id, owner_capabilities())
        .map_err(|err| anyhow!("failed to ensure owner capability set: {:?}", err))?
        .id;

    let membership = NewUserMembership {
        id: Uuid::new_v4(),
        user_id: user.id,
        tenant_id: tenant.id,
        capability_set_id: Some(owner_capability_set_id),
    };

    diesel::insert_into(user_memberships::table)
        .values(&membership)
        .on_conflict((user_memberships::user_id, user_memberships::tenant_id))
        .do_nothing()
        .execute(guard.conn)?;

    println!("added user '{}' to tenant '{}'", username, tenant.name);
    Ok(())
}

fn remove_user_from_tenant(pool: &PgPool, username: &str, tenant_id: Uuid) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;

    let user: User = users::table
        .filter(users::username.eq(username))
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("user '{}' not found", username))?;

    let tenant: Tenant = tenants::table
        .find(tenant_id)
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("tenant '{}' not found", tenant_id))?;

    let guard = TenantGucGuard::new(&mut conn, tenant.id)
        .map_err(|err| anyhow!("failed to set tenant context for {}: {err:?}", tenant.name))?;

    let removed = diesel::delete(
        user_memberships::table
            .filter(user_memberships::user_id.eq(user.id))
            .filter(user_memberships::tenant_id.eq(tenant.id)),
    )
    .execute(guard.conn)?;

    if removed == 0 {
        println!(
            "user '{}' was not a member of tenant '{}'",
            username, tenant.name
        );
    } else {
        println!("removed user '{}' from tenant '{}'", username, tenant.name);
    }
    Ok(())
}

fn reanalyze_documents(pool: &PgPool, tenant_id: Uuid) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;

    let tenant: Tenant = tenants::table
        .find(tenant_id)
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("tenant '{}' not found", tenant_id))?;

    let targets: Vec<(Uuid, Uuid)> = documents::table
        .filter(documents::tenant_id.eq(tenant.id))
        .filter(documents::deleted_at.is_null())
        .select((documents::id, documents::current_version_id))
        .load(&mut conn)?;

    if targets.is_empty() {
        println!("tenant '{}' has no active documents", tenant.name);
        return Ok(());
    }

    let mut queued = 0usize;
    for (document_id, version_id) in targets {
        enqueue_job(
            &mut conn,
            tenant.id,
            JOB_ANALYZE_DOCUMENT,
            serde_json::json!({
                "document_id": document_id,
                "document_version_id": version_id,
                "force": true,
            }),
            None,
        )
        .map_err(|err| anyhow!("failed to enqueue analyze job: {}", err))?;
        queued += 1;
    }

    println!(
        "queued {} documents for re-analysis in tenant '{}'",
        queued, tenant.name
    );
    Ok(())
}

fn list_tenants(pool: &PgPool) -> Result<()> {
    let mut conn = pool.get().context("failed to get database connection")?;
    let tenants: Vec<Tenant> = tenants::table
        .order(tenants::name.asc())
        .load(&mut conn)
        .context("failed to load tenants")?;

    if tenants.is_empty() {
        println!("No tenants found.");
        return Ok(());
    }

    for tenant in tenants {
        println!("{} {}", tenant.id, tenant.name);
    }

    Ok(())
}

async fn delete_assets_for_tenant(
    config: &AppConfig,
    pool: &PgPool,
    tenant_id: Uuid,
    asset_type: Option<&str>,
) -> Result<()> {
    let storage = papercrate::storage::build_storage(config)?;
    let mut conn = pool.get().context("failed to get database connection")?;

    let tenant: Tenant = tenants::table
        .find(tenant_id)
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("tenant '{}' not found", tenant_id))?;

    let guard = TenantGucGuard::new(&mut conn, tenant.id)
        .map_err(|err| anyhow!("failed to set tenant context for {}: {err:?}", tenant.name))?;

    let result = async {
        let tenant_storage = TenantStorage::new(Arc::clone(&storage), &tenant)
            .with_context(|| format!("missing storage root for tenant {}", tenant.name))?;

        let mut asset_query = document_assets::table
            .filter(document_assets::tenant_id.eq(tenant.id))
            .into_boxed();

        if let Some(asset_type) = asset_type {
            asset_query = asset_query.filter(document_assets::asset_type.eq(asset_type));
        }

        let assets: Vec<DocumentAsset> = asset_query
            .load(guard.conn)
            .with_context(|| format!("failed to load assets for tenant {}", tenant.name))?;

        if assets.is_empty() {
            match asset_type {
                Some(asset_type) => {
                    println!("Tenant {}: no assets of type '{}'", tenant.name, asset_type)
                }
                None => println!("Tenant {}: no assets", tenant.name),
            }
            return Ok(());
        }

        match asset_type {
            Some(asset_type) => println!(
                "Tenant {} ({}): deleting {} '{}' assets…",
                tenant.name,
                tenant.id,
                assets.len(),
                asset_type
            ),
            None => println!(
                "Tenant {} ({}): deleting {} assets…",
                tenant.name,
                tenant.id,
                assets.len()
            ),
        }

        let asset_ids: Vec<Uuid> = assets.iter().map(|asset| asset.id).collect();

        for asset in &assets {
            if let Err(err) = tenant_storage.delete_object(&asset.s3_key).await {
                eprintln!(
                    "Failed to delete object {} (tenant {}): {err}",
                    asset.s3_key, tenant.name
                );
            }
        }

        diesel::delete(
            document_assets::table
                .filter(document_assets::tenant_id.eq(tenant.id))
                .filter(document_assets::id.eq_any(&asset_ids)),
        )
        .execute(guard.conn)
        .with_context(|| format!("failed to remove asset records for tenant {}", tenant.name))?;

        println!("Tenant {}: asset records deleted.", tenant.name);
        Ok(())
    }
    .await;



    result
}

async fn quickwit_index(
    config: &AppConfig,
    pool: &PgPool,
    tenant_id: Uuid,
    method: Method,
) -> Result<()> {
    let endpoint = config
        .quickwit_endpoint
        .as_ref()
        .ok_or_else(|| anyhow!("quickwit endpoint not configured"))?;

    let mut conn = pool.get().context("failed to get database connection")?;
    let tenant: Tenant = tenants::table
        .find(tenant_id)
        .first(&mut conn)
        .optional()?
        .ok_or_else(|| anyhow!("tenant '{}' not found", tenant_id))?;

    let client = Client::new();
    let index_id = format!("documents-{}", tenant.id);
    let base_endpoint = endpoint.trim_end_matches('/');

    match method {
        Method::POST => {
            ensure_quickwit_index(&client, base_endpoint, &index_id)
                .await
                .context("failed to ensure quickwit index")?;

            diesel::update(tenants::table.filter(tenants::id.eq(tenant.id)))
                .set(tenants::quickwit_index.eq(Some(index_id.clone())))
                .execute(&mut conn)
                .context("failed to update tenant quickwit_index")?;

            println!(
                "Tenant '{}' quickwit index set to '{}'.",
                tenant.name, index_id
            );
        }
        Method::DELETE => {
            let response = client
                .delete(format!("{}/api/v1/indexes/{}", base_endpoint, index_id))
                .send()
                .await
                .context("failed to send delete index request")?;

            match response.status() {
                status if status.is_success() || status == StatusCode::NOT_FOUND => {
                    diesel::update(tenants::table.filter(tenants::id.eq(tenant.id)))
                        .set(tenants::quickwit_index.eq::<Option<String>>(None))
                        .execute(&mut conn)
                        .context("failed to clear tenant quickwit_index")?;

                    println!("Tenant '{}' quickwit index cleared.", tenant.name);
                }
                status => {
                    let body = response.text().await.unwrap_or_default();
                    bail!(
                        "quickwit delete index failed with status {}: {}",
                        status,
                        body
                    );
                }
            }
        }
        _ => unreachable!(),
    }

    Ok(())
}
