use axum::{extract::Path, http::StatusCode, Json};
use utoipa::OpenApi;
use uuid::Uuid;

use crate::{
    auth::TenantScopedConn,
    error::AppResult,
    http::responders::JsonResponse,
    services::capability_sets::{
        CapabilitySetResponse, CapabilitySetService, CreateCapabilitySetRequest,
        UpdateCapabilitySetRequest,
    },
};

#[utoipa::path(
    get,
    path = "/api/capability-sets",
    responses((status = 200, body = [CapabilitySetResponse])),
    tag = "Capability Sets"
)]
pub async fn list_capability_sets(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<CapabilitySetResponse>>> {
    conn.scoped(|tx| CapabilitySetService::new().list(tx, tenant_id))
}

#[utoipa::path(
    get,
    path = "/api/capabilities",
    responses((status = 200, body = [crate::models::ApiCapability])),
    tag = "Capability Sets"
)]
pub async fn list_capabilities(
    TenantScopedConn { .. }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<crate::models::ApiCapability>>> {
    CapabilitySetService::new().list_capabilities()
}

#[utoipa::path(
    get,
    path = "/api/capability-sets/{id}",
    params(("id" = Uuid, Path, description = "Capability set ID")),
    responses((status = 200, body = CapabilitySetResponse), (status = 404, description = "Not found")),
    tag = "Capability Sets"
)]
pub async fn get_capability_set(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Path(id): Path<Uuid>,
) -> AppResult<JsonResponse<CapabilitySetResponse>> {
    conn.scoped(|tx| CapabilitySetService::new().get(tx, tenant_id, id))
}

#[utoipa::path(
    post,
    path = "/api/capability-sets",
    request_body = CreateCapabilitySetRequest,
    responses((status = 201, body = CapabilitySetResponse)),
    tag = "Capability Sets"
)]
pub async fn create_capability_set(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<CreateCapabilitySetRequest>,
) -> AppResult<JsonResponse<CapabilitySetResponse>> {
    conn.scoped(|tx| CapabilitySetService::new().create(tx, tenant_id, payload))
}

#[utoipa::path(
    patch,
    path = "/api/capability-sets/{id}",
    params(("id" = Uuid, Path, description = "Capability set ID")),
    request_body = UpdateCapabilitySetRequest,
    responses((status = 200, body = CapabilitySetResponse)),
    tag = "Capability Sets"
)]
pub async fn update_capability_set(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateCapabilitySetRequest>,
) -> AppResult<JsonResponse<CapabilitySetResponse>> {
    conn.scoped(|tx| CapabilitySetService::new().update(tx, tenant_id, id, payload))
}

#[utoipa::path(
    delete,
    path = "/api/capability-sets/{id}",
    params(("id" = Uuid, Path, description = "Capability set ID")),
    responses((status = 204), (status = 409, description = "Set in use")),
    tag = "Capability Sets"
)]
pub async fn delete_capability_set(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    conn.scoped(|tx| CapabilitySetService::new().delete(tx, tenant_id, id))
}

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::routes::capability_sets::list_capability_sets,
        crate::routes::capability_sets::list_capabilities,
        crate::routes::capability_sets::get_capability_set,
        crate::routes::capability_sets::create_capability_set,
        crate::routes::capability_sets::update_capability_set,
        crate::routes::capability_sets::delete_capability_set,
    ),
    components(schemas(
        crate::models::ApiCapability,
        crate::services::capability_sets::CapabilitySetResponse,
        crate::services::capability_sets::CreateCapabilitySetRequest,
        crate::services::capability_sets::UpdateCapabilitySetRequest,
    ))
)]
pub struct CapabilitySetsApiDoc;
