use chrono::Utc;
use diesel::{dsl::not, prelude::*, Connection};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::documents::correspondents::{
    insert_document_correspondents, normalize_correspondent_ids,
};
use crate::error::{AppError, AppResult};
use crate::schema::{document_correspondents, documents};
use crate::services::helpers::load_active_document;
use crate::state::{AppState, PgPooledConnection};
use crate::utils::db::validate_bulk_ids;

#[derive(Serialize, ToSchema)]
pub struct BulkCorrespondentResponse {
    pub assigned: usize,
    pub removed: usize,
}

#[derive(Deserialize, ToSchema)]
pub struct CorrespondentAssignmentInput {
    pub correspondent_id: Uuid,
}

#[derive(Deserialize, ToSchema)]
pub struct AssignCorrespondentsRequest {
    pub assignments: Vec<CorrespondentAssignmentInput>,
    #[serde(default)]
    #[schema(default = false)]
    pub replace: bool,
}

#[derive(Deserialize, Copy, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum BulkCorrespondentAction {
    Add,
    Remove,
}

fn default_bulk_correspondent_action() -> BulkCorrespondentAction {
    BulkCorrespondentAction::Add
}

#[derive(Deserialize, ToSchema)]
pub struct BulkCorrespondentsRequest {
    pub document_ids: Vec<Uuid>,
    pub assignments: Vec<CorrespondentAssignmentInput>,
    #[serde(default = "default_bulk_correspondent_action")]
    pub action: BulkCorrespondentAction,
}

pub struct CorrespondentsService<'a> {
    _state: &'a AppState,
}

impl<'a> CorrespondentsService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { _state: state }
    }

    pub fn assign_to_document(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        document_id: Uuid,
        request: &AssignCorrespondentsRequest,
    ) -> AppResult<()> {
        if request.assignments.is_empty() {
            return Err(AppError::bad_request("assignments must not be empty"));
        }

        let raw_ids: Vec<Uuid> = request
            .assignments
            .iter()
            .map(|assignment| assignment.correspondent_id)
            .collect();
        let correspondent_ids = normalize_correspondent_ids(&raw_ids)?;

        conn.transaction::<_, AppError, _>(|conn| {
            let document = load_active_document(conn, tenant_id, document_id)?;

            let mut updated = false;
            if request.replace {
                let base = document_correspondents::table
                    .filter(document_correspondents::document_id.eq(document_id))
                    .filter(document_correspondents::tenant_id.eq(tenant_id));

                let removed = if correspondent_ids.is_empty() {
                    diesel::delete(base).execute(conn)?
                } else {
                    diesel::delete(base.filter(not(
                        document_correspondents::correspondent_id.eq_any(&correspondent_ids),
                    )))
                    .execute(conn)?
                };

                if removed > 0 {
                    updated = true;
                }
            }

            let inserted = insert_document_correspondents(
                conn,
                tenant_id,
                document.id,
                user_id,
                &correspondent_ids,
            )?;

            if inserted > 0 {
                updated = true;
            }

            if updated && inserted == 0 {
                diesel::update(
                    documents::table
                        .find(document_id)
                        .filter(documents::tenant_id.eq(tenant_id)),
                )
                .set(documents::updated_at.eq(Utc::now().naive_utc()))
                .execute(conn)?;
            }

            Ok(())
        })
    }

    pub fn bulk_update(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        mut payload: BulkCorrespondentsRequest,
    ) -> AppResult<BulkCorrespondentResponse> {
        if payload.assignments.is_empty() {
            return Err(AppError::bad_request("assignments must not be empty"));
        }

        validate_bulk_ids(&mut payload.document_ids, "document_ids")?;

        let raw_ids: Vec<Uuid> = payload
            .assignments
            .iter()
            .map(|assignment| assignment.correspondent_id)
            .collect();
        let correspondent_ids = normalize_correspondent_ids(&raw_ids)?;

        let action = payload.action;

        conn.transaction::<_, AppError, _>(|conn| {
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
                    "cannot assign correspondents to deleted documents",
                ));
            }

            match action {
                BulkCorrespondentAction::Add => {
                    let mut assigned_total = 0;
                    for (doc_id, _) in &docs {
                        assigned_total += insert_document_correspondents(
                            conn,
                            tenant_id,
                            *doc_id,
                            user_id,
                            &correspondent_ids,
                        )?;
                    }

                    Ok(BulkCorrespondentResponse {
                        assigned: assigned_total,
                        removed: 0,
                    })
                }
                BulkCorrespondentAction::Remove => {
                    if correspondent_ids.is_empty() {
                        return Ok(BulkCorrespondentResponse {
                            assigned: 0,
                            removed: 0,
                        });
                    }

                    let removed = diesel::delete(
                        document_correspondents::table
                            .filter(
                                document_correspondents::document_id.eq_any(&payload.document_ids),
                            )
                            .filter(document_correspondents::tenant_id.eq(tenant_id))
                            .filter(
                                document_correspondents::correspondent_id
                                    .eq_any(&correspondent_ids),
                            ),
                    )
                    .execute(conn)?;

                    if removed > 0 {
                        diesel::update(
                            documents::table
                                .filter(documents::id.eq_any(&payload.document_ids))
                                .filter(documents::tenant_id.eq(tenant_id)),
                        )
                        .set(documents::updated_at.eq(Utc::now().naive_utc()))
                        .execute(conn)?;
                    }

                    Ok(BulkCorrespondentResponse {
                        assigned: 0,
                        removed,
                    })
                }
            }
        })
    }

    pub fn remove_from_document(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        document_id: Uuid,
        correspondent_id: Uuid,
    ) -> AppResult<()> {
        load_active_document(conn, tenant_id, document_id)?;

        let deleted = diesel::delete(
            document_correspondents::table
                .filter(document_correspondents::document_id.eq(document_id))
                .filter(document_correspondents::tenant_id.eq(tenant_id))
                .filter(document_correspondents::correspondent_id.eq(correspondent_id)),
        )
        .execute(conn)?;

        if deleted == 0 {
            return Err(AppError::not_found());
        }

        diesel::update(
            documents::table
                .find(document_id)
                .filter(documents::tenant_id.eq(tenant_id)),
        )
        .set(documents::updated_at.eq(Utc::now().naive_utc()))
        .execute(conn)?;

        Ok(())
    }
}
