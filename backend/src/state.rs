use std::sync::Arc;

use diesel::{
    pg::PgConnection,
    r2d2::{ConnectionManager, PooledConnection},
};
use uuid::Uuid;

use crate::{
    auth::{jwt::JwtService, passkeys::PasskeyService},
    config::AppConfig,
    db::PgPool,
    error::{AppError, AppResult},
    issued_at::IssuedAtSettings,
    storage::{ObjectStorage, TenantStorage},
    tenants::{apply_tenant_guc, clear_tenant_context, clear_user_guc, TenantService},
};

pub type PgPooledConnection = PooledConnection<ConnectionManager<PgConnection>>;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<AppConfig>,
    storage: Arc<dyn ObjectStorage>,
    pub jwt: JwtService,
    pub tenants: TenantService,
    pub passkeys: Option<PasskeyService>,
    issued_at: Arc<IssuedAtSettings>,
}

impl AppState {
    pub async fn initialize(
        config: AppConfig,
        pool_size_override: Option<u32>,
    ) -> anyhow::Result<Self> {
        let pool_size = pool_size_override.unwrap_or(config.database_max_pool_size);
        let pool = crate::db::init_pool_with_size(&config.database_url, pool_size)?;
        let bucket = crate::s3::build_bucket(&config)?;
        let storage = Arc::new(crate::storage::S3Storage::new(bucket));
        let jwt = crate::auth::jwt::JwtService::from_config(&config)?;

        Ok(Self::new(pool, config, storage, jwt))
    }

    pub fn new(
        pool: PgPool,
        config: AppConfig,
        storage: Arc<dyn ObjectStorage>,
        jwt: JwtService,
    ) -> Self {
        let issued_at = Arc::new(IssuedAtSettings::from_config(&config));
        let config = Arc::new(config);
        let tenants = TenantService::new(pool.clone());

        let passkeys = match PasskeyService::try_new(&config) {
            Ok(service) => service,
            Err(err) => {
                tracing::warn!(error = ?err, "passkey service disabled due to configuration");
                None
            }
        };

        Self {
            pool,
            config,
            storage,
            jwt,
            tenants,
            passkeys,
            issued_at,
        }
    }

    pub fn db_for_tenant(&self, tenant_id: Uuid) -> AppResult<PgPooledConnection> {
        debug_assert!(!tenant_id.is_nil(), "nil tenant_id passed to db_for_tenant");
        let mut conn = self.db_unscoped()?;
        let conn_ptr = &*conn as *const _;
        tracing::trace!(target = "db_pool", ?conn_ptr, tenant_id = %tenant_id, "apply tenant context");
        apply_tenant_guc(&mut conn, tenant_id)?;
        clear_user_guc(&mut conn)?;
        Ok(conn)
    }

    pub(crate) fn db_unscoped(&self) -> AppResult<PgPooledConnection> {
        let mut conn = self.pool.get().map_err(|err| {
            tracing::error!(error = ?err, "database pool error");
            AppError::internal("database pool error")
        })?;
        let conn_ptr = &*conn as *const _;
        tracing::trace!(target = "db_pool", ?conn_ptr, "acquired connection");
        clear_tenant_context(&mut conn)?;
        Ok(conn)
    }

    pub fn storage_for_tenant(&self, tenant_id: Uuid) -> AppResult<TenantStorage> {
        let tenant = self.tenants.get_by_id(tenant_id)?;
        TenantStorage::new(self.storage.clone(), &tenant).map_err(|err| {
            tracing::error!(error = ?err, "tenant storage error");
            AppError::internal("tenant storage error")
        })
    }

    pub fn issued_at_settings(&self) -> Arc<IssuedAtSettings> {
        self.issued_at.clone()
    }
}
