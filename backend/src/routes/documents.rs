use std::{collections::HashSet, time::Duration};

use axum::body::Body;
use axum::extract::{Json, Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{DateTime, NaiveDateTime, Utc};
use diesel::dsl::exists;
use diesel::{prelude::*, select};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use tracing::{error, info};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::auth::{ensure_active_tenant_with_conn, jwt::DownloadSubject, TenantScopedConn};
use crate::documents::asset::{
    asset_disposition, DocumentAssetDetailResponse, DocumentAssetResponse,
    DocumentVersionDetailResponse, DocumentVersionResponse, DownloadLink,
};
#[allow(unused_imports)]
use crate::error::ApiErrorResponse;
use crate::error::{AppError, AppResult};
use crate::http::responders::{accepted_json, created_json, no_content, ok_json, JsonResponse};
use crate::models::{Document, DocumentAsset, DocumentVersion};
use crate::schema::{
    document_assets, document_versions, documents, user_sessions::dsl as session_dsl,
};
use crate::services::correspondents::{
    AssignCorrespondentsRequest, BulkCorrespondentAction, BulkCorrespondentResponse,
    BulkCorrespondentsRequest, CorrespondentAssignmentInput, CorrespondentsService,
};
use crate::services::documents::{
    BulkMoveRequest, BulkMoveResponse, BulkReanalyzeResponse, BulkReanalyzeSelectionRequest,
    DocumentCheckResponse, DocumentDetailResponse, DocumentListQuery, DocumentMetadataUpdate,
    DocumentResponse, DocumentUploadOutcome, DocumentUploadRequest, DocumentsService,
};
use crate::services::tags::{
    AssignTagsRequest, BulkTagAction, BulkTagRequest, BulkTagResponse, TagsService,
};
use crate::state::AppState;
use crate::storage::TenantStorage;
use crate::utils::{error::StorageResultExt, http::inline_content_disposition};

const PRESIGNED_URL_EXPIRY_SECONDS: u64 = 300;

#[derive(Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct AssetRequestQuery {
    #[serde(default)]
    #[schema(default = false)]
    pub force: bool,
}

#[derive(Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct DocumentCheckQuery {
    pub checksum: String,
}

#[derive(ToSchema)]
pub struct UploadDocumentForm {
    #[schema(value_type = String, format = Binary)]
    pub file: String,
    #[schema(nullable)]
    pub folder_id: Option<Uuid>,
    #[schema(nullable, value_type = Object)]
    pub metadata: Option<Value>,
    #[schema(nullable)]
    pub title: Option<String>,
    #[schema(nullable, value_type = Vec<Uuid>)]
    pub tag_ids: Option<Vec<Uuid>>,
    #[schema(nullable, value_type = Vec<CorrespondentAssignmentInput>)]
    pub correspondents: Option<Vec<CorrespondentAssignmentInput>>,
    #[schema(nullable, example = "2024-01-01T00:00:00Z")]
    pub issued_at: Option<String>,
    #[schema(nullable, default = true)]
    pub skip_existing: Option<bool>,
}

#[derive(Deserialize, ToSchema)]
pub struct MoveDocumentRequest {
    pub folder_id: Option<Uuid>,
}

#[derive(Deserialize, ToSchema)]
pub struct RestoreDocumentRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<Uuid>,
}

#[utoipa::path(
    get,
    path = "/api/documents",
    params(DocumentListQuery),
    responses((status = 200, description = "List documents", body = [DocumentResponse])),
    tag = "Documents"
)]
pub async fn list_documents(
    State(state): State<AppState>,
    Query(params): Query<DocumentListQuery>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<DocumentResponse>>> {
    let service = DocumentsService::new(&state);
    let documents = service
        .list_documents(conn.unscoped(), tenant_id, user_id, params)
        .await?;
    ok_json(documents)
}

#[utoipa::path(
    get,
    path = "/api/documents/check",
    params(DocumentCheckQuery),
    responses((status = 200, description = "Checksum lookup", body = DocumentCheckResponse)),
    tag = "Documents"
)]
pub async fn check_document(
    State(state): State<AppState>,
    Query(query): Query<DocumentCheckQuery>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<DocumentCheckResponse>> {
    let checksum_raw = query.checksum.trim();
    if checksum_raw.is_empty() {
        return Err(AppError::bad_request("checksum must not be empty"));
    }

    let checksum = checksum_raw.to_ascii_lowercase();
    if !checksum.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(AppError::bad_request(
            "checksum must be a hex-encoded string",
        ));
    }

    let service = DocumentsService::new(&state);
    let response = conn.scoped(|tx| service.check_document(tx, tenant_id, &checksum))?;
    ok_json(response)
}

#[utoipa::path(
    get,
    path = "/api/documents/{id}",
    params(("id" = Uuid, Path, description = "Document ID")),
    responses((status = 200, description = "Document detail", body = DocumentDetailResponse)),
    tag = "Documents"
)]
pub async fn get_document(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<DocumentDetailResponse>> {
    let service = DocumentsService::new(&state);
    let detail = service
        .get_document_detail(conn.unscoped(), tenant_id, user_id, document_id)
        .await?;
    ok_json(detail)
}

#[utoipa::path(
    post,
    path = "/api/documents",
    request_body = UploadDocumentForm,
    responses(
        (status = 201, description = "Document created", body = DocumentDetailResponse),
        (status = 200, description = "Existing document reused", body = DocumentDetailResponse),
        (
            status = 409,
            description = "Document with identical contents already exists",
            body = ApiErrorResponse
        )
    ),
    tag = "Documents"
)]
pub async fn upload_document(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    mut multipart: Multipart,
) -> AppResult<JsonResponse<DocumentDetailResponse>> {
    let tenant_id = tenant_id;
    let user_id = user_id;
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut original_name: Option<String> = None;
    let mut mime_type: Option<String> = None;
    let mut folder_id: Option<Uuid> = None;
    let mut metadata: Value = Value::Object(Default::default());
    let mut tag_ids: Vec<Uuid> = Vec::new();
    let mut correspondents: Vec<CorrespondentAssignmentInput> = Vec::new();
    let mut issued_at_override: Option<NaiveDateTime> = None;
    let mut skip_if_existing = true;
    let mut title_override: Option<String> = None;

    while let Some(field) = multipart.next_field().await.map_err(|err| {
        let msg = format!("invalid multipart data: {err}");
        error!(error = %err, "invalid multipart data");
        AppError::bad_request(msg)
    })? {
        let name = field.name().map(|n| n.to_string());
        match name.as_deref() {
            Some("file") => {
                let file_name = field.file_name().map(|n| n.to_string());
                original_name = file_name.clone();
                mime_type = field.content_type().map(|mime| mime.to_string());
                let data = field.bytes().await.map_err(|err| {
                    let msg = format!("failed to read file bytes: {err}");
                    error!(error = %err, "failed to read file bytes");
                    AppError::bad_request(msg)
                })?;
                file_bytes = Some(data.to_vec());
            }
            Some("folder_id") => {
                let value = field.text().await.map_err(|err| {
                    let msg = format!("invalid folder id: {err}");
                    error!(error = %err, "invalid folder id");
                    AppError::bad_request(msg)
                })?;
                if !value.trim().is_empty() {
                    let parsed = Uuid::parse_str(value.trim())
                        .map_err(|_| AppError::bad_request("folder_id must be a valid UUID"))?;
                    folder_id = Some(parsed);
                }
            }
            Some("metadata") => {
                let value = field.text().await.map_err(|err| {
                    let msg = format!("invalid metadata: {err}");
                    error!(error = %err, "invalid metadata payload");
                    AppError::bad_request(msg)
                })?;
                metadata = serde_json::from_str(&value).map_err(|err| {
                    let msg = format!("metadata must be valid JSON: {err}");
                    error!(error = %err, "metadata parse failure");
                    AppError::bad_request(msg)
                })?;
            }
            Some("title") => {
                let value = field.text().await.map_err(|err| {
                    let msg = format!("invalid title: {err}");
                    error!(error = %err, "invalid title payload");
                    AppError::bad_request(msg)
                })?;
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    title_override = Some(trimmed.to_string());
                }
            }
            Some("tag_ids") => {
                let value = field.text().await.map_err(|err| {
                    let msg = format!("invalid tag_ids: {err}");
                    error!(error = %err, "invalid tag_ids payload");
                    AppError::bad_request(msg)
                })?;
                let parsed: Vec<String> = serde_json::from_str(&value).map_err(|err| {
                    let msg = format!("tag_ids must be a JSON array of UUID strings: {err}");
                    error!(error = %err, "invalid tag_ids json");
                    AppError::bad_request(msg)
                })?;
                let mut set = HashSet::new();
                for raw in parsed {
                    let trimmed = raw.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let uuid = Uuid::parse_str(trimmed)
                        .map_err(|_| AppError::bad_request("tag_ids must contain valid UUIDs"))?;
                    set.insert(uuid);
                }
                tag_ids = set.into_iter().collect();
            }
            Some("correspondents") => {
                let value = field.text().await.map_err(|err| {
                    let msg = format!("invalid correspondents: {err}");
                    error!(error = %err, "invalid correspondents payload");
                    AppError::bad_request(msg)
                })?;
                correspondents = serde_json::from_str(&value).map_err(|err| {
                    let msg = format!(
                        "correspondents must be a JSON array of {{correspondent_id}} objects: {err}"
                    );
                    error!(error = %err, "invalid correspondents json");
                    AppError::bad_request(msg)
                })?;
            }
            Some("issued_at") => {
                let value = field.text().await.map_err(|err| {
                    let msg = format!("invalid issued_at: {err}");
                    error!(error = %err, "invalid issued_at payload");
                    AppError::bad_request(msg)
                })?;
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    let parsed = DateTime::parse_from_rfc3339(trimmed).map_err(|err| {
                        let msg = format!("issued_at must be an RFC3339 timestamp: {err}");
                        error!(error = %err, "invalid issued_at format");
                        AppError::bad_request(msg)
                    })?;
                    issued_at_override = Some(parsed.naive_utc());
                }
            }
            Some("skip_existing") => {
                let value = field.text().await.map_err(|err| {
                    let msg = format!("invalid skip_existing flag: {err}");
                    error!(error = %err, "invalid skip_existing payload");
                    AppError::bad_request(msg)
                })?;
                skip_if_existing = matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes"
                );
            }
            _ => {}
        }
    }

    let file_bytes = file_bytes.ok_or_else(|| {
        error!("upload rejected: missing file field");
        AppError::bad_request("file field is required")
    })?;

    if file_bytes.is_empty() {
        error!("upload rejected: empty file payload");
        return Err(AppError::bad_request("file field must not be empty"));
    }
    let original_name = original_name.ok_or_else(|| {
        error!("upload rejected: missing original filename");
        AppError::bad_request("filename is required")
    })?;
    let original_name_for_log = original_name.clone();

    let request = DocumentUploadRequest {
        bytes: file_bytes,
        original_name,
        mime_type,
        folder_id,
        metadata,
        title_override,
        tag_ids,
        correspondents,
        issued_at_override,
        skip_if_existing,
    };

    let service = DocumentsService::new(&state);
    let outcome = match service
        .upload_document(conn.unscoped(), tenant_id, user_id, request)
        .await
    {
        Ok(outcome) => outcome,
        Err(err) => {
            error!(error = ?err, original_name = %original_name_for_log, "document upload failed");
            return Err(err);
        }
    };

    let response = match outcome {
        DocumentUploadOutcome::Created(detail) => {
            info!(
                document_id = %detail.document.id,
                original_name = %detail.document.original_name,
                created = true,
                reused_existing = false,
                "document upload succeeded",
            );
            created_json(detail)?
        }
        DocumentUploadOutcome::Reused(detail) => {
            info!(
                document_id = %detail.document.id,
                original_name = %detail.document.original_name,
                created = false,
                reused_existing = true,
                "document upload succeeded",
            );
            ok_json(detail)?
        }
    };

    Ok(response)
}

#[utoipa::path(
    post,
    path = "/api/documents/{id}/assets",
    params(("id" = Uuid, Path, description = "Document ID"), AssetRequestQuery),
    responses((status = 202, description = "Asset generation requested")),
    tag = "Assets"
)]
pub async fn request_document_assets(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    Query(query): Query<AssetRequestQuery>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<StatusCode> {
    let service = DocumentsService::new(&state);
    conn.scoped(|tx| service.request_document_assets(tx, tenant_id, document_id, query.force))?;
    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(
    post,
    path = "/api/documents/bulk/reanalyze",
    request_body = BulkReanalyzeSelectionRequest,
    responses((status = 200, description = "Reanalyze queued", body = BulkReanalyzeResponse)),
    tag = "Documents"
)]
pub async fn reanalyze_selected_documents(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<BulkReanalyzeSelectionRequest>,
) -> AppResult<JsonResponse<BulkReanalyzeResponse>> {
    let BulkReanalyzeSelectionRequest {
        mut document_ids,
        force,
    } = payload;

    let service = DocumentsService::new(&state);
    let queued =
        conn.scoped(|tx| service.reanalyze_documents(tx, tenant_id, &mut document_ids, force))?;
    accepted_json(BulkReanalyzeResponse { queued })
}

#[utoipa::path(
    get,
    path = "/api/documents/{id}/assets",
    params(("id" = Uuid, Path, description = "Document ID")),
    responses((status = 200, description = "Document assets", body = [DocumentAssetResponse])),
    tag = "Assets"
)]
pub async fn list_document_assets(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<DocumentAssetResponse>>> {
    let service = DocumentsService::new(&state);
    let assets = service
        .list_document_assets(conn.unscoped(), tenant_id, user_id, document_id)
        .await?;
    ok_json(assets)
}

#[utoipa::path(
    get,
    path = "/api/assets/{asset_id}",
    params(("asset_id" = Uuid, Path, description = "Asset ID")),
    responses((status = 200, description = "Asset detail", body = DocumentAssetDetailResponse)),
    tag = "Assets"
)]
pub async fn get_document_asset(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<DocumentAssetDetailResponse>> {
    let service = DocumentsService::new(&state);
    let detail = service
        .get_document_asset(conn.unscoped(), tenant_id, user_id, asset_id)
        .await?;
    ok_json(detail)
}

#[utoipa::path(
    post,
    path = "/api/documents/{id}/download",
    params(("id" = Uuid, Path, description = "Document ID")),
    responses((status = 200, description = "Download link for current version", body = DownloadLink)),
    tag = "Documents"
)]
pub async fn refresh_document_download(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<DownloadLink>> {
    let service = DocumentsService::new(&state);
    let link = service
        .get_document_download_link(conn.unscoped(), tenant_id, user_id, document_id)
        .await?;
    ok_json(link)
}

#[utoipa::path(
    post,
    path = "/api/documents/{id}/versions/{version_id}/download",
    params(
        ("id" = Uuid, Path, description = "Document ID"),
        ("version_id" = Uuid, Path, description = "Version ID")
    ),
    responses((status = 200, description = "Download link for version", body = DownloadLink)),
    tag = "Documents"
)]
pub async fn refresh_document_version_download(
    State(state): State<AppState>,
    Path((document_id, version_id)): Path<(Uuid, Uuid)>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<DownloadLink>> {
    let service = DocumentsService::new(&state);
    let link = service
        .get_document_version_download_link(conn.unscoped(), tenant_id, user_id, document_id, version_id)
        .await?;
    ok_json(link)
}

#[utoipa::path(
    post,
    path = "/api/assets/{asset_id}/download",
    params(("asset_id" = Uuid, Path, description = "Asset ID")),
    responses((status = 200, description = "Asset download link", body = DownloadLink)),
    tag = "Assets"
)]
pub async fn refresh_asset_download(
    State(state): State<AppState>,
    Path(asset_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<DownloadLink>> {
    let service = DocumentsService::new(&state);
    let link = service
        .get_asset_download_link(conn.unscoped(), tenant_id, user_id, asset_id)
        .await?;
    ok_json(link)
}

#[utoipa::path(
    get,
    path = "/api/documents/{id}/versions",
    params(("id" = Uuid, Path, description = "Document ID")),
    responses((status = 200, description = "Document versions", body = [DocumentVersionResponse])),
    tag = "Documents"
)]
pub async fn list_document_versions(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<DocumentVersionResponse>>> {
    let service = DocumentsService::new(&state);
    let versions = conn.scoped(|tx| service.list_document_versions(tx, tenant_id, document_id))?;
    ok_json(versions)
}

#[utoipa::path(
    get,
    path = "/api/documents/{id}/versions/{version_id}",
    params(
        ("id" = Uuid, Path, description = "Document ID"),
        ("version_id" = Uuid, Path, description = "Version ID"),
    ),
    responses((status = 200, description = "Document version detail", body = DocumentVersionDetailResponse)),
    tag = "Documents"
)]
pub async fn get_document_version(
    State(state): State<AppState>,
    Path((document_id, version_id)): Path<(Uuid, Uuid)>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<DocumentVersionDetailResponse>> {
    let service = DocumentsService::new(&state);
    let detail = service
        .get_document_version(conn.unscoped(), tenant_id, user_id, document_id, version_id)
        .await?;
    ok_json(detail)
}

#[utoipa::path(
    get,
    path = "/api/download/{token}",
    params(("token" = String, Path, description = "Download token")),
    responses((status = 200, description = "Proxied download stream or redirect")),
    tag = "Documents"
)]
pub async fn download_with_token(
    State(state): State<AppState>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let claims = state
        .jwt
        .verify_download_token(&token)
        .map_err(|_| AppError::unauthorized())?;

    let mut conn = state.db_for_tenant(claims.tenant_id)?;
    ensure_active_tenant_with_conn(conn.unscoped(), claims.tenant_id)?;

    let now = Utc::now().naive_utc();
    let has_active_refresh: bool = conn.scoped(|tx| {
        select(exists(
            session_dsl::user_sessions
                .filter(session_dsl::user_id.eq(claims.user_id))
                .filter(session_dsl::tenant_id.eq(claims.tenant_id))
                .filter(session_dsl::revoked_at.is_null())
                .filter(session_dsl::expires_at.gt(now)),
        ))
        .get_result(tx)
        .map_err(AppError::from)
    })?;

    if !has_active_refresh {
        return Err(AppError::unauthorized());
    }

    match &claims.subject {
        DownloadSubject::Document { doc_id, version_id } => {
            let doc_id = *doc_id;
            let version_id = *version_id;
            let (doc, version) = conn.scoped(|tx| {
                let doc: Document = documents::table
                    .find(doc_id)
                    .filter(documents::tenant_id.eq(claims.tenant_id))
                    .first(tx)?;
                if doc.deleted_at.is_some() {
                    return Err(AppError::not_found());
                }

                let version: DocumentVersion = document_versions::table
                    .find(version_id)
                    .filter(document_versions::document_id.eq(doc_id))
                    .first(tx)?;

                Ok((doc, version))
            })?;

            drop(conn);

            let storage = state.storage_for_tenant(claims.tenant_id)?;
            let disposition = inline_content_disposition(&doc.filename);

            if !state.config.proxy_downloads {
                let presigned_url = storage
                    .presign_get_object(
                        &version.s3_key,
                        Duration::from_secs(PRESIGNED_URL_EXPIRY_SECONDS),
                        disposition.as_deref(),
                    )
                    .await
                    .storage_context("failed to generate download URL")?;

                return Ok(axum::response::Redirect::temporary(&presigned_url).into_response());
            }

            proxy_storage_object(
                storage,
                &version.s3_key,
                disposition.as_deref(),
                headers.get(header::RANGE).cloned(),
                doc.mime_type.as_deref(),
                Some(version.id.to_string()),
            )
            .await
        }
        DownloadSubject::Asset { asset_id } => {
            let asset: DocumentAsset = conn.scoped(|tx| {
                document_assets::table
                    .find(*asset_id)
                    .filter(document_assets::tenant_id.eq(claims.tenant_id))
                    .first(tx)
                    .map_err(AppError::from)
            })?;

            drop(conn);

            let storage = state.storage_for_tenant(claims.tenant_id)?;
            let disposition = asset_disposition(&asset);

            if !state.config.proxy_downloads {
                let presigned_url = storage
                    .presign_get_object(
                        &asset.s3_key,
                        Duration::from_secs(PRESIGNED_URL_EXPIRY_SECONDS),
                        disposition.as_deref(),
                    )
                    .await
                    .storage_context("failed to generate download URL")?;

                return Ok(axum::response::Redirect::temporary(&presigned_url).into_response());
            }

            proxy_storage_object(
                storage,
                &asset.s3_key,
                disposition.as_deref(),
                headers.get(header::RANGE).cloned(),
                Some(asset.mime_type.as_str()),
                Some(asset.id.to_string()),
            )
            .await
        }
    }
}

#[utoipa::path(
    post,
    path = "/api/documents/{id}/trash",
    params(("id" = Uuid, Path, description = "Document ID")),
    responses((status = 204, description = "Document deleted")),
    tag = "Documents"
)]
pub async fn trash_document(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<impl IntoResponse> {
    let service = DocumentsService::new(&state);
    conn.scoped(|tx| service.trash_document(tx, tenant_id, document_id))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn proxy_storage_object(
    storage: TenantStorage,
    key: &str,
    response_disposition: Option<&str>,
    range_header: Option<HeaderValue>,
    fallback_content_type: Option<&str>,
    etag: Option<String>,
) -> AppResult<Response> {
    let url = storage
        .presign_get_object(
            key,
            Duration::from_secs(PRESIGNED_URL_EXPIRY_SECONDS),
            response_disposition,
        )
        .await
        .storage_context("failed to generate download URL")?;

    let client = reqwest::Client::new();
    let mut request = client.get(url.clone());
    if let Some(range) = range_header {
        request = request.header(header::RANGE, range);
    }

    let upstream = request.send().await.map_err(|err| {
        tracing::error!(error = ?err, "failed to fetch document stream");
        AppError::internal("failed to fetch document stream")
    })?;

    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if !(status.is_success() || status == StatusCode::PARTIAL_CONTENT) {
        tracing::error!(status = %status, "upstream download returned error status");
        return Err(AppError::internal("failed to fetch document stream"));
    }

    let mut builder = Response::builder().status(status);

    if let Some(content_type) = upstream.headers().get(header::CONTENT_TYPE) {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    } else if let Some(fallback) = fallback_content_type {
        builder = builder.header(header::CONTENT_TYPE, fallback);
    }

    if let Some(content_length) = upstream.headers().get(header::CONTENT_LENGTH) {
        builder = builder.header(header::CONTENT_LENGTH, content_length);
    }

    if let Some(range) = upstream.headers().get(header::CONTENT_RANGE) {
        builder = builder.header(header::CONTENT_RANGE, range);
    }

    builder = builder.header("Accept-Ranges", "bytes");

    if let Some(disposition) = response_disposition {
        builder = builder.header(header::CONTENT_DISPOSITION, disposition);
    }

    if let Some(etag_value) = etag {
        builder = builder.header(header::ETAG, format!("\"{}\"", etag_value));
    }

    let stream = upstream
        .bytes_stream()
        .map(|chunk| chunk.map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err)));
    let body = Body::from_stream(stream);

    builder.body(body).map_err(|err| {
        tracing::error!(error = ?err, "failed to build proxied response");
        AppError::internal("failed to build proxied response")
    })
}

#[utoipa::path(
    delete,
    path = "/api/documents/{id}",
    params(("id" = Uuid, Path, description = "Document ID")),
    responses((status = 202, description = "Document purge scheduled")),
    tag = "Documents"
)]
pub async fn delete_document(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<impl IntoResponse> {
    let service = DocumentsService::new(&state);
    conn.scoped(|tx| service.delete_document(tx, tenant_id, document_id))?;

    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(
    patch,
    path = "/api/documents/{id}",
    params(("id" = Uuid, Path, description = "Document ID")),
    request_body = crate::services::documents::UpdateDocumentRequest,
    responses((status = 200, description = "Updated document", body = DocumentDetailResponse)),
    tag = "Documents"
)]
pub async fn update_document(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<Value>,
) -> AppResult<JsonResponse<DocumentDetailResponse>> {
    let service = DocumentsService::new(&state);
    let detail = service
        .update_document(conn.unscoped(), tenant_id, user_id, document_id, payload)
        .await?;
    ok_json(detail)
}

#[utoipa::path(
    post,
    path = "/api/documents/{id}/restore",
    params(("id" = Uuid, Path, description = "Document ID")),
    request_body = RestoreDocumentRequest,
    responses((status = 204, description = "Document restored")),
    tag = "Documents"
)]
pub async fn restore_document(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<RestoreDocumentRequest>,
) -> AppResult<StatusCode> {
    let service = DocumentsService::new(&state);
    conn.scoped(|tx| service.restore_document(tx, tenant_id, document_id, payload.folder_id))?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    patch,
    path = "/api/documents/{id}/folder",
    params(("id" = Uuid, Path, description = "Document ID")),
    request_body = MoveDocumentRequest,
    responses((status = 204, description = "Document moved")),
    tag = "Documents"
)]
pub async fn move_document(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<MoveDocumentRequest>,
) -> AppResult<impl IntoResponse> {
    let service = DocumentsService::new(&state);
    conn.scoped(|tx| service.move_document(tx, tenant_id, document_id, payload.folder_id))?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/documents/bulk/move",
    request_body = BulkMoveRequest,
    responses((status = 200, description = "Bulk move outcome", body = BulkMoveResponse)),
    tag = "Documents"
)]
pub async fn bulk_move_documents(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<BulkMoveRequest>,
) -> AppResult<JsonResponse<BulkMoveResponse>> {
    let BulkMoveRequest {
        document_ids,
        folder_id,
    } = payload;

    let service = DocumentsService::new(&state);
    let updated =
        conn.scoped(|tx| service.bulk_move_documents(tx, tenant_id, document_ids, folder_id))?;
    ok_json(BulkMoveResponse { updated })
}

#[utoipa::path(
    post,
    path = "/api/documents/{id}/correspondents",
    params(("id" = Uuid, Path, description = "Document ID")),
    request_body = AssignCorrespondentsRequest,
    responses((status = 204, description = "Correspondents assigned")),
    tag = "Documents"
)]
pub async fn assign_correspondents(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<AssignCorrespondentsRequest>,
) -> AppResult<StatusCode> {
    let service = CorrespondentsService::new(&state);
    conn.scoped(|tx| service.assign_to_document(tx, tenant_id, user_id, document_id, &payload))?;
    no_content()
}

#[utoipa::path(
    post,
    path = "/api/documents/bulk/correspondents",
    request_body = BulkCorrespondentsRequest,
    responses((status = 200, description = "Bulk correspondents outcome", body = BulkCorrespondentResponse)),
    tag = "Documents"
)]
pub async fn bulk_assign_correspondents(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<BulkCorrespondentsRequest>,
) -> AppResult<JsonResponse<BulkCorrespondentResponse>> {
    let service = CorrespondentsService::new(&state);
    let response = conn.scoped(|tx| service.bulk_update(tx, tenant_id, user_id, payload))?;
    ok_json(response)
}

#[utoipa::path(
    delete,
    path = "/api/documents/{id}/correspondents/{correspondent_id}",
    params(
        ("id" = Uuid, Path, description = "Document ID"),
        ("correspondent_id" = Uuid, Path, description = "Correspondent ID")
    ),
    responses((status = 204, description = "Correspondent removed")),
    tag = "Documents"
)]
pub async fn remove_correspondent(
    State(state): State<AppState>,
    Path((document_id, correspondent_id)): Path<(Uuid, Uuid)>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<StatusCode> {
    let service = CorrespondentsService::new(&state);
    conn.scoped(|tx| service.remove_from_document(tx, tenant_id, document_id, correspondent_id))?;
    no_content()
}

#[utoipa::path(
    post,
    path = "/api/documents/{id}/tags",
    params(("id" = Uuid, Path, description = "Document ID")),
    request_body = AssignTagsRequest,
    responses((status = 204, description = "Tags assigned")),
    tag = "Documents"
)]
pub async fn assign_tags(
    State(state): State<AppState>,
    Path(document_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<AssignTagsRequest>,
) -> AppResult<impl IntoResponse> {
    let service = TagsService::new(&state);
    conn.scoped(|tx| service.assign_to_document(tx, tenant_id, user_id, document_id, &payload.tag_ids))?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/documents/bulk/tags",
    request_body = BulkTagRequest,
    responses((status = 200, description = "Bulk tag outcome", body = BulkTagResponse)),
    tag = "Documents"
)]
pub async fn bulk_update_tags(
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        user_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<BulkTagRequest>,
) -> AppResult<JsonResponse<BulkTagResponse>> {
    let service = TagsService::new(&state);
    let response = conn.scoped(|tx| service.bulk_update(tx, tenant_id, user_id, payload))?;
    ok_json(response)
}

#[utoipa::path(
    delete,
    path = "/api/documents/{id}/tags/{tag_id}",
    params(
        ("id" = Uuid, Path, description = "Document ID"),
        ("tag_id" = Uuid, Path, description = "Tag ID")
    ),
    responses((status = 204, description = "Tag removed")),
    tag = "Documents"
)]
pub async fn remove_tag(
    Path((document_id, tag_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<StatusCode> {
    let service = TagsService::new(&state);
    conn.scoped(|tx| service.remove_from_document(tx, tenant_id, document_id, tag_id))?;
    no_content()
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        crate::routes::documents::list_documents,
        crate::routes::documents::check_document,
        crate::routes::documents::upload_document,
        crate::routes::documents::get_document,
        crate::routes::documents::refresh_document_download,
        crate::routes::documents::update_document,
        crate::routes::documents::trash_document,
        crate::routes::documents::delete_document,
        crate::routes::documents::restore_document,
        crate::routes::documents::download_with_token,
        crate::routes::documents::move_document,
        crate::routes::documents::assign_tags,
        crate::routes::documents::remove_tag,
        crate::routes::documents::bulk_move_documents,
        crate::routes::documents::bulk_update_tags,
        crate::routes::documents::bulk_assign_correspondents,
        crate::routes::documents::assign_correspondents,
        crate::routes::documents::remove_correspondent,
        crate::routes::documents::reanalyze_selected_documents,
        crate::routes::documents::list_document_assets,
        crate::routes::documents::request_document_assets,
        crate::routes::documents::get_document_asset,
        crate::routes::documents::list_document_versions,
        crate::routes::documents::get_document_version,
        crate::routes::documents::refresh_document_version_download,
        crate::routes::documents::refresh_asset_download,
    ),
    components(schemas(
        crate::services::documents::DocumentListQuery,
        crate::services::documents::DocumentStatusFilter,
        crate::routes::documents::AssetRequestQuery,
        crate::routes::documents::DocumentCheckQuery,
        crate::routes::documents::DocumentCheckResponse,
        crate::services::documents::DocumentResponse,
        crate::services::documents::DocumentDetailResponse,
        crate::routes::documents::DocumentMetadataUpdate,
        crate::services::documents::TagResponse,
        crate::routes::documents::CorrespondentAssignmentInput,
        crate::routes::documents::AssignCorrespondentsRequest,
        crate::routes::documents::BulkCorrespondentAction,
        crate::routes::documents::BulkCorrespondentsRequest,
        crate::routes::documents::BulkCorrespondentResponse,
        crate::routes::documents::BulkMoveRequest,
        crate::routes::documents::BulkMoveResponse,
        crate::routes::documents::BulkTagAction,
        crate::routes::documents::BulkTagRequest,
        crate::routes::documents::BulkTagResponse,
        crate::routes::documents::AssignTagsRequest,
        crate::routes::documents::MoveDocumentRequest,
        crate::routes::documents::BulkReanalyzeSelectionRequest,
        crate::routes::documents::BulkReanalyzeResponse,
        crate::routes::documents::UploadDocumentForm,
        crate::documents::asset::DocumentVersionResponse,
        crate::documents::asset::DocumentVersionDetailResponse,
        crate::documents::asset::DocumentAssetResponse,
        crate::documents::asset::DocumentAssetDetailResponse,
        crate::documents::asset::DownloadLink,
        crate::documents::correspondents::DocumentCorrespondentResponse,
        crate::error::ApiErrorResponse,
    ))
)]
pub struct DocumentsApiDoc;
