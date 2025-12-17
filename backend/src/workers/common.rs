use std::collections::HashMap;

use diesel::{prelude::*, PgConnection};
use uuid::Uuid;

use crate::models::{Document, DocumentAsset, DocumentVersion};
use crate::schema::{document_assets, document_versions, documents};
use crate::state::AppState;

pub(crate) struct LoadedDocumentVersion {
    pub document: Document,
    pub version: DocumentVersion,
}

pub(crate) fn load_document_version(
    state: &AppState,
    tenant_id: Uuid,
    document_id: Uuid,
    version_id: Uuid,
) -> Result<LoadedDocumentVersion, String> {
    let mut conn = state
        .db_for_tenant(tenant_id)
        .map_err(|err| format!("{err:?}"))?;

    let version: DocumentVersion = document_versions::table
        .find(version_id)
        .first(&mut conn)
        .map_err(|err| format!("{err:?}"))?;

    if version.document_id != document_id {
        return Err("document/version mismatch".into());
    }

    let document: Document = documents::table
        .find(document_id)
        .first(&mut conn)
        .map_err(|err| format!("{err:?}"))?;

    Ok(LoadedDocumentVersion { document, version })
}

pub struct LoadedAsset {
    pub asset: DocumentAsset,
}

pub(crate) fn load_version_assets(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    version_id: Uuid,
    asset_types: &[&str],
) -> Result<HashMap<String, LoadedAsset>, String> {
    let mut query = document_assets::table
        .filter(document_assets::document_version_id.eq(version_id))
        .filter(document_assets::tenant_id.eq(tenant_id))
        .into_boxed();

    if !asset_types.is_empty() {
        let types: Vec<String> = asset_types.iter().map(|ty| (*ty).to_string()).collect();
        query = query.filter(document_assets::asset_type.eq_any(types));
    }

    let assets: Vec<DocumentAsset> = query
        .order(document_assets::created_at.asc())
        .load(conn)
        .map_err(|err| format!("{err:?}"))?;

    let mut result = HashMap::with_capacity(assets.len());
    for asset in assets {
        result.insert(asset.asset_type.clone(), LoadedAsset { asset });
    }

    Ok(result)
}
