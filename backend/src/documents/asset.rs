use std::collections::HashMap;
use std::path::Path as FsPath;

use chrono::{Duration as ChronoDuration, Utc};
use diesel::prelude::*;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{Document, DocumentAsset, DocumentVersion};
use crate::schema::{document_assets, document_versions};
use crate::state::{AppState, PgPooledConnection};
use crate::utils::{http::inline_content_disposition, time::to_iso};

#[derive(Serialize, Clone, ToSchema)]
pub struct DownloadLink {
    pub url: String,
    pub expires_at: i64,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct DocumentAssetResponse {
    pub id: Uuid,
    pub asset_type: String,
    pub mime_type: String,
    #[schema(value_type = Object)]
    pub metadata: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub download: Option<DownloadLink>,
}

#[derive(Serialize, ToSchema)]
pub struct DocumentAssetDetailResponse {
    pub id: Uuid,
    pub asset_type: String,
    pub mime_type: String,
    #[schema(value_type = Object)]
    pub metadata: Value,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub download: Option<DownloadLink>,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct DocumentVersionResponse {
    pub id: Uuid,
    pub version_number: i32,
    pub size_bytes: i64,
    pub checksum: String,
    pub created_at: String,
    #[schema(value_type = Object)]
    pub metadata: Value,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct DocumentVersionDetailResponse {
    #[serde(flatten)]
    pub version: DocumentVersionResponse,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<DocumentAssetResponse>,
    pub download: DownloadLink,
}

pub fn build_download_link(
    state: &AppState,
    document: &Document,
    version_id: Uuid,
    user_id: Uuid,
) -> AppResult<DownloadLink> {
    state
        .jwt
        .generate_download_token(document.id, version_id, user_id, document.tenant_id)
        .map_err(|err| {
            tracing::error!(error = ?err, "failed to generate download token");
            AppError::internal("failed to generate download token")
        })
        .and_then(|token| {
            let expires_at = Utc::now()
                .checked_add_signed(ChronoDuration::minutes(
                    state.config.download_token_expiry_minutes,
                ))
                .ok_or_else(|| AppError::internal("failed to compute download expiry"))?
                .timestamp_millis();

            Ok(DownloadLink {
                url: format!("/api/download/{token}"),
                expires_at,
            })
        })
}

pub fn to_version_response(version: DocumentVersion) -> DocumentVersionResponse {
    DocumentVersionResponse {
        id: version.id,
        version_number: version.version_number,
        size_bytes: version.size_bytes,
        checksum: version.checksum,
        created_at: to_iso(version.created_at),
        metadata: version.metadata,
    }
}

pub fn to_asset_summary(asset: DocumentAsset) -> DocumentAssetResponse {
    DocumentAssetResponse {
        id: asset.id,
        asset_type: asset.asset_type,
        mime_type: asset.mime_type,
        metadata: asset.metadata,
        download: None,
    }
}

pub fn to_asset_detail_response(
    asset: DocumentAsset,
    download: Option<DownloadLink>,
) -> DocumentAssetDetailResponse {
    DocumentAssetDetailResponse {
        id: asset.id,
        asset_type: asset.asset_type,
        mime_type: asset.mime_type,
        metadata: asset.metadata,
        created_at: to_iso(asset.created_at),
        download,
    }
}

pub fn asset_disposition(asset: &DocumentAsset) -> Option<String> {
    let filename = asset.asset_type.clone();
    inline_content_disposition(&filename)
}

pub fn delete_asset(
    conn: &mut PgPooledConnection,
    tenant_id: Uuid,
    asset_id: Uuid,
) -> AppResult<()> {
    diesel::delete(
        document_assets::table
            .filter(document_assets::id.eq(asset_id))
            .filter(document_assets::tenant_id.eq(tenant_id)),
    )
    .execute(conn)?;

    Ok(())
}

pub fn load_asset_responses_with_conn(
    conn: &mut PgPooledConnection,
    tenant_id: Uuid,
    version_id: Uuid,
) -> AppResult<Vec<DocumentAssetResponse>> {
    let assets: Vec<DocumentAsset> = document_assets::table
        .filter(document_assets::document_version_id.eq(version_id))
        .filter(document_assets::tenant_id.eq(tenant_id))
        .order(document_assets::created_at.asc())
        .load(conn)?;

    Ok(assets.into_iter().map(to_asset_summary).collect())
}

pub fn load_primary_assets(
    conn: &mut PgPooledConnection,
    documents: &[Document],
) -> AppResult<HashMap<Uuid, (DocumentVersionResponse, Vec<DocumentAssetResponse>)>> {
    if documents.is_empty() {
        return Ok(HashMap::new());
    }

    let mut doc_to_version: HashMap<Uuid, Uuid> = HashMap::with_capacity(documents.len());
    let mut version_ids: Vec<Uuid> = Vec::with_capacity(documents.len());
    for doc in documents {
        doc_to_version.insert(doc.id, doc.current_version_id);
        version_ids.push(doc.current_version_id);
    }

    version_ids.sort();
    version_ids.dedup();

    let versions: Vec<DocumentVersion> = document_versions::table
        .filter(document_versions::id.eq_any(&version_ids))
        .load(conn)?;

    let mut version_map: HashMap<Uuid, DocumentVersion> = HashMap::new();
    for version in versions {
        version_map.insert(version.id, version);
    }

    let assets: Vec<DocumentAsset> = document_assets::table
        .filter(document_assets::document_version_id.eq_any(&version_ids))
        .order((
            document_assets::document_version_id.asc(),
            document_assets::created_at.asc(),
        ))
        .load(conn)?;

    let mut assets_by_version: HashMap<Uuid, Vec<DocumentAssetResponse>> = HashMap::new();
    for asset in assets {
        let version_id = asset.document_version_id;
        let response = to_asset_summary(asset);
        assets_by_version
            .entry(version_id)
            .or_default()
            .push(response);
    }

    let mut result: HashMap<Uuid, (DocumentVersionResponse, Vec<DocumentAssetResponse>)> =
        HashMap::with_capacity(doc_to_version.len());
    for (doc_id, version_id) in doc_to_version {
        if let Some(version) = version_map.remove(&version_id) {
            let assets = assets_by_version.remove(&version_id).unwrap_or_default();
            result.insert(doc_id, (to_version_response(version), assets));
        }
    }

    Ok(result)
}

pub fn derive_document_title(original: &str) -> String {
    let trimmed = original.trim();
    if trimmed.is_empty() {
        return "Document".to_string();
    }

    let stem = FsPath::new(trimmed)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    stem.unwrap_or_else(|| trimmed.to_string())
}

pub fn filename_with_retained_extension(title: &str, current_filename: &str) -> String {
    let extension = FsPath::new(current_filename)
        .extension()
        .and_then(|ext| ext.to_str());

    if let Some(ext) = extension {
        if title
            .rsplit_once('.')
            .map(|(_, existing_ext)| existing_ext.eq_ignore_ascii_case(ext))
            .unwrap_or(false)
        {
            title.to_string()
        } else {
            format!("{title}.{ext}")
        }
    } else {
        title.to_string()
    }
}
