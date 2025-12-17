use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::documents::tags::assign_tags as assign_tags_to_document;
use crate::error::{AppError, AppResult};
use crate::models::{Document, NewDocumentTag, Tag};
use crate::schema::{document_tags, documents, tags};
use crate::state::{AppState, PgPooledConnection};
use crate::utils::db::validate_bulk_ids;

#[derive(Deserialize, ToSchema)]
pub struct AssignTagsRequest {
    pub tag_ids: Vec<Uuid>,
}

#[derive(Deserialize, Copy, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BulkTagAction {
    Add,
    Remove,
}

#[derive(Deserialize, ToSchema)]
pub struct BulkTagRequest {
    pub document_ids: Vec<Uuid>,
    pub tag_ids: Vec<Uuid>,
    pub action: BulkTagAction,
}

#[derive(Serialize, ToSchema)]
pub struct BulkTagResponse {
    pub added: usize,
    pub removed: usize,
}

pub struct TagsService<'a> {
    _state: &'a AppState,
}

impl<'a> TagsService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { _state: state }
    }

    pub fn assign_to_document(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
        tag_ids: &[Uuid],
    ) -> AppResult<()> {
        if tag_ids.is_empty() {
            return Err(AppError::bad_request("tag_ids must not be empty"));
        }

        let document: Document = documents::table
            .find(document_id)
            .filter(documents::tenant_id.eq(tenant_id))
            .first(conn)?;

        assign_tags_to_document(conn, tenant_id, &document, tag_ids, Some(user_id))?;
        Ok(())
    }

    pub fn bulk_update(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        mut payload: BulkTagRequest,
    ) -> AppResult<BulkTagResponse> {
        validate_bulk_ids(&mut payload.document_ids, "document_ids")?;
        validate_bulk_ids(&mut payload.tag_ids, "tag_ids")?;

        let docs: Vec<(Uuid, Option<chrono::NaiveDateTime>)> = documents::table
            .filter(documents::id.eq_any(&payload.document_ids))
            .filter(documents::tenant_id.eq(tenant_id))
            .select((documents::id, documents::deleted_at))
            .load(conn)?;

        if docs.len() != payload.document_ids.len() {
            return Err(AppError::bad_request(
                "one or more documents do not exist or are inaccessible",
            ));
        }

        if docs.iter().any(|(_, deleted)| deleted.is_some()) {
            return Err(AppError::bad_request(
                "cannot assign or remove tags from deleted documents",
            ));
        }

        let existing_tags: Vec<Tag> = tags::table
            .filter(tags::id.eq_any(&payload.tag_ids))
            .filter(tags::tenant_id.eq(tenant_id))
            .load(conn)?;

        if existing_tags.len() != payload.tag_ids.len() {
            return Err(AppError::bad_request("one or more tags do not exist"));
        }

        match payload.action {
            BulkTagAction::Add => {
                let mut inserts =
                    Vec::with_capacity(payload.document_ids.len() * payload.tag_ids.len());
                for doc_id in &payload.document_ids {
                    for tag_id in &payload.tag_ids {
                        inserts.push(NewDocumentTag {
                            document_id: *doc_id,
                            tag_id: *tag_id,
                            assigned_by: Some(user_id),
                            tenant_id,
                        });
                    }
                }

                let added = if inserts.is_empty() {
                    0
                } else {
                    diesel::insert_into(document_tags::table)
                        .values(&inserts)
                        .on_conflict_do_nothing()
                        .execute(conn)?
                };

                Ok(BulkTagResponse { added, removed: 0 })
            }
            BulkTagAction::Remove => {
                let removed = diesel::delete(
                    document_tags::table
                        .filter(document_tags::document_id.eq_any(&payload.document_ids))
                        .filter(document_tags::tenant_id.eq(tenant_id))
                        .filter(document_tags::tag_id.eq_any(&payload.tag_ids)),
                )
                .execute(conn)?;

                Ok(BulkTagResponse { added: 0, removed })
            }
        }
    }

    pub fn remove_from_document(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        document_id: Uuid,
        tag_id: Uuid,
    ) -> AppResult<()> {
        let deleted = diesel::delete(
            document_tags::table
                .filter(document_tags::document_id.eq(document_id))
                .filter(document_tags::tenant_id.eq(tenant_id))
                .filter(document_tags::tag_id.eq(tag_id)),
        )
        .execute(conn)?;

        if deleted == 0 {
            return Err(AppError::not_found());
        }

        Ok(())
    }
}
