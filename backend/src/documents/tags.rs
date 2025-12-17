use std::collections::HashMap;

use diesel::prelude::*;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{Document, NewDocumentTag, Tag};
use crate::schema::{document_tags, tags};

pub fn assign_tags(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    document: &Document,
    raw_tag_ids: &[Uuid],
    assigned_by: Option<Uuid>,
) -> AppResult<usize> {
    if raw_tag_ids.is_empty() {
        return Ok(0);
    }

    let mut tag_ids: Vec<Uuid> = raw_tag_ids.iter().copied().collect();
    tag_ids.sort_unstable();
    tag_ids.dedup();

    if tag_ids.is_empty() {
        return Ok(0);
    }

    let existing: Vec<Uuid> = tags::table
        .filter(tags::id.eq_any(&tag_ids))
        .filter(tags::tenant_id.eq(tenant_id))
        .select(tags::id)
        .load(conn)?;

    if existing.len() != tag_ids.len() {
        return Err(AppError::bad_request("one or more tags do not exist"));
    }

    let new_tags: Vec<NewDocumentTag> = tag_ids
        .into_iter()
        .map(|tag_id| NewDocumentTag {
            document_id: document.id,
            tag_id,
            assigned_by,
            tenant_id,
        })
        .collect();

    if new_tags.is_empty() {
        return Ok(0);
    }

    let inserted = diesel::insert_into(document_tags::table)
        .values(&new_tags)
        .on_conflict_do_nothing()
        .execute(conn)?;

    Ok(inserted)
}

pub fn load_tags_for_documents(
    conn: &mut PgConnection,
    document_ids: &[Uuid],
) -> AppResult<HashMap<Uuid, Vec<Tag>>> {
    if document_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows: Vec<(Uuid, Tag)> = document_tags::table
        .inner_join(tags::table)
        .filter(document_tags::document_id.eq_any(document_ids))
        .select((document_tags::document_id, tags::all_columns))
        .load(conn)?;

    let mut map: HashMap<Uuid, Vec<Tag>> = HashMap::new();
    for (doc_id, tag) in rows {
        map.entry(doc_id).or_default().push(tag);
    }
    Ok(map)
}
