pub mod api_tokens;
pub mod capability_guard;
pub mod capability_sets;
pub mod jwt;
pub mod passkeys;
pub mod password;

use std::sync::{Arc, Mutex};

use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
};
use axum_extra::headers::{authorization::Bearer, Authorization};
use axum_extra::TypedHeader;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    auth::capability_sets::{load_capabilities_for_set, load_capability_set},
    error::{AppError, AppResult},
    models::{ApiCapability, TenantStatus},
    schema::tenants::dsl as tenant_dsl,
    state::AppState,
    tenants::TenantScopedConnection,
};
use uuid::Uuid;

use crate::auth::jwt::PrincipalKind;

#[derive(Debug, Clone)]
pub struct TenantMembershipUser {
    pub user_id: Uuid,
}

impl FromRequestParts<AppState> for TenantMembershipUser {
    type Rejection = AppError;

    #[allow(refining_impl_trait)]
    fn from_request_parts<'a>(
        parts: &'a mut Parts,
        state: &AppState,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send + 'a {
        let state = state.clone();
        async move {
            let TypedHeader(Authorization(bearer)) =
                TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, &state)
                    .await
                    .map_err(|_| AppError::unauthorized())?;

            if let Ok(claims) = state.jwt.verify_token(bearer.token()) {
                return Ok(Self {
                    user_id: claims.sub,
                });
            }

            let selector = state
                .jwt
                .verify_tenant_selector_token(bearer.token())
                .map_err(|_| AppError::unauthorized())?;

            Ok(Self {
                user_id: selector.sub,
            })
        }
    }
}

#[derive(Clone)]
pub struct TenantConnectionHolder {
    inner: Arc<Mutex<Option<TenantScopedConnection>>>,
}

impl TenantConnectionHolder {
    pub fn new(conn: TenantScopedConnection) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Some(conn))),
        }
    }

    pub fn into_conn(self) -> Option<TenantScopedConnection> {
        self.inner.lock().ok()?.take()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct AuthenticatedUser {
    pub user_id: uuid::Uuid,
    pub username: String,
    pub tenant_id: uuid::Uuid,
    pub principal_kind: PrincipalKind,
    pub principal_id: Uuid,
    pub capability_set_id: Uuid,
    pub cap_version: i32,
    pub capabilities: Vec<ApiCapability>,
}

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    #[allow(refining_impl_trait)]
    fn from_request_parts<'a>(
        parts: &'a mut Parts,
        state: &AppState,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send + 'a {
        let state = state.clone();
        async move {
            if let Some(user) = parts.extensions.get::<AuthenticatedUser>() {
                return Ok(user.clone());
            }

            let TypedHeader(Authorization(bearer)) =
                TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, &state)
                    .await
                    .map_err(|_| AppError::unauthorized())?;

            let claims = state
                .jwt
                .verify_token(bearer.token())
                .map_err(|_| AppError::unauthorized())?;

            let mut tenant_conn = state.db_for_tenant(claims.tenant_id)?;
            let (capability_set, capabilities) = tenant_conn
                .scoped(|tx| {
                    let cs = load_capability_set(tx, claims.capability_set_id)?;
                    let caps = load_capabilities_for_set(tx, cs.id)?;
                    Ok::<_, AppError>((cs, caps))
                })
                .map_err(|_| AppError::unauthorized())?;

            if capability_set.cap_version != claims.cap_version {
                return Err(AppError::unauthorized());
            }

            let user = AuthenticatedUser {
                user_id: claims.sub,
                username: claims.username,
                tenant_id: claims.tenant_id,
                principal_kind: claims.principal_kind,
                principal_id: claims.principal_id,
                capability_set_id: claims.capability_set_id,
                cap_version: claims.cap_version,
                capabilities,
            };

            parts.extensions.insert(user.clone());
            parts
                .extensions
                .insert(TenantConnectionHolder::new(tenant_conn));

            Ok(user)
        }
    }
}

pub struct TenantScopedConn {
    pub conn: TenantScopedConnection,
    pub tenant_id: Uuid,
    pub user_id: Uuid,
    pub user: AuthenticatedUser,
}

impl FromRequestParts<AppState> for TenantScopedConn {
    type Rejection = AppError;

    #[allow(refining_impl_trait)]
    fn from_request_parts<'a>(
        parts: &'a mut Parts,
        state: &AppState,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send + 'a {
        let state = state.clone();
        async move {
            let user = AuthenticatedUser::from_request_parts(parts, &state).await?;
            let tenant_id = user.tenant_id;
            let mut conn = if let Some(holder) = parts.extensions.remove::<TenantConnectionHolder>()
            {
                holder
                    .into_conn()
                    .ok_or_else(|| AppError::internal("tenant connection unavailable"))?
            } else {
                state.db_for_tenant(tenant_id)?
            };

            ensure_active_tenant_with_conn(conn.unscoped(), tenant_id)?;

            Ok(Self {
                conn,
                tenant_id,
                user_id: user.user_id,
                user,
            })
        }
    }
}

pub(crate) fn ensure_active_tenant(state: &AppState, tenant_id: Uuid) -> AppResult<()> {
    let mut conn = state.db_unscoped()?;
    ensure_active_tenant_with_conn(&mut conn, tenant_id)
}

pub(crate) fn ensure_active_tenant_with_conn(
    conn: &mut PgConnection,
    tenant_id: Uuid,
) -> AppResult<()> {
    use tenant_dsl::tenants;

    let status: TenantStatus = tenants
        .find(tenant_id)
        .select(tenant_dsl::status)
        .first(conn)?;

    if status != TenantStatus::Active {
        return Err(AppError::new(StatusCode::FORBIDDEN, "tenant is not active"));
    }

    Ok(())
}
