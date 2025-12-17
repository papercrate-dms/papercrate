use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
};
use utoipa::OpenApi;
use uuid::Uuid;

use crate::{
    auth::TenantScopedConn,
    error::{AppError, AppResult},
    http::responders::{created_json, no_content, ok_json, JsonResponse},
    services::folders::{
        CreateFolderRequest, EnsureFolderPathRequest, FolderContentsData, FolderContentsQuery,
        FolderInfo, FolderService, FolderTreeNode, UpdateFolderRequest,
    },
    state::AppState,
};

use crate::services::documents::DocumentResponse;

#[derive(utoipa::ToSchema, serde::Serialize)]
pub struct FolderResponse {
    pub folder: FolderInfo,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
pub struct FolderContentsResponse {
    #[schema(nullable)]
    pub folder: Option<FolderInfo>,
    pub subfolders: Vec<FolderInfo>,
    pub documents: Vec<DocumentResponse>,
}

#[utoipa::path(
    get,
    path = "/api/folders/{id}",
    params(("id" = Uuid, Path, description = "Folder ID")),
    responses((status = 200, description = "Folder detail", body = FolderResponse)),
    tag = "Folders"
)]
pub async fn get_folder(
    State(state): State<AppState>,
    Path(folder_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<FolderResponse>> {
    let service = FolderService::new(&state);
    let folder = service.get_folder(&mut conn, tenant_id, folder_id)?;
    ok_json(FolderResponse { folder })
}

#[utoipa::path(
    post,
    path = "/api/folders/path",
    request_body = EnsureFolderPathRequest,
    responses((status = 200, description = "Folder path ensured", body = FolderResponse)),
    tag = "Folders"
)]
pub async fn ensure_folder_path(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<EnsureFolderPathRequest>,
) -> AppResult<JsonResponse<FolderResponse>> {
    let service = FolderService::new(&state);
    let folder = service.ensure_folder_path(&mut conn, tenant_id, payload)?;
    ok_json(FolderResponse { folder })
}

#[utoipa::path(
    post,
    path = "/api/folders",
    request_body = CreateFolderRequest,
    responses(
        (status = 201, description = "Folder created", body = FolderResponse),
        (status = 200, description = "Folder already existed", body = FolderResponse)
    ),
    tag = "Folders"
)]
pub async fn create_folder(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<CreateFolderRequest>,
) -> AppResult<JsonResponse<FolderResponse>> {
    let service = FolderService::new(&state);
    let (folder, created) = service.create_folder(&mut conn, tenant_id, payload)?;
    let response = FolderResponse { folder };
    if created {
        created_json(response)
    } else {
        ok_json(response)
    }
}

#[utoipa::path(
    get,
    path = "/api/folders/{id}/contents",
    params(("id" = String, Path, description = "Folder ID or 'root'"), FolderContentsQuery),
    responses((status = 200, description = "Folder contents", body = FolderContentsResponse)),
    tag = "Folders"
)]
pub async fn list_folder_contents(
    State(state): State<AppState>,
    Path(folder_identifier): Path<String>,
    Query(query): Query<FolderContentsQuery>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<FolderContentsResponse>> {
    let FolderContentsQuery {
        include_documents,
        sort,
        dir,
    } = query;

    let folder_id = if folder_identifier.eq_ignore_ascii_case("root") {
        None
    } else {
        Some(
            Uuid::parse_str(&folder_identifier)
                .map_err(|_| AppError::bad_request("folder identifier must be 'root' or a UUID"))?,
        )
    };

    let service = FolderService::new(&state);
    let FolderContentsData {
        folder,
        subfolders,
        documents,
    } = service.list_folder_contents(
        &mut conn,
        tenant_id,
        folder_id,
        sort,
        dir,
        include_documents,
    )?;

    let documents = if include_documents {
        service.hydrate_documents(&mut conn, tenant_id, user_id, documents)?
    } else {
        Vec::new()
    };

    ok_json(FolderContentsResponse {
        folder,
        subfolders,
        documents,
    })
}

#[utoipa::path(
    get,
    path = "/api/folders/tree",
    responses((status = 200, description = "Folder hierarchy", body = [FolderTreeNode])),
    tag = "Folders"
)]
pub async fn list_folder_tree(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<FolderTreeNode>>> {
    let service = FolderService::new(&state);
    let tree = service.list_folder_tree(&mut conn, tenant_id)?;
    ok_json(tree)
}

#[utoipa::path(
    delete,
    path = "/api/folders/{id}",
    params(("id" = Uuid, Path, description = "Folder ID")),
    responses((status = 204, description = "Folder deleted")),
    tag = "Folders"
)]
pub async fn delete_folder(
    State(state): State<AppState>,
    Path(folder_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<StatusCode> {
    FolderService::new(&state).delete_folder(&mut conn, tenant_id, folder_id)?;
    no_content()
}

#[utoipa::path(
    patch,
    path = "/api/folders/{id}",
    params(("id" = Uuid, Path, description = "Folder ID")),
    request_body = UpdateFolderRequest,
    responses((status = 204, description = "Folder updated")),
    tag = "Folders"
)]
pub async fn update_folder(
    State(state): State<AppState>,
    Path(folder_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<UpdateFolderRequest>,
) -> AppResult<StatusCode> {
    FolderService::new(&state).update_folder(&mut conn, tenant_id, folder_id, payload)?;
    no_content()
}

#[derive(OpenApi)]
#[openapi(
    paths(
        crate::routes::folders::create_folder,
        crate::routes::folders::ensure_folder_path,
        crate::routes::folders::get_folder,
        crate::routes::folders::list_folder_contents,
        crate::routes::folders::list_folder_tree,
        crate::routes::folders::delete_folder,
        crate::routes::folders::update_folder
    ),
    components(schemas(
        crate::services::folders::CreateFolderRequest,
        crate::services::folders::EnsureFolderPathRequest,
        crate::routes::folders::FolderResponse,
        crate::services::folders::FolderInfo,
        crate::services::folders::FolderContentsQuery,
        crate::routes::folders::FolderContentsResponse,
        crate::services::folders::FolderTreeNode,
        crate::services::folders::UpdateFolderRequest
    ))
)]
pub struct FoldersApiDoc;
