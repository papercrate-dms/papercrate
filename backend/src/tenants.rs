use diesel::{pg::PgConnection, prelude::*, sql_types::Text};
use serde_json::json;
use uuid::Uuid;

use crate::{
    db::PgPool,
    error::{AppError, AppResult},
    jobs::{enqueue_job, JOB_PROVISION_TENANT},
    models::{NewUserMembership, Tenant, TenantStatus},
    schema::{tenants::dsl, user_memberships},
    utils::text::normalize_identifier,
};

use crate::auth::capability_sets::{ensure_capability_set, owner_capabilities};
use crate::state::PgPooledConnection;

pub struct TenantRepository;

impl TenantRepository {
    pub fn get_by_id(conn: &mut PgConnection, tenant_id: Uuid) -> AppResult<Tenant> {
        dsl::tenants.find(tenant_id).first(conn).map_err(Into::into)
    }

    pub fn get_by_name(conn: &mut PgConnection, name: &str) -> AppResult<Tenant> {
        dsl::tenants
            .filter(dsl::name.eq(name))
            .first(conn)
            .map_err(Into::into)
    }

    pub fn update_name(conn: &mut PgConnection, tenant_id: Uuid, name: &str) -> AppResult<Tenant> {
        diesel::update(dsl::tenants.find(tenant_id))
            .set(dsl::name.eq(name))
            .execute(conn)?;
        Self::get_by_id(conn, tenant_id)
    }
}

#[derive(Clone)]
pub struct TenantService {
    pool: PgPool,
}

impl TenantService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub fn get_by_id(&self, tenant_id: Uuid) -> AppResult<Tenant> {
        let tenant = self.load(|conn| TenantRepository::get_by_id(conn, tenant_id))?;
        Ok(tenant)
    }

    pub fn get_by_name(&self, name: &str) -> AppResult<Tenant> {
        let name_owned = name.to_owned();
        let tenant = self.load(|conn| TenantRepository::get_by_name(conn, &name_owned))?;
        Ok(tenant)
    }

    pub fn create_tenant(
        &self,
        name: &str,
        storage_root: Option<&str>,
        quickwit_index: Option<&str>,
        status: TenantStatus,
        initial_members: &[Uuid],
        created_by: Option<Uuid>,
    ) -> AppResult<Tenant> {
        let mut conn = self.pool.get().map_err(|err| {
            tracing::error!(error = ?err, "database pool error");
            AppError::internal("database pool error")
        })?;
        self.create_tenant_with_conn(
            &mut conn,
            name,
            storage_root,
            quickwit_index,
            status,
            initial_members,
            created_by,
        )
    }

    fn load<F>(&self, loader: F) -> AppResult<Tenant>
    where
        F: FnOnce(&mut PgConnection) -> AppResult<Tenant>,
    {
        let mut conn = self.pool.get().map_err(|err| {
            tracing::error!(error = ?err, "database pool error");
            AppError::internal("database pool error")
        })?;
        let tenant = loader(&mut conn)?;
        Ok(tenant)
    }
    pub fn create_tenant_with_conn(
        &self,
        conn: &mut PgConnection,
        name: &str,
        storage_root: Option<&str>,
        quickwit_index: Option<&str>,
        status: TenantStatus,
        initial_members: &[Uuid],
        created_by: Option<Uuid>,
    ) -> AppResult<Tenant> {
        conn.transaction(|conn| {
            let name = name.trim();
            if name.is_empty() {
                return Err(AppError::bad_request("tenant name must not be empty"));
            }

            let name = normalize_tenant_name(name)?;

            let id = Uuid::new_v4();
            let storage_root = normalize_storage_root(storage_root, id);
            let quickwit_index = normalize_quickwit_index(quickwit_index, id);

            diesel::insert_into(dsl::tenants)
                .values((
                    dsl::id.eq(id),
                    dsl::name.eq(&name),
                    dsl::storage_root.eq(Some(storage_root.clone())),
                    dsl::quickwit_index.eq(Some(quickwit_index.clone())),
                    dsl::config.eq(json!({})),
                    dsl::status.eq(status),
                    dsl::created_by.eq(created_by),
                ))
                .execute(conn)?;

            if status == TenantStatus::Creating {
                let payload = json!({
                    "members": initial_members,
                });

                enqueue_job(conn, id, JOB_PROVISION_TENANT, payload, None).map_err(|err| {
                    tracing::error!(error = ?err, tenant_id = %id, "failed to enqueue tenant provisioning job");
                    AppError::internal("failed to enqueue tenant provisioning job")
                })?;
            } 
            
            if !initial_members.is_empty() {
                // Synchronously add members so they appear in selection lists immediately
                apply_tenant_guc(conn, id)?;

                let owner_cap_set_id = ensure_capability_set(conn, id, owner_capabilities())
                    .map_err(AppError::from)?
                    .id;

                for member_id in initial_members {
                    let membership = NewUserMembership {
                        id: Uuid::new_v4(),
                        user_id: *member_id,
                        tenant_id: id,
                        capability_set_id: Some(owner_cap_set_id),
                    };

                    diesel::insert_into(user_memberships::table)
                        .values(&membership)
                        .on_conflict((user_memberships::user_id, user_memberships::tenant_id))
                        .do_nothing()
                        .execute(conn)?;
                }

                clear_tenant_context(conn)?;
            }

            TenantRepository::get_by_id(conn, id)
        })
    }

    pub fn update_name(&self, tenant_id: Uuid, name: &str) -> AppResult<Tenant> {
        let mut conn = self.pool.get().map_err(|err| {
            tracing::error!(error = ?err, "database pool error");
            AppError::internal("database pool error")
        })?;

        let normalized = normalize_tenant_name(name)?;
        TenantRepository::update_name(&mut conn, tenant_id, &normalized)
    }
}

fn apply_tenant_guc(conn: &mut PgConnection, tenant_id: Uuid) -> AppResult<()> {
    diesel::sql_query("SELECT set_config('papercrate.tenant_id', $1, false)")
        .bind::<Text, _>(tenant_id.to_string())
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

fn apply_user_guc(conn: &mut PgConnection, user_id: Uuid) -> AppResult<()> {
    diesel::sql_query("SELECT set_config('papercrate.user_id', $1, false)")
        .bind::<Text, _>(user_id.to_string())
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

pub fn clear_tenant_context(conn: &mut PgConnection) -> AppResult<()> {
    diesel::sql_query(
        "SELECT \
            set_config('papercrate.tenant_id', '', false), \
            set_config('papercrate.user_id', '', false), \
            set_config('papercrate.user_session_hash', '', false), \
            set_config('papercrate.api_token_prefix', '', false)",
    )
    .execute(conn)
    .map(|_| ())
    .map_err(AppError::from)
}

pub fn clear_user_guc(conn: &mut PgConnection) -> AppResult<()> {
    diesel::sql_query("SELECT set_config('papercrate.user_id', '', false)")
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

pub fn apply_user_session_hash(conn: &mut PgConnection, hash: &str) -> AppResult<()> {
    diesel::sql_query("SELECT set_config('papercrate.user_session_hash', $1, false)")
        .bind::<Text, _>(hash)
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

pub fn clear_user_session_hash(conn: &mut PgConnection) -> AppResult<()> {
    diesel::sql_query("SELECT set_config('papercrate.user_session_hash', '', false)")
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

pub fn apply_api_token_prefix(conn: &mut PgConnection, prefix: &str) -> AppResult<()> {
    diesel::sql_query("SELECT set_config('papercrate.api_token_prefix', $1, false)")
        .bind::<Text, _>(prefix)
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

fn normalize_tenant_name(value: &str) -> AppResult<String> {
    normalize_identifier(
        value,
        255,
        "tenant name must not be empty",
        "tenant name must not exceed 255 characters",
        Some("tenant name may only contain printable characters"),
        |ch| !ch.is_control(),
    )
}

pub fn clear_api_token_prefix(conn: &mut PgConnection) -> AppResult<()> {
    diesel::sql_query("SELECT set_config('papercrate.api_token_prefix', '', false)")
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

fn normalize_storage_root(raw: Option<&str>, tenant_id: Uuid) -> String {
    match raw.map(str::trim) {
        Some(root) if !root.is_empty() => {
            let mut owned = root.to_owned();
            if !owned.ends_with('/') {
                owned.push('/');
            }
            owned
        }
        _ => format!("tenants/{tenant_id}/"),
    }
}

fn normalize_quickwit_index(raw: Option<&str>, tenant_id: Uuid) -> String {
    match raw.map(str::trim) {
        Some(value) if !value.is_empty() => value.to_owned(),
        _ => format!("documents-{tenant_id}"),
    }
}
pub struct UserGucGuard<'a> {
    pub conn: &'a mut PgConnection,
}

impl<'a> UserGucGuard<'a> {
    pub fn new(conn: &'a mut PgConnection, user_id: Uuid) -> AppResult<Self> {
        apply_user_guc(conn, user_id)?;
        Ok(Self { conn })
    }
}

impl<'a> Drop for UserGucGuard<'a> {
    fn drop(&mut self) {
        if let Err(err) = clear_user_guc(self.conn) {
            tracing::error!(error = ?err, "failed to clear user GUC in guard drop");
        }
    }
}

pub struct TenantGucGuard<'a> {
    pub conn: &'a mut PgConnection,
}

impl<'a> TenantGucGuard<'a> {
    pub fn new(conn: &'a mut PgConnection, tenant_id: Uuid) -> AppResult<Self> {
        apply_tenant_guc(conn, tenant_id)?;
        Ok(Self { conn })
    }
}

impl<'a> Drop for TenantGucGuard<'a> {
    fn drop(&mut self) {
        if let Err(err) = clear_tenant_context(self.conn) {
            tracing::error!(error = ?err, "failed to clear tenant context in guard drop");
        }
    }
}

pub struct TenantScopedConnection {
    conn: PgPooledConnection,
}

impl TenantScopedConnection {
    pub(crate) fn new(mut conn: PgPooledConnection, tenant_id: Uuid) -> AppResult<Self> {
        apply_tenant_guc(&mut conn, tenant_id)?;
        clear_user_guc(&mut conn)?;
        Ok(Self { conn })
    }
}

impl std::ops::Deref for TenantScopedConnection {
    type Target = PgConnection;

    fn deref(&self) -> &Self::Target {
        &self.conn
    }
}

impl std::ops::DerefMut for TenantScopedConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.conn
    }
}

impl Drop for TenantScopedConnection {
    fn drop(&mut self) {
        if let Err(err) = clear_tenant_context(&mut self.conn) {
            tracing::error!(error = ?err, "failed to clear tenant context in scoped connection drop");
        }
    }
}
