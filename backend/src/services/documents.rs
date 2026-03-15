use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration as ChronoDuration, NaiveDateTime, Utc};
use diesel::{
    dsl::{exists, not, sql},
    prelude::*,
    result::DatabaseErrorKind,
    sql_types::Text,
    Connection,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tracing::{debug, error, info, warn};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::documents::{
    asset::{
        build_download_link, derive_document_title, filename_with_retained_extension,
        to_asset_detail_response, to_version_response, DocumentAssetDetailResponse,
        DocumentAssetResponse, DocumentVersionDetailResponse, DocumentVersionResponse,
        DownloadLink,
    },
    correspondents::{
        insert_document_correspondents, normalize_correspondent_ids, DocumentCorrespondentResponse,
    },
    folders::ensure_folder_exists_on_conn,
    metadata::merge_document_metadata,
    ordering::{ordering_clauses, DocumentSortField, SortDirection},
    relations::load_tags_and_correspondents,
    search::quickwit_search,
    tags::assign_tags as assign_tags_to_document,
};
use crate::error::{AppError, AppResult};
use crate::jobs::{enqueue_job, enqueue_job_if_not_exists, JOB_ANALYZE_DOCUMENT, JOB_PURGE_DOCUMENT};
use crate::models::{
    Document, DocumentAsset, DocumentVersion, NewDocument, NewDocumentVersion, Tag,
};
use crate::schema::{
    document_assets, document_correspondents, document_tags, document_versions, documents, folders,
};
use crate::services::{
    correspondents::CorrespondentAssignmentInput, folders::gather_descendant_folder_ids,
    helpers::load_active_document,
};
use crate::state::AppState;
use crate::utils::{
    db::validate_bulk_ids, error::StorageResultExt, http::inline_content_disposition,
    json::classify_nullable, json::NullableValue, setops::intersect_option_sets,
    setops::load_linked_doc_ids, storage_paths::document_version_object_key, time::to_iso,
};

#[derive(Deserialize, IntoParams, ToSchema, Clone)]
#[into_params(parameter_in = Query)]
pub struct DocumentListQuery {
    #[schema(nullable)]
    pub folder_id: Option<Uuid>,
    #[serde(default)]
    #[schema(nullable)]
    pub include_descendants: Option<bool>,
    pub query: Option<String>,
    pub tags: Option<String>,
    pub correspondents: Option<String>,
    #[serde(default = "default_document_status_filter")]
    #[schema(default = "active")]
    pub status: DocumentStatusFilter,
    #[serde(default)]
    #[schema(default = "title")]
    pub sort: DocumentSortField,
    #[serde(default)]
    #[schema(default = "asc")]
    pub dir: SortDirection,
}

fn default_document_status_filter() -> DocumentStatusFilter {
    DocumentStatusFilter::Active
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DocumentStatusFilter {
    Active,
    Deleted,
    All,
}

#[derive(Serialize, ToSchema)]
pub struct TagResponse {
    pub id: Uuid,
    pub label: String,
    #[schema(nullable)]
    pub color: Option<String>,
}

impl From<Tag> for TagResponse {
    fn from(tag: Tag) -> Self {
        Self {
            id: tag.id,
            label: tag.label,
            color: tag.color,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct DocumentCheckResponse {
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub document_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub version_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub version_number: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub created_at: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct DocumentResponse {
    pub id: Uuid,
    pub filename: String,
    pub title: String,
    pub original_name: String,
    #[schema(nullable)]
    pub mime_type: Option<String>,
    #[schema(nullable)]
    pub folder_id: Option<Uuid>,
    pub created_at: String,
    pub updated_at: String,
    #[schema(nullable)]
    pub deleted_at: Option<String>,
    #[schema(nullable)]
    pub issued_at: Option<String>,
    #[schema(value_type = Object)]
    pub metadata: Value,
    pub tags: Vec<TagResponse>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub correspondents: Vec<DocumentCorrespondentResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(nullable)]
    pub current_version: Option<DocumentVersionDetailResponse>,
}

#[derive(Serialize, ToSchema)]
pub struct DocumentDetailResponse {
    pub document: DocumentResponse,
}

#[derive(Deserialize, ToSchema)]
pub struct DocumentMetadataUpdate {
    #[schema(value_type = Object)]
    pub value: Value,
    #[serde(default)]
    #[schema(default = false)]
    pub replace: bool,
}

#[derive(Default, AsChangeset)]
#[diesel(table_name = documents)]
struct DocumentUpdateChangeset {
    title: Option<String>,
    filename: Option<String>,
    issued_at: Option<Option<NaiveDateTime>>,
    metadata: Option<Value>,
    updated_at: Option<NaiveDateTime>,
}

struct DocumentUpdatePlan {
    changeset: DocumentUpdateChangeset,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateDocumentRequest {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    #[schema(nullable, value_type = Option<String>)]
    pub issued_at: Option<Value>,
    #[serde(default)]
    #[schema(nullable, value_type = Object)]
    pub metadata: Option<DocumentMetadataUpdate>,
}

#[derive(Deserialize, ToSchema)]
pub struct BulkMoveRequest {
    pub document_ids: Vec<Uuid>,
    #[schema(nullable)]
    pub folder_id: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub struct BulkMoveResponse {
    pub updated: usize,
}

#[derive(Deserialize, ToSchema)]
pub struct BulkReanalyzeSelectionRequest {
    pub document_ids: Vec<Uuid>,
    #[serde(default = "default_true")]
    #[schema(default = true)]
    pub force: bool,
}

#[derive(Serialize, ToSchema)]
pub struct BulkReanalyzeResponse {
    pub queued: usize,
}

fn default_true() -> bool {
    true
}

pub struct DocumentUploadRequest {
    pub bytes: Vec<u8>,
    pub original_name: String,
    pub mime_type: Option<String>,
    pub folder_id: Option<Uuid>,
    pub metadata: Value,
    pub title_override: Option<String>,
    pub tag_ids: Vec<Uuid>,
    pub correspondents: Vec<CorrespondentAssignmentInput>,
    pub issued_at_override: Option<NaiveDateTime>,
    pub skip_if_existing: bool,
}

pub enum DocumentUploadOutcome {
    Created(DocumentDetailResponse),
    Reused(DocumentDetailResponse),
}

pub struct DocumentsService<'a> {
    state: &'a AppState,
}

impl<'a> DocumentsService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    fn build_document_update_plan(
        document: &Document,
        payload: &Map<String, Value>,
    ) -> AppResult<DocumentUpdatePlan> {
        let title = match payload.get("title") {
            None | Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.clone()),
            Some(_) => return Err(AppError::bad_request("title must be a string")),
        };

        let issued_at_class =
            classify_nullable(payload.get("issued_at")).map_err(AppError::bad_request)?;

        let metadata = match payload.get("metadata") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                serde_json::from_value::<DocumentMetadataUpdate>(value.clone()).map_err(|err| {
                    AppError::bad_request(format!("invalid metadata payload: {err}"))
                })?,
            ),
        };

        let mut changes = DocumentUpdateChangeset::default();
        let mut has_changes = false;

        if let Some(ref candidate) = title {
            let trimmed = candidate.trim();
            if trimmed.is_empty() {
                return Err(AppError::bad_request("title must not be empty"));
            }
            if trimmed != document.title {
                let new_title = trimmed.to_string();
                let new_filename = filename_with_retained_extension(&new_title, &document.filename);
                changes.title = Some(new_title);
                if new_filename != document.filename {
                    changes.filename = Some(new_filename);
                }
                has_changes = true;
            }
        }

        match issued_at_class {
            NullableValue::Omitted => {}
            NullableValue::Null => {
                if document.issued_at.is_some() {
                    changes.issued_at = Some(None);
                    has_changes = true;
                }
            }
            NullableValue::String(raw) => {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    return Err(AppError::bad_request("issued_at must not be empty"));
                }
                let parsed = DateTime::parse_from_rfc3339(trimmed).map_err(|err| {
                    let msg = format!("issued_at must be an RFC3339 timestamp: {err}");
                    AppError::bad_request(msg)
                })?;
                let normalized = Some(parsed.naive_utc());
                if document.issued_at != normalized {
                    changes.issued_at = Some(normalized);
                    has_changes = true;
                }
            }
        }

        if let Some(metadata_update) = metadata {
            let next_metadata = if metadata_update.replace {
                metadata_update.value
            } else {
                merge_document_metadata(document.metadata.clone(), metadata_update.value)?
            };

            if document.metadata != next_metadata {
                changes.metadata = Some(next_metadata);
                has_changes = true;
            }
        }

        if !has_changes {
            return Err(AppError::bad_request("no changes provided"));
        }

        Ok(DocumentUpdatePlan {
            changeset: changes,
        })
    }

    pub async fn get_document_detail(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
    ) -> AppResult<DocumentDetailResponse> {
        let doc = load_active_document(conn, tenant_id, document_id)?;

        let current_version: DocumentVersion = document_versions::table
            .find(doc.current_version_id)
            .first(conn)?;

        let tags_and_correspondents = load_tags_and_correspondents(conn, &[document_id])?;
        let (tags, correspondents) = tags_and_correspondents
            .get(&document_id)
            .cloned()
            .unwrap_or_else(|| (Vec::new(), Vec::new()));

        let assets = self.load_asset_responses(conn, tenant_id, current_version.id, user_id)?;
        let download = build_download_link(self.state, &doc, current_version.id, user_id)?;
        let current_version_data = Some((to_version_response(current_version), assets, download));

        let response =
            self.to_document_response(user_id, doc, tags, correspondents, current_version_data)?;

        Ok(DocumentDetailResponse { document: response })
    }

    pub fn check_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        checksum_hex: &str,
    ) -> AppResult<DocumentCheckResponse> {
        let record: Option<(Document, DocumentVersion)> = documents::table
            .inner_join(
                document_versions::table
                    .on(document_versions::id.eq(documents::current_version_id)),
            )
            .filter(documents::tenant_id.eq(tenant_id))
            .filter(document_versions::checksum.eq(checksum_hex))
            .select((documents::all_columns, document_versions::all_columns))
            .first::<(Document, DocumentVersion)>(conn)
            .optional()?;

        if let Some((document, version)) = record {
            Ok(DocumentCheckResponse {
                exists: true,
                document_id: Some(document.id),
                title: Some(document.title),
                filename: Some(document.filename),
                version_id: Some(version.id),
                version_number: Some(version.version_number),
                created_at: Some(to_iso(document.created_at)),
            })
        } else {
            Ok(DocumentCheckResponse {
                exists: false,
                document_id: None,
                title: None,
                filename: None,
                version_id: None,
                version_number: None,
                created_at: None,
            })
        }
    }

    pub async fn list_documents(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        params: DocumentListQuery,
    ) -> AppResult<Vec<DocumentResponse>> {
        let DocumentListQuery {
            folder_id,
            include_descendants,
            query,
            tags,
            correspondents,
            status,
            sort,
            dir,
        } = params;

        let mut docs_query = documents::table
            .filter(documents::tenant_id.eq(tenant_id))
            .into_boxed();

        match status {
            DocumentStatusFilter::Active => {
                docs_query = docs_query.filter(documents::deleted_at.is_null());
            }
            DocumentStatusFilter::Deleted => {
                docs_query = docs_query.filter(documents::deleted_at.is_not_null());
            }
            DocumentStatusFilter::All => {}
        }

        let search_text = query
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_owned());
        let tags_param = tags
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_owned());
        let correspondents_param = correspondents
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_owned());
        let include_descendants = include_descendants.unwrap_or(true);

        match (folder_id, include_descendants) {
            (Some(folder_id), true) => {
                let descendant_ids = gather_descendant_folder_ids(conn, tenant_id, folder_id)?;
                docs_query = docs_query.filter(documents::folder_id.eq_any(descendant_ids));
            }
            (Some(folder_id), false) => {
                docs_query = docs_query.filter(documents::folder_id.eq(Some(folder_id)));
            }
            (None, false) => {
                docs_query = docs_query.filter(documents::folder_id.is_null());
            }
            (None, true) => {}
        }

        let mut filter_ids: Option<HashSet<Uuid>> = None;
        let mut quickwit_order: Option<Vec<Uuid>> = None;

        if let Some(query_str) = search_text.as_ref() {
            debug!(query = %query_str, "performing hybrid document search");
            
            // 1. Quickwit Search
            let endpoint = self
                .state
                .config
                .quickwit_endpoint
                .as_ref()
                .ok_or_else(|| AppError::internal("quickwit endpoint not configured"))?;
            let tenant = self.state.tenants.get_by_id(tenant_id)?;
            let index = tenant
                .quickwit_index
                .as_ref()
                .ok_or_else(|| AppError::internal("quickwit index not configured for tenant"))?;

            let quickwit_ids = quickwit_search(endpoint, index, tenant_id, query_str)
                .await
                .map_err(|err| {
                    error!(error = ?err, "quickwit search failed");
                    AppError::internal("quickwit search failed")
                })?;

            // 2. Postgres Title Search
            let postgres_ids: Vec<Uuid> = documents::table
                .filter(documents::tenant_id.eq(tenant_id))
                .filter(documents::deleted_at.is_null())
                .filter(documents::title.ilike(format!("%{}%", query_str)))
                .select(documents::id)
                .load(conn)?;

            // 3. Combine Results
            let mut combined_ids = quickwit_ids.clone();
            let quickwit_set: HashSet<Uuid> = quickwit_ids.iter().cloned().collect();
            
            for id in postgres_ids {
                if !quickwit_set.contains(&id) {
                    combined_ids.push(id);
                }
            }

            if combined_ids.is_empty() {
                return Ok(Vec::new());
            }

            quickwit_order = Some(combined_ids.clone());
            let set: HashSet<Uuid> = combined_ids.into_iter().collect();
            filter_ids = intersect_option_sets(filter_ids, set);
        }

        if let Some(tags_param) = tags_param.as_ref() {
            if tags_param.trim().eq_ignore_ascii_case("none") {
                let docs_without_tags: Vec<Uuid> = documents::table
                    .filter(documents::tenant_id.eq(tenant_id))
                    .filter(documents::deleted_at.is_null())
                    .filter(not(exists(
                        document_tags::table.filter(document_tags::document_id.eq(documents::id)),
                    )))
                    .select(documents::id)
                    .load(conn)?;

                let docs_set: HashSet<Uuid> = docs_without_tags.into_iter().collect();

                if docs_set.is_empty() {
                    return Ok(Vec::new());
                }

                filter_ids = intersect_option_sets(filter_ids, docs_set);
            } else {
                let tag_ids: Result<Vec<Uuid>, _> = tags_param
                    .split(',')
                    .map(|s| Uuid::parse_str(s.trim()))
                    .collect();

                if let Ok(ids) = tag_ids {
                    if !ids.is_empty() {
                        let matching_doc_ids = load_linked_doc_ids(conn, &ids, |conn, tag_id| {
                            let docs_for_tag: Vec<Uuid> = document_tags::table
                                .filter(document_tags::tag_id.eq(tag_id))
                                .select(document_tags::document_id)
                                .load(conn)
                                .map_err(AppError::from)?;
                            Ok(docs_for_tag.into_iter().collect())
                        })?;

                        if matching_doc_ids.is_empty() {
                            return Ok(Vec::new());
                        }

                        filter_ids = intersect_option_sets(filter_ids, matching_doc_ids);
                    }
                }
            }
        }

        if let Some(correspondents_param) = correspondents_param.as_ref() {
            let correspondent_ids: Result<Vec<Uuid>, _> = correspondents_param
                .split(',')
                .map(|s| Uuid::parse_str(s.trim()))
                .collect();

            if let Ok(ids) = correspondent_ids {
                if !ids.is_empty() {
                    let matching_doc_ids =
                        load_linked_doc_ids(conn, &ids, |conn, correspondent_id| {
                            let docs_for_correspondent: Vec<Uuid> = document_correspondents::table
                                .filter(
                                    document_correspondents::correspondent_id.eq(correspondent_id),
                                )
                                .select(document_correspondents::document_id)
                                .load(conn)
                                .map_err(AppError::from)?;
                            Ok(docs_for_correspondent.into_iter().collect())
                        })?;

                    if matching_doc_ids.is_empty() {
                        return Ok(Vec::new());
                    }

                    filter_ids = intersect_option_sets(filter_ids, matching_doc_ids);
                }
            }
        }

        if let Some(filter_ids) = filter_ids {
            docs_query = docs_query.filter(documents::id.eq_any(filter_ids));
        }

        let (primary_sql, secondary_sql) = ordering_clauses(sort, dir);
        docs_query = docs_query.order(sql::<Text>(primary_sql));
        if let Some(second) = secondary_sql {
            docs_query = docs_query.then_order_by(sql::<Text>(second));
        }

        let docs: Vec<Document> = docs_query.load(conn)?;
        let mut responses = self.hydrate_documents(conn, tenant_id, user_id, docs)?;

        if let Some(order) = quickwit_order {
             let order_map: HashMap<Uuid, usize> = order
                .into_iter()
                .enumerate()
                .map(|(idx, id)| (id, idx))
                .collect();
            responses.sort_by_key(|doc| order_map.get(&doc.id).copied().unwrap_or(usize::MAX));
        }

        Ok(responses)
    }

    pub fn hydrate_documents(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        docs: Vec<Document>,
    ) -> AppResult<Vec<DocumentResponse>> {
        if docs.is_empty() {
            return Ok(Vec::new());
        }

        let doc_ids: Vec<Uuid> = docs.iter().map(|doc| doc.id).collect();
        let mut relations = load_tags_and_correspondents(conn, &doc_ids)?;
        let mut doc_to_version: HashMap<Uuid, Uuid> = HashMap::with_capacity(doc_ids.len());
        let mut version_ids: Vec<Uuid> = Vec::with_capacity(doc_ids.len());
        for doc in &docs {
            doc_to_version.insert(doc.id, doc.current_version_id);
            version_ids.push(doc.current_version_id);
        }

        version_ids.sort();
        version_ids.dedup();

        let versions: Vec<DocumentVersion> = document_versions::table
            .filter(document_versions::id.eq_any(&version_ids))
            .filter(document_versions::tenant_id.eq(tenant_id))
            .load(conn)?;

        let mut version_map: HashMap<Uuid, DocumentVersion> = HashMap::new();
        for version in versions {
            version_map.insert(version.id, version);
        }

        let assets: Vec<DocumentAsset> = document_assets::table
            .filter(document_assets::document_version_id.eq_any(&version_ids))
            .filter(document_assets::tenant_id.eq(tenant_id))
            .order((
                document_assets::document_version_id.asc(),
                document_assets::created_at.asc(),
            ))
            .load(conn)?;

        let mut assets_by_version: HashMap<Uuid, Vec<DocumentAssetResponse>> = HashMap::new();
        for asset in assets {
            let version_id = asset.document_version_id;
            let response = self.asset_response(asset, tenant_id, user_id)?;
            assets_by_version
                .entry(version_id)
                .or_default()
                .push(response);
        }

        docs.into_iter()
            .map(|doc| {
                let (tags, correspondents) = relations
                    .remove(&doc.id)
                    .unwrap_or_else(|| (Vec::new(), Vec::new()));
                let current_version = doc_to_version
                    .get(&doc.id)
                    .and_then(|version_id| version_map.remove(version_id))
                    .map(|version| -> AppResult<_> {
                        let assets = assets_by_version.remove(&version.id).unwrap_or_default();
                        let download = build_download_link(self.state, &doc, version.id, user_id)?;
                        Ok((to_version_response(version), assets, download))
                    })
                    .transpose()?;
                self.to_document_response(user_id, doc, tags, correspondents, current_version)
            })
            .collect()
    }

    pub async fn upload_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        request: DocumentUploadRequest,
    ) -> AppResult<DocumentUploadOutcome> {
        let DocumentUploadRequest {
            bytes,
            original_name,
            mime_type,
            folder_id,
            metadata,
            title_override,
            tag_ids,
            correspondents,
            issued_at_override,
            skip_if_existing,
        } = request;

        if let Some(folder) = folder_id {
            ensure_folder_exists_on_conn(conn, tenant_id, folder)?;
        }

        let doc_id = Uuid::new_v4();
        let version_id = Uuid::new_v4();
        let version_number = 1;
        let derived_title = title_override
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .unwrap_or_else(|| derive_document_title(&original_name));
        let stored_filename = filename_with_retained_extension(&derived_title, &original_name);

        let checksum = Sha256::digest(&bytes);
        let checksum_hex = hex::encode(checksum);
        let size_bytes = bytes.len() as i64;
        let s3_key = document_version_object_key(doc_id, version_number, version_id);

        if let Some(reused) = self
            .try_reuse_existing_document(
                conn,
                tenant_id,
                user_id,
                &checksum_hex,
                issued_at_override,
                skip_if_existing,
                &tag_ids,
                &correspondents,
            )
            .await?
        {
            return Ok(DocumentUploadOutcome::Reused(reused));
        }

        let content_disposition = inline_content_disposition(&stored_filename);

        let storage = self.state.storage_for_tenant(tenant_id)?;

        storage
            .put_object(
                &s3_key,
                bytes.clone(),
                mime_type.clone(),
                content_disposition.clone(),
            )
            .await
            .storage_context("failed to store document")?;

        let metadata_value = if metadata.is_null() {
            Value::Object(Default::default())
        } else {
            metadata
        };

        let (document, version) = match conn.transaction(|conn| {
            let new_document = NewDocument {
                id: doc_id,
                filename: stored_filename.clone(),
                original_name: original_name.clone(),
                mime_type: mime_type.clone(),
                folder_id,
                current_version_id: version_id,
                metadata: metadata_value.clone(),
                issued_at: issued_at_override,
                title: derived_title.clone(),
                tenant_id,
            };
            diesel::insert_into(documents::table)
                .values(&new_document)
                .execute(conn)?;

            let new_version = NewDocumentVersion {
                id: version_id,
                document_id: doc_id,
                version_number,
                s3_key: s3_key.clone(),
                size_bytes,
                checksum: checksum_hex.clone(),
                metadata: Value::Object(Default::default()),
                tenant_id,
            };

            diesel::insert_into(document_versions::table)
                .values(&new_version)
                .execute(conn)?;

            let document: Document = documents::table.find(doc_id).first(conn)?;
            let version: DocumentVersion = document_versions::table.find(version_id).first(conn)?;

            Ok::<_, diesel::result::Error>((document, version))
        }) {
            Ok(result) => result,
            Err(diesel::result::Error::DatabaseError(DatabaseErrorKind::UniqueViolation, _)) => {
                return Err(AppError::conflict(
                    "another document in this folder already uses that filename",
                )
                .with_code("duplicate_filename"))
            }
            Err(err) => return Err(AppError::from(err)),
        };

        let detail = {
            assign_tags_to_document(conn, tenant_id, &document, &tag_ids, Some(user_id))?;

            if !correspondents.is_empty() {
                let raw_ids: Vec<Uuid> = correspondents
                    .iter()
                    .map(|assignment| assignment.correspondent_id)
                    .collect();
                let correspondent_ids = normalize_correspondent_ids(&raw_ids)?;
                insert_document_correspondents(
                    conn,
                    tenant_id,
                    document.id,
                    user_id,
                    &correspondent_ids,
                )?;
            }

            let tags_and_correspondents = load_tags_and_correspondents(conn, &[doc_id])?;
            let (tags, correspondents) = tags_and_correspondents
                .get(&doc_id)
                .cloned()
                .unwrap_or_else(|| (Vec::new(), Vec::new()));

            let download = build_download_link(self.state, &document, version.id, user_id)?;

            DocumentDetailResponse {
                document: self.to_document_response(
                    user_id,
                    document,
                    tags,
                    correspondents,
                    Some((to_version_response(version.clone()), Vec::new(), download)),
                )?,
            }
        };

        if let Err(err) = enqueue_job(
            conn,
            tenant_id,
            JOB_ANALYZE_DOCUMENT,
            json!({
                "document_id": doc_id,
                "document_version_id": version.id,
                "force": false,
            }),
            None,
        ) {
            warn!(document_id = %doc_id, error = %err, "failed to enqueue analyze job");
        }

        Ok(DocumentUploadOutcome::Created(detail))
    }

    pub fn request_document_assets(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        document_id: Uuid,
        force: bool,
    ) -> AppResult<()> {
        let document = load_active_document(conn, tenant_id, document_id)?;

        enqueue_job(
            conn,
            tenant_id,
            JOB_ANALYZE_DOCUMENT,
            json!({
                "document_id": document_id,
                "document_version_id": document.current_version_id,
                "force": force,
            }),
            None,
        )
        .map_err(|err| {
            error!(error = ?err, "failed to enqueue analyze job");
            AppError::internal("failed to enqueue analyze job")
        })?;

        Ok(())
    }

    pub fn reanalyze_documents(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        document_ids: &mut Vec<Uuid>,
        force: bool,
    ) -> AppResult<usize> {
        validate_bulk_ids(document_ids, "document_ids")?;

        let targets: Vec<(Uuid, Uuid)> = documents::table
            .filter(documents::id.eq_any(&*document_ids))
            .filter(documents::deleted_at.is_null())
            .filter(documents::tenant_id.eq(tenant_id))
            .select((documents::id, documents::current_version_id))
            .load(conn)?;

        if targets.len() != document_ids.len() {
            return Err(AppError::bad_request(
                "one or more documents do not exist or are inaccessible",
            ));
        }

        let mut queued = 0usize;
        for (document_id, version_id) in targets {
            enqueue_job(
                conn,
                tenant_id,
                JOB_ANALYZE_DOCUMENT,
                json!({
                    "document_id": document_id,
                    "document_version_id": version_id,
                    "force": force,
                }),
                None,
            )
            .map_err(|err| {
                error!(error = ?err, "failed to enqueue analyze job");
                AppError::internal("failed to enqueue analyze job")
            })?;
            queued += 1;
        }

        Ok(queued)
    }

    pub async fn list_document_assets(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
    ) -> AppResult<Vec<DocumentAssetResponse>> {
        let document = load_active_document(conn, tenant_id, document_id)?;

        let version_id = document.current_version_id;
        let assets = document_assets::table
            .filter(document_assets::document_version_id.eq(version_id))
            .filter(document_assets::tenant_id.eq(tenant_id))
            .order(document_assets::created_at.asc())
            .load::<DocumentAsset>(conn)?;

        let mut responses = Vec::with_capacity(assets.len());
        for asset in assets {
            responses.push(self.asset_response(asset, tenant_id, user_id)?);
        }

        Ok(responses)
    }

    pub async fn get_document_asset(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        asset_id: Uuid,
    ) -> AppResult<DocumentAssetDetailResponse> {
        let asset: DocumentAsset = match document_assets::table
            .find(asset_id)
            .filter(document_assets::tenant_id.eq(tenant_id))
            .first(conn)
            .optional()?
        {
            Some(asset) => asset,
            None => return Err(AppError::not_found()),
        };



        let download = self.asset_download_link(asset.id, tenant_id, user_id)?;

        Ok(to_asset_detail_response(asset, Some(download)))
    }

    pub async fn get_document_download_link(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
    ) -> AppResult<DownloadLink> {
        let document = load_active_document(conn, tenant_id, document_id)?;
        let version: DocumentVersion = document_versions::table
            .find(document.current_version_id)
            .filter(document_versions::tenant_id.eq(tenant_id))
            .first(conn)?;

        build_download_link(self.state, &document, version.id, user_id)
    }

    pub async fn get_document_version_download_link(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
        version_id: Uuid,
    ) -> AppResult<DownloadLink> {
        let document = load_active_document(conn, tenant_id, document_id)?;

        let version: Option<DocumentVersion> = document_versions::table
            .find(version_id)
            .filter(document_versions::document_id.eq(document_id))
            .filter(document_versions::tenant_id.eq(tenant_id))
            .first(conn)
            .optional()?;

        let Some(version) = version else {
            return Err(AppError::not_found());
        };

        build_download_link(self.state, &document, version.id, user_id)
    }

    pub async fn get_asset_download_link(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        asset_id: Uuid,
    ) -> AppResult<DownloadLink> {
        let asset: Option<DocumentAsset> = document_assets::table
            .find(asset_id)
            .filter(document_assets::tenant_id.eq(tenant_id))
            .first(conn)
            .optional()?;

        let Some(asset) = asset else {
            return Err(AppError::not_found());
        };

        self.asset_download_link(asset.id, tenant_id, user_id)
    }

    pub fn list_document_versions(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        document_id: Uuid,
    ) -> AppResult<Vec<DocumentVersionResponse>> {
        load_active_document(conn, tenant_id, document_id)?;

        let versions: Vec<DocumentVersion> = document_versions::table
            .filter(document_versions::document_id.eq(document_id))
            .filter(document_versions::tenant_id.eq(tenant_id))
            .order(document_versions::version_number.asc())
            .load(conn)?;

        Ok(versions.into_iter().map(to_version_response).collect())
    }

    pub async fn get_document_version(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
        version_id: Uuid,
    ) -> AppResult<DocumentVersionDetailResponse> {
        let document = load_active_document(conn, tenant_id, document_id)?;

        let version: DocumentVersion = document_versions::table
            .find(version_id)
            .filter(document_versions::document_id.eq(document_id))
            .filter(document_versions::tenant_id.eq(tenant_id))
            .first(conn)?;

        let assets = self.load_asset_responses(conn, tenant_id, version.id, user_id)?;
        let download = build_download_link(self.state, &document, version.id, user_id)?;
        let version_core = to_version_response(version);

        Ok(DocumentVersionDetailResponse {
            version: version_core,
            assets,
            download,
        })
    }

    pub fn trash_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        document_id: Uuid,
    ) -> AppResult<()> {
        conn.transaction::<_, AppError, _>(|conn| {
            let document: Document = documents::table
                .find(document_id)
                .filter(documents::tenant_id.eq(tenant_id))
                .for_update()
                .first(conn)
                .optional()?
                .ok_or_else(AppError::not_found)?;

            if document.deleted_at.is_some() {
                return Err(AppError::conflict("document already trashed"));
            }

            let now = Utc::now().naive_utc();
            diesel::update(
                documents::table
                    .find(document_id)
                    .filter(documents::tenant_id.eq(tenant_id)),
            )
            .set((
                documents::deleted_at.eq(Some(now)),
                documents::updated_at.eq(now),
            ))
            .execute(conn)?;

            Ok(())
        })
    }

    pub fn delete_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        document_id: Uuid,
    ) -> AppResult<()> {
        conn.transaction::<_, AppError, _>(|conn| {
            let document = documents::table
                .find(document_id)
                .filter(documents::tenant_id.eq(tenant_id))
                .for_update()
                .first::<Document>(conn)
                .optional()?
                .ok_or_else(AppError::not_found)?;

            if document.deleted_at.is_none() {
                return Err(AppError::conflict(
                    "document must be trashed before permanent deletion",
                ));
            }

            let payload = json!({ "document_id": document_id });
            enqueue_job_if_not_exists(conn, tenant_id, JOB_PURGE_DOCUMENT, payload, None)
                .map_err(|e| match e {
                    crate::jobs::JobQueueError::Database(db_err) => AppError::from(db_err),
                })?;
            Ok(())
        })
    }

    pub async fn update_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
        payload: Value,
    ) -> AppResult<DocumentDetailResponse> {
        let mut document: Document = documents::table
            .find(document_id)
            .filter(documents::tenant_id.eq(tenant_id))
            .first(conn)?;
        if document.deleted_at.is_some() {
            return Err(AppError::not_found());
        }

        let payload_obj = payload
            .as_object()
            .ok_or_else(|| AppError::bad_request("request body must be a JSON object"))?;
        let DocumentUpdatePlan { mut changeset } =
            Self::build_document_update_plan(&document, payload_obj)?;

        let now = Utc::now().naive_utc();
        changeset.updated_at = Some(now);

        let target = documents::table
            .find(document_id)
            .filter(documents::tenant_id.eq(tenant_id));

        let update_result = diesel::update(target).set(&changeset);

        match update_result.execute(conn) {
            Ok(_) => {}
            Err(diesel::result::Error::DatabaseError(DatabaseErrorKind::UniqueViolation, _)) => {
                return Err(AppError::conflict(
                    "another document in this folder already uses that filename",
                )
                .with_code("duplicate_filename"));
            }
            Err(err) => return Err(AppError::from(err)),
        }

        document = documents::table
            .find(document_id)
            .filter(documents::tenant_id.eq(tenant_id))
            .first(conn)?;

        let current_version: DocumentVersion = document_versions::table
            .find(document.current_version_id)
            .first(conn)?;

        let tags_and_correspondents = load_tags_and_correspondents(conn, &[document_id])?;
        let version_id = current_version.id;
        let assets = self.load_asset_responses(conn, tenant_id, version_id, user_id)?;
        let version_response = to_version_response(current_version);
        let download = build_download_link(self.state, &document, version_id, user_id)?;
        let (tags, correspondents) = tags_and_correspondents
            .get(&document_id)
            .cloned()
            .unwrap_or_else(|| (Vec::new(), Vec::new()));

        let document_response = self.to_document_response(
            user_id,
            document,
            tags,
            correspondents,
            Some((version_response, assets, download)),
        )?;

        Ok(DocumentDetailResponse {
            document: document_response,
        })
    }

    pub fn restore_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        document_id: Uuid,
        folder_id: Option<Uuid>,
    ) -> AppResult<()> {
        let mut document: Document = documents::table
            .find(document_id)
            .filter(documents::tenant_id.eq(tenant_id))
            .first(conn)?;

        if document.deleted_at.is_none() {
            return Ok(());
        }

        if let Some(folder_id) = folder_id {
            ensure_folder_exists_on_conn(conn, tenant_id, folder_id)?;
            document.folder_id = Some(folder_id);
        } else if let Some(existing_folder) = document.folder_id {
            let exists: bool = diesel::select(exists(
                folders::table
                    .filter(folders::id.eq(existing_folder))
                    .filter(folders::tenant_id.eq(tenant_id)),
            ))
            .get_result(conn)?;

            if !exists {
                document.folder_id = None;
            }
        }

        let now = Utc::now().naive_utc();
        diesel::update(
            documents::table
                .find(document_id)
                .filter(documents::tenant_id.eq(tenant_id)),
        )
        .set((
            documents::deleted_at.eq::<Option<NaiveDateTime>>(None),
            documents::folder_id.eq(document.folder_id),
            documents::updated_at.eq(now),
        ))
        .execute(conn)?;

        Ok(())
    }

    pub fn move_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        document_id: Uuid,
        folder_id: Option<Uuid>,
    ) -> AppResult<()> {
        if let Some(folder_id) = folder_id {
            ensure_folder_exists_on_conn(conn, tenant_id, folder_id)?;
        }

        let now = Utc::now().naive_utc();
        diesel::update(
            documents::table
                .find(document_id)
                .filter(documents::tenant_id.eq(tenant_id)),
        )
        .set((
            documents::folder_id.eq(folder_id),
            documents::updated_at.eq(now),
        ))
        .execute(conn)?;

        Ok(())
    }

    pub fn bulk_move_documents(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        mut document_ids: Vec<Uuid>,
        folder_id: Option<Uuid>,
    ) -> AppResult<usize> {
        if document_ids.is_empty() {
            return Err(AppError::bad_request("document_ids must not be empty"));
        }

        document_ids.sort();
        document_ids.dedup();

        if let Some(target_folder) = folder_id {
            ensure_folder_exists_on_conn(conn, tenant_id, target_folder)?;
        }

        let existing: Vec<(Uuid, Option<NaiveDateTime>)> = documents::table
            .filter(documents::id.eq_any(&document_ids))
            .filter(documents::tenant_id.eq(tenant_id))
            .select((documents::id, documents::deleted_at))
            .load(conn)?;

        if existing.len() != document_ids.len() {
            return Err(AppError::bad_request(
                "one or more documents do not exist or are inaccessible",
            ));
        }

        if existing.iter().any(|(_, deleted)| deleted.is_some()) {
            return Err(AppError::bad_request("cannot move deleted documents"));
        }

        let now = Utc::now().naive_utc();
        let updated = match diesel::update(
            documents::table
                .filter(documents::id.eq_any(&document_ids))
                .filter(documents::tenant_id.eq(tenant_id)),
        )
        .set((
            documents::folder_id.eq(folder_id),
            documents::updated_at.eq(now),
        ))
        .execute(conn)
        {
            Ok(value) => value,
            Err(diesel::result::Error::DatabaseError(kind, info)) => {
                error!(
                    ?kind,
                    detail = ?info.details(),
                    constraint = info.constraint_name(),
                    tenant_id = %tenant_id,
                    target_folder = folder_id.map(|id| id.to_string()),
                    "bulk move update failed"
                );
                let message = info
                    .constraint_name()
                    .map(|name| format!("constraint {name} prevented moving documents"))
                    .unwrap_or_else(|| "unable to move documents due to a constraint".to_string());
                return Err(AppError::conflict(message));
            }
            Err(err) => {
                error!(
                    ?err,
                    tenant_id = %tenant_id,
                    target_folder = folder_id.map(|id| id.to_string()),
                    "bulk move update failed"
                );
                return Err(AppError::from(err));
            }
        };

        Ok(updated)
    }

    fn to_document_response(
        &self,
        _user_id: Uuid,
        doc: Document,
        tags: Vec<Tag>,
        correspondents: Vec<DocumentCorrespondentResponse>,
        current_version: Option<(
            DocumentVersionResponse,
            Vec<DocumentAssetResponse>,
            DownloadLink,
        )>,
    ) -> AppResult<DocumentResponse> {
        let current_version = match current_version {
            Some((version, assets, download)) => Some(DocumentVersionDetailResponse {
                version,
                assets,
                download,
            }),
            None => None,
        };

        Ok(DocumentResponse {
            id: doc.id,
            filename: doc.filename,
            title: doc.title,
            original_name: doc.original_name,
            mime_type: doc.mime_type,
            folder_id: doc.folder_id,
            created_at: to_iso(doc.created_at),
            updated_at: to_iso(doc.updated_at),
            deleted_at: doc.deleted_at.map(to_iso),
            issued_at: doc.issued_at.map(to_iso),
            metadata: doc.metadata,
            tags: tags.into_iter().map(TagResponse::from).collect(),
            correspondents,
            current_version,
        })
    }

    async fn try_reuse_existing_document(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        checksum_hex: &str,
        issued_at_override: Option<NaiveDateTime>,
        skip_if_existing: bool,
        tag_ids: &[Uuid],
        correspondents: &[CorrespondentAssignmentInput],
    ) -> AppResult<Option<DocumentDetailResponse>> {
        let existing = documents::table
            .inner_join(
                document_versions::table
                    .on(document_versions::id.eq(documents::current_version_id)),
            )
            .filter(documents::tenant_id.eq(tenant_id))
            .filter(document_versions::checksum.eq(checksum_hex))
            .select((documents::all_columns, document_versions::all_columns))
            .first::<(Document, DocumentVersion)>(conn)
            .optional()?;

        let Some((mut document, version)) = existing else {
            return Ok(None);
        };

        if skip_if_existing {
            info!(
                document_id = %document.id,
                checksum = %checksum_hex,
                "upload rejected because document already exists",
            );

            let mut message = String::from("a document with the same contents already exists");
            let mut details = json!({
                "conflict_document_id": document.id,
            });

            if let Some(deleted_at) = document.deleted_at {
                message.push_str(". Note: the existing document is currently in the trash.");
                if let Some(obj) = details.as_object_mut() {
                    obj.insert("conflict_document_in_trash".to_string(), Value::Bool(true));
                    obj.insert(
                        "conflict_document_deleted_at".to_string(),
                        Value::String(to_iso(deleted_at)),
                    );
                }
            }

            return Err(AppError::conflict(message)
                .with_code("duplicate_document")
                .with_details(details));
        }

        if let Some(issued_at) = issued_at_override {
            if document.issued_at != Some(issued_at) {
                diesel::update(
                    documents::table
                        .find(document.id)
                        .filter(documents::tenant_id.eq(tenant_id)),
                )
                .set((
                    documents::issued_at.eq(Some(issued_at)),
                    documents::updated_at.eq(Utc::now().naive_utc()),
                ))
                .execute(conn)?;
                document.issued_at = Some(issued_at);
            }
        }

        assign_tags_to_document(conn, tenant_id, &document, tag_ids, Some(user_id))?;

        if !correspondents.is_empty() {
            let raw_ids: Vec<Uuid> = correspondents
                .iter()
                .map(|assignment| assignment.correspondent_id)
                .collect();
            let correspondent_ids = normalize_correspondent_ids(&raw_ids)?;
            insert_document_correspondents(
                conn,
                tenant_id,
                document.id,
                user_id,
                &correspondent_ids,
            )?;
        }

        if document.deleted_at.is_some() {
            let now = Utc::now().naive_utc();
            diesel::update(documents::table.find(document.id))
                .set((
                    documents::deleted_at.eq(None::<NaiveDateTime>),
                    documents::updated_at.eq(now),
                ))
                .execute(conn)?;
            document.deleted_at = None;
            document.updated_at = now;
        }

        let relations = load_tags_and_correspondents(conn, &[document.id])?;
        let (tags, correspondents_list) = relations
            .get(&document.id)
            .cloned()
            .unwrap_or_else(|| (Vec::new(), Vec::new()));

        let assets = self.load_asset_responses(conn, tenant_id, version.id, user_id)?;
        let download = build_download_link(self.state, &document, version.id, user_id)?;
        let version_response = to_version_response(version.clone());

        info!(
            document_id = %document.id,
            checksum = %checksum_hex,
            "upload deduplicated existing document"
        );

        let detail = DocumentDetailResponse {
            document: self.to_document_response(
                user_id,
                document,
                tags,
                correspondents_list,
                Some((version_response, assets, download)),
            )?,
        };

        Ok(Some(detail))
    }

    fn asset_download_link(
        &self,
        asset_id: Uuid,
        tenant_id: Uuid,
        user_id: Uuid,
    ) -> AppResult<DownloadLink> {
        let token = self
            .state
            .jwt
            .generate_asset_download_token(asset_id, user_id, tenant_id)
            .map_err(|err| {
                error!(error = ?err, "failed to issue asset download token");
                AppError::internal("failed to issue asset download token")
            })?;

        let expires_at = Utc::now()
            .checked_add_signed(ChronoDuration::minutes(
                self.state.config.download_token_expiry_minutes,
            ))
            .ok_or_else(|| AppError::internal("failed to compute download expiry"))?
            .timestamp_millis();

        Ok(DownloadLink {
            url: format!("/api/download/{token}"),
            expires_at,
        })
    }

    fn asset_response(
        &self,
        asset: DocumentAsset,
        tenant_id: Uuid,
        user_id: Uuid,
    ) -> AppResult<DocumentAssetResponse> {
        let download = self.asset_download_link(asset.id, tenant_id, user_id)?;

        Ok(DocumentAssetResponse {
            id: asset.id,
            asset_type: asset.asset_type,
            mime_type: asset.mime_type,
            metadata: asset.metadata,
            download: Some(download),
        })
    }

    fn load_asset_responses(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        version_id: Uuid,
        user_id: Uuid,
    ) -> AppResult<Vec<DocumentAssetResponse>> {
        let assets: Vec<DocumentAsset> = document_assets::table
            .filter(document_assets::document_version_id.eq(version_id))
            .filter(document_assets::tenant_id.eq(tenant_id))
            .order(document_assets::created_at.asc())
            .load(conn)?;

        assets
            .into_iter()
            .map(|asset| self.asset_response(asset, tenant_id, user_id))
            .collect()
    }
}
