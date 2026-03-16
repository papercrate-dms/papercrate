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

// ---------------------------------------------------------------------------
// GucContext: declare which Postgres GUC variables a transaction needs
// ---------------------------------------------------------------------------

/// A set of Postgres GUC variables to apply via `SET LOCAL` at the start of a
/// transaction. Postgres automatically resets `LOCAL` variables on commit or
/// rollback, so no manual cleanup is needed.
pub trait GucContext {
    /// Issue the `SET LOCAL` statements on `conn`.
    fn apply_local(&self, conn: &mut PgConnection) -> Result<(), diesel::result::Error>;
}

/// Tenant isolation context — sets `papercrate.tenant_id`.
pub struct TenantId(pub Uuid);

/// User context — sets `papercrate.user_id` (for cross-tenant membership lookups).
pub struct UserId(pub Uuid);

/// Session hash context — sets `papercrate.user_session_hash`.
pub struct SessionHash<'a>(pub &'a str);

/// API token prefix context — sets `papercrate.api_token_prefix`.
pub struct ApiTokenPrefix<'a>(pub &'a str);

/// Quote a value for use in a `SET LOCAL` statement.
///
/// All callers pass UUIDs, hex hashes, or short alphanumeric prefixes.
/// We reject anything that isn't strictly alphanumeric / hyphens to
/// make injection impossible regardless of future call sites.
fn quote_guc_value(value: &str) -> Result<String, diesel::result::Error> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(diesel::result::Error::QueryBuilderError(
            format!("invalid GUC value: {:?}", value).into(),
        ));
    }
    Ok(format!("'{}'", value))
}

impl GucContext for TenantId {
    fn apply_local(&self, conn: &mut PgConnection) -> Result<(), diesel::result::Error> {
        let quoted = quote_guc_value(&self.0.to_string())?;
        let query = format!("SET LOCAL papercrate.tenant_id TO {}", quoted);
        diesel::sql_query(query).execute(conn).map(|_| ())
    }
}

impl GucContext for UserId {
    fn apply_local(&self, conn: &mut PgConnection) -> Result<(), diesel::result::Error> {
        let quoted = quote_guc_value(&self.0.to_string())?;
        let query = format!("SET LOCAL papercrate.user_id TO {}", quoted);
        diesel::sql_query(query).execute(conn).map(|_| ())
    }
}

impl<'a> GucContext for SessionHash<'a> {
    fn apply_local(&self, conn: &mut PgConnection) -> Result<(), diesel::result::Error> {
        let quoted = quote_guc_value(self.0)?;
        let query = format!("SET LOCAL papercrate.user_session_hash TO {}", quoted);
        diesel::sql_query(query).execute(conn).map(|_| ())
    }
}

impl<'a> GucContext for ApiTokenPrefix<'a> {
    fn apply_local(&self, conn: &mut PgConnection) -> Result<(), diesel::result::Error> {
        let quoted = quote_guc_value(self.0)?;
        let query = format!("SET LOCAL papercrate.api_token_prefix TO {}", quoted);
        diesel::sql_query(query).execute(conn).map(|_| ())
    }
}

// Tuple impls — compose multiple contexts in one `.scoped()` call.

impl<A: GucContext, B: GucContext> GucContext for (A, B) {
    fn apply_local(&self, conn: &mut PgConnection) -> Result<(), diesel::result::Error> {
        self.0.apply_local(conn)?;
        self.1.apply_local(conn)
    }
}

impl<A: GucContext, B: GucContext, C: GucContext> GucContext for (A, B, C) {
    fn apply_local(&self, conn: &mut PgConnection) -> Result<(), diesel::result::Error> {
        self.0.apply_local(conn)?;
        self.1.apply_local(conn)?;
        self.2.apply_local(conn)
    }
}

// ---------------------------------------------------------------------------
// ScopedTransaction: the main entry point — `conn.scoped(ctx, |tx| { ... })`
// ---------------------------------------------------------------------------

/// Extension trait that adds `.scoped()` to any `PgConnection`.
///
/// ```ignore
/// conn.scoped(TenantId(tenant_id), |tx| {
///     documents::table.load::<Document>(tx)
/// })?;
/// ```
pub trait ScopedTransaction {
    /// Run `f` inside a transaction with the given GUC context applied via
    /// `SET LOCAL`. Postgres guarantees cleanup on commit/rollback.
    fn scoped<Ctx, T, E, F>(&mut self, ctx: Ctx, f: F) -> Result<T, E>
    where
        Ctx: GucContext,
        F: FnOnce(&mut PgConnection) -> Result<T, E>,
        E: From<diesel::result::Error>;
}

impl ScopedTransaction for PgConnection {
    fn scoped<Ctx, T, E, F>(&mut self, ctx: Ctx, f: F) -> Result<T, E>
    where
        Ctx: GucContext,
        F: FnOnce(&mut PgConnection) -> Result<T, E>,
        E: From<diesel::result::Error>,
    {
        self.transaction(|conn| {
            ctx.apply_local(conn)?;
            f(conn)
        })
    }
}

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
                // Apply tenant context for RLS within this transaction.
                TenantId(id).apply_local(conn)?;

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
                // No manual clear needed - SET LOCAL auto-resets on transaction end
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

// ---------------------------------------------------------------------------
// TenantScopedConnection — owns a pooled connection + remembers the tenant_id
// ---------------------------------------------------------------------------

/// A pooled connection bound to a specific tenant.
///
/// All DB work **must** go through `.scoped()` or `.scoped_with()`, which wrap
/// the closure in a transaction with `SET LOCAL papercrate.tenant_id`. Postgres
/// guarantees cleanup on commit or rollback — no risk of leaking tenant context
/// to the connection pool.
///
/// For queries that intentionally bypass RLS (e.g. querying the `tenants` table
/// itself), use `.unscoped()`.
pub struct TenantScopedConnection {
    conn: PgPooledConnection,
    tenant_id: Uuid,
}

impl TenantScopedConnection {
    pub(crate) fn new(conn: PgPooledConnection, tenant_id: Uuid) -> Self {
        Self { conn, tenant_id }
    }

    /// The tenant this connection is scoped to.
    pub fn tenant_id(&self) -> Uuid {
        self.tenant_id
    }

    /// Run a closure inside a transaction with the tenant GUC applied via
    /// `SET LOCAL`. This is the only way to do tenant-scoped database work.
    pub fn scoped<T, E, F>(&mut self, f: F) -> Result<T, E>
    where
        F: FnOnce(&mut PgConnection) -> Result<T, E>,
        E: From<diesel::result::Error>,
    {
        let tid = self.tenant_id;
        self.conn.scoped(TenantId(tid), f)
    }

    /// Run a closure with additional GUC context layered on top of the tenant
    /// context. Useful when RLS policies need more than just `tenant_id`.
    pub fn scoped_with<Ctx, T, E, F>(&mut self, extra: Ctx, f: F) -> Result<T, E>
    where
        Ctx: GucContext,
        F: FnOnce(&mut PgConnection) -> Result<T, E>,
        E: From<diesel::result::Error>,
    {
        let tid = self.tenant_id;
        self.conn.scoped((TenantId(tid), extra), f)
    }

    /// Access the raw pooled connection for operations that do not need RLS
    /// context (e.g. querying the `tenants` table which has no RLS).
    pub fn unscoped(&mut self) -> &mut PgConnection {
        &mut self.conn
    }

    /// Set the tenant GUC at session level and return a mutable reference to
    /// the raw connection. Use this for `async` service methods that do writes
    /// and cannot run inside a synchronous `.scoped()` closure.
    ///
    /// The session-level GUC is cleared on `Drop` before the connection returns
    /// to the pool.
    pub fn unscoped_with_tenant(&mut self) -> AppResult<&mut PgConnection> {
        diesel::sql_query("SELECT set_config('papercrate.tenant_id', $1, false)")
            .bind::<Text, _>(self.tenant_id.to_string())
            .execute(&mut self.conn)
            .map_err(AppError::from)?;
        Ok(&mut self.conn)
    }
}

impl Drop for TenantScopedConnection {
    fn drop(&mut self) {
        // Clear any session-level GUC that may have been set by
        // unscoped_with_tenant() before returning to the pool.
        let _ = diesel::sql_query("SELECT set_config('papercrate.tenant_id', '', false)")
            .execute(&mut self.conn);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // quote_guc_value — allowlist validation + formatting
    // -----------------------------------------------------------------------

    #[test]
    fn accepts_uuid() {
        let uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        assert_eq!(
            quote_guc_value(uuid).unwrap(),
            "'a1b2c3d4-e5f6-7890-abcd-ef1234567890'"
        );
    }

    #[test]
    fn accepts_hex_hash() {
        let hash = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";
        let result = quote_guc_value(hash).unwrap();
        assert_eq!(result, format!("'{}'", hash));
    }

    #[test]
    fn accepts_alphanumeric_prefix() {
        assert_eq!(quote_guc_value("pc_live").unwrap(), "'pc_live'");
    }

    #[test]
    fn accepts_simple_alphanumeric() {
        assert_eq!(quote_guc_value("abc123").unwrap(), "'abc123'");
    }

    #[test]
    fn rejects_empty_string() {
        assert!(quote_guc_value("").is_err());
    }

    #[test]
    fn rejects_single_quote() {
        assert!(quote_guc_value("it's").is_err());
    }

    #[test]
    fn rejects_semicolon() {
        assert!(quote_guc_value("abc; DROP TABLE users").is_err());
    }

    #[test]
    fn rejects_spaces() {
        assert!(quote_guc_value("hello world").is_err());
    }

    #[test]
    fn rejects_dot() {
        assert!(quote_guc_value("a.b").is_err());
    }

    #[test]
    fn rejects_backslash() {
        assert!(quote_guc_value("a\\b").is_err());
    }

    #[test]
    fn rejects_null_byte() {
        assert!(quote_guc_value("abc\0def").is_err());
    }

    #[test]
    fn rejects_newline() {
        assert!(quote_guc_value("abc\ndef").is_err());
    }

    #[test]
    fn rejects_parentheses() {
        assert!(quote_guc_value("set_config('x','y',false)").is_err());
    }
}
