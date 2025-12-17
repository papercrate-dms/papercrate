use diesel::prelude::*;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::Document;
use crate::schema::documents;
use crate::state::PgPooledConnection;

/// Load a document that belongs to the tenant and is not soft-deleted.
pub fn load_active_document(
    conn: &mut PgPooledConnection,
    tenant_id: Uuid,
    document_id: Uuid,
) -> AppResult<Document> {
    let doc: Document = documents::table
        .find(document_id)
        .filter(documents::tenant_id.eq(tenant_id))
        .first(conn)?;

    if doc.deleted_at.is_some() {
        return Err(AppError::not_found());
    }

    Ok(doc)
}
