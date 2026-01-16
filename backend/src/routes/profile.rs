use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use utoipa::OpenApi;
use uuid::Uuid;

use crate::{
    auth::{passkeys::PasskeySummary, TenantScopedConn},
    error::AppResult,
    http::responders::JsonResponse,
    services::profile::{
        ApiTokenCreatedResponse, ApiTokenResponse, CreateApiTokenRequest, ProfileService,
        RevokePasskeyQuery,
    },
    state::AppState,
};

#[utoipa::path(
    get,
    path = "/api/profile/passkeys",
    responses((status = 200, description = "List registered passkeys", body = [PasskeySummary])),
    tag = "Profile"
)]
pub async fn list_passkeys(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn, user_id, ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<PasskeySummary>>> {
    ProfileService::new(&state).list_passkeys(&mut *conn, user_id)
}

#[utoipa::path(
    get,
    path = "/api/profile/api-tokens",
    responses((status = 200, description = "List API tokens", body = [ApiTokenResponse])),
    tag = "Profile"
)]
pub async fn list_api_tokens(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<ApiTokenResponse>>> {
    ProfileService::new(&state).list_api_tokens(&mut *conn, tenant_id, user_id)
}

#[utoipa::path(
    post,
    path = "/api/profile/api-tokens",
    request_body = CreateApiTokenRequest,
    responses((status = 201, description = "API token created", body = ApiTokenCreatedResponse)),
    tag = "Profile"
)]
pub async fn create_api_token(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<CreateApiTokenRequest>,
) -> AppResult<JsonResponse<ApiTokenCreatedResponse>> {
    ProfileService::new(&state).create_api_token(&mut *conn, tenant_id, user_id, payload)
}

#[utoipa::path(
    post,
    path = "/api/profile/api-tokens/{id}/regenerate",
    params(("id" = Uuid, Path, description = "API token ID")),
    responses((status = 200, description = "API token regenerated", body = ApiTokenCreatedResponse)),
    tag = "Profile"
)]
pub async fn regenerate_api_token(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    Path(token_id): Path<Uuid>,
) -> AppResult<JsonResponse<ApiTokenCreatedResponse>> {
    ProfileService::new(&state).regenerate_api_token(&mut *conn, tenant_id, user_id, token_id)
}

#[utoipa::path(
    delete,
    path = "/api/profile/api-tokens/{id}",
    params(("id" = Uuid, Path, description = "API token ID")),
    responses((status = 204, description = "API token revoked")),
    tag = "Profile"
)]
pub async fn delete_api_token(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn, user_id, ..
    }: TenantScopedConn,
    Path(token_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    ProfileService::new(&state).delete_api_token(&mut *conn, user_id, token_id)
}

#[utoipa::path(
    delete,
    path = "/api/profile/passkeys/{id}",
    params(
        ("id" = Uuid, Path, description = "Passkey ID"),
        ("reason" = Option<String>, Query, description = "Optional reason for revoking the passkey")
    ),
    responses((status = 204, description = "Passkey revoked")),
    tag = "Profile"
)]
pub async fn delete_passkey(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn, user_id, ..
    }: TenantScopedConn,
    Path(passkey_id): Path<Uuid>,
    Query(query): Query<RevokePasskeyQuery>,
) -> AppResult<StatusCode> {
    ProfileService::new(&state).delete_passkey(&mut *conn, user_id, passkey_id, query.reason)
}

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::routes::profile::list_api_tokens,
        crate::routes::profile::create_api_token,
        crate::routes::profile::regenerate_api_token,
        crate::routes::profile::delete_api_token,
        crate::routes::profile::list_passkeys,
        crate::routes::profile::delete_passkey
    ),
    components(schemas(
        crate::models::ApiCapability,
        crate::services::profile::ApiTokenResponse,
        crate::services::profile::ApiTokenCreatedResponse,
        crate::services::profile::CreateApiTokenRequest,
        crate::services::profile::RevokePasskeyQuery,
        crate::auth::passkeys::PasskeySummary
    ))
)]
pub struct ProfileApiDoc;
