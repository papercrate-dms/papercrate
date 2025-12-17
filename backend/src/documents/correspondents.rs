use std::collections::HashMap;

use chrono::Utc;
use diesel::prelude::*;
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{Correspondent, DocumentCorrespondent, NewDocumentCorrespondent};
use crate::schema::{correspondents, document_correspondents, documents};
use crate::utils::time::to_iso;

#[derive(Serialize, Clone, ToSchema)]
pub struct DocumentCorrespondentResponse {
    pub id: Uuid,
    pub name: String,
    #[schema(value_type = Object)]
    pub metadata: Value,
    pub assigned_at: String,
}

pub fn normalize_correspondent_ids(ids: &[Uuid]) -> AppResult<Vec<Uuid>> {
    let mut unique: Vec<Uuid> = ids.iter().copied().collect();
    unique.sort_unstable();
    unique.dedup();

    if unique.is_empty() {
        return Err(AppError::bad_request(
            "assignments must contain at least one correspondent",
        ));
    }

    Ok(unique)
}

pub fn insert_document_correspondents(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    document_id: Uuid,
    user_id: Uuid,
    correspondent_ids: &[Uuid],
) -> AppResult<usize> {
    let ids = normalize_correspondent_ids(correspondent_ids)?;

    let existing: Vec<Uuid> = correspondents::table
        .filter(correspondents::id.eq_any(&ids))
        .filter(correspondents::tenant_id.eq(tenant_id))
        .select(correspondents::id)
        .load(conn)?;

    if existing.len() != ids.len() {
        return Err(AppError::bad_request(
            "one or more correspondents do not exist",
        ));
    }

    let new_rows: Vec<NewDocumentCorrespondent> = ids
        .into_iter()
        .map(|correspondent_id| NewDocumentCorrespondent {
            document_id,
            correspondent_id,
            assigned_by: Some(user_id),
            tenant_id,
        })
        .collect();

    if new_rows.is_empty() {
        return Ok(0);
    }

    let inserted = diesel::insert_into(document_correspondents::table)
        .values(&new_rows)
        .on_conflict_do_nothing()
        .execute(conn)?;

    if inserted > 0 {
        diesel::update(
            documents::table
                .find(document_id)
                .filter(documents::tenant_id.eq(tenant_id)),
        )
        .set(documents::updated_at.eq(Utc::now().naive_utc()))
        .execute(conn)?;
    }

    Ok(inserted)
}

pub fn load_correspondents_for_documents(
    conn: &mut PgConnection,
    document_ids: &[Uuid],
) -> AppResult<HashMap<Uuid, Vec<DocumentCorrespondentResponse>>> {
    if document_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows: Vec<(DocumentCorrespondent, Correspondent)> = document_correspondents::table
        .inner_join(correspondents::table)
        .filter(document_correspondents::document_id.eq_any(document_ids))
        .order((
            document_correspondents::document_id.asc(),
            document_correspondents::assigned_at.asc(),
        ))
        .load(conn)?;

    let mut map: HashMap<Uuid, Vec<DocumentCorrespondentResponse>> = HashMap::new();
    for (assignment, correspondent) in rows {
        map.entry(assignment.document_id)
            .or_default()
            .push(DocumentCorrespondentResponse {
                id: correspondent.id,
                name: correspondent.name,
                metadata: correspondent.metadata,
                assigned_at: to_iso(assignment.assigned_at),
            });
    }

    Ok(map)
}
