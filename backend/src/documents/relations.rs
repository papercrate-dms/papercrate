use std::collections::HashMap;

use uuid::Uuid;

use crate::documents::correspondents::{
    load_correspondents_for_documents, DocumentCorrespondentResponse,
};
use crate::documents::tags::load_tags_for_documents;
use crate::error::AppResult;
use crate::models::Tag;
use crate::state::PgPooledConnection;

/// Loads tags and correspondents for the provided documents in a single pass.
pub fn load_tags_and_correspondents(
    conn: &mut PgPooledConnection,
    document_ids: &[Uuid],
) -> AppResult<HashMap<Uuid, (Vec<Tag>, Vec<DocumentCorrespondentResponse>)>> {
    if document_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let tags_map = load_tags_for_documents(conn, document_ids)?;
    let mut correspondents_map = load_correspondents_for_documents(conn, document_ids)?;

    let mut result = HashMap::with_capacity(document_ids.len());
    for id in document_ids {
        let tags = tags_map.get(id).cloned().unwrap_or_default();
        let correspondents = correspondents_map.remove(id).unwrap_or_default();
        result.insert(*id, (tags, correspondents));
    }

    Ok(result)
}
