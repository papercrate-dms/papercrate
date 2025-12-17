use axum::extract::{Path, State};
use axum::{http::StatusCode, Json};
use uuid::Uuid;

use crate::auth::{AuthenticatedUser, TenantMembershipUser};
use crate::error::AppResult;
use crate::http::responders::JsonResponse;
use crate::services::auth::{AuthService, TenantSnippet};
use crate::services::tenants::{
    TenantApiService, TenantUserListResponse, TenantUserSummary, UpdateTenantRequest,
    UpdateTenantUserRequest,
};
use crate::state::AppState;

#[utoipa::path(
    get,
    path = "/api/tenants",
    responses((status = 200, body = [TenantSnippet], description = "Tenant memberships for the current user")),
    tag = "Tenants"
)]
pub async fn list_tenants(
    State(state): State<AppState>,
    user: TenantMembershipUser,
) -> AppResult<Json<Vec<TenantSnippet>>> {
    let response = AuthService::new(&state).list_tenants(user.user_id)?;
    Ok(Json(response.into_inner().tenants))
}

#[utoipa::path(
    get,
    path = "/api/tenants/{tenant_id}",
    params(("tenant_id" = Uuid, Path, description = "Tenant identifier")),
    responses((status = 200, body = TenantSnippet, description = "Tenant details")),
    tag = "Tenants"
)]
pub async fn get_tenant(
    State(state): State<AppState>,
    Path(tenant_id): Path<Uuid>,
    user: TenantMembershipUser,
) -> AppResult<JsonResponse<TenantSnippet>> {
    AuthService::new(&state).get_tenant(user.user_id, tenant_id)
}

#[utoipa::path(
    patch,
    path = "/api/tenants/{tenant_id}",
    params(("tenant_id" = Uuid, Path, description = "Tenant identifier")),
    request_body = UpdateTenantRequest,
    responses((status = 200, body = TenantSnippet, description = "Updated tenant")),
    tag = "Tenants"
)]
pub async fn update_tenant(
    State(state): State<AppState>,
    Path(tenant_id): Path<Uuid>,
    user: AuthenticatedUser,
    Json(payload): Json<UpdateTenantRequest>,
) -> AppResult<JsonResponse<TenantSnippet>> {
    TenantApiService::new(&state).update_name(user, tenant_id, payload)
}

#[utoipa::path(
    get,
    path = "/api/tenants/{tenant_id}/users",
    params(("tenant_id" = Uuid, Path, description = "Tenant ID")),
    responses((status = 200, body = [TenantUserSummary], description = "All users for the tenant")),
    tag = "Tenants"
)]
pub async fn list_tenant_users(
    State(state): State<AppState>,
    Path(tenant_id): Path<Uuid>,
    user: AuthenticatedUser,
) -> AppResult<Json<Vec<TenantUserSummary>>> {
    let response = TenantApiService::new(&state).list_users(&user, tenant_id)?;
    Ok(Json(response.into_inner().users))
}

#[utoipa::path(
    get,
    path = "/api/tenants/{tenant_id}/users/{user_id}",
    params(
        ("tenant_id" = Uuid, Path, description = "Tenant ID"),
        ("user_id" = Uuid, Path, description = "User ID")
    ),
    responses((status = 200, body = TenantUserSummary, description = "Tenant user details")),
    tag = "Tenants"
)]
pub async fn get_tenant_user(
    State(state): State<AppState>,
    Path((tenant_id, target_user_id)): Path<(Uuid, Uuid)>,
    user: AuthenticatedUser,
) -> AppResult<JsonResponse<TenantUserSummary>> {
    TenantApiService::new(&state).get_user(&user, tenant_id, target_user_id)
}

#[utoipa::path(
    patch,
    path = "/api/tenants/{tenant_id}/users/{user_id}",
    params(
        ("tenant_id" = Uuid, Path, description = "Tenant ID"),
        ("user_id" = Uuid, Path, description = "User ID")
    ),
    request_body = UpdateTenantUserRequest,
    responses((status = 200, body = TenantUserSummary, description = "Updated tenant user")),
    tag = "Tenants"
)]
pub async fn update_tenant_user(
    State(state): State<AppState>,
    Path((tenant_id, target_user_id)): Path<(Uuid, Uuid)>,
    user: AuthenticatedUser,
    Json(payload): Json<UpdateTenantUserRequest>,
) -> AppResult<JsonResponse<TenantUserSummary>> {
    TenantApiService::new(&state).update_user(&user, tenant_id, target_user_id, payload)
}

#[utoipa::path(
    delete,
    path = "/api/tenants/{tenant_id}/users/{user_id}",
    params(
        ("tenant_id" = Uuid, Path, description = "Tenant ID"),
        ("user_id" = Uuid, Path, description = "User ID")
    ),
    responses((status = 204, description = "Membership removed")),
    tag = "Tenants"
)]
pub async fn delete_tenant_user(
    State(state): State<AppState>,
    Path((tenant_id, target_user_id)): Path<(Uuid, Uuid)>,
    user: AuthenticatedUser,
) -> AppResult<StatusCode> {
    TenantApiService::new(&state).remove_user(&user, tenant_id, target_user_id)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        list_tenants,
        get_tenant,
        update_tenant,
        list_tenant_users,
        get_tenant_user,
        update_tenant_user,
        delete_tenant_user,
    ),
    components(schemas(
        crate::services::auth::TenantListResponse,
        crate::services::auth::TenantSnippet,
        UpdateTenantRequest,
        UpdateTenantUserRequest,
        TenantUserListResponse,
        TenantUserSummary,
    ))
)]
pub struct TenantsApiDoc;
