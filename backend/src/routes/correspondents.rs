use std::collections::HashMap;

use axum::{extract::Path, http::StatusCode, Json};
use chrono::Utc;
use diesel::{dsl::count_star, prelude::*, result::DatabaseErrorKind, PgConnection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    auth::TenantScopedConn,
    error::{AppError, AppResult},
    http::responders::{no_content, ok_json, IntoAppResult, JsonResponse, RowsAffectedExt},
    models::{Correspondent, NewCorrespondent},
    schema::{correspondents, document_correspondents},
    utils::{
        named_entity::{ensure_name_available, normalize_name},
        time::to_iso,
    },
};

#[derive(Serialize, ToSchema)]
pub struct CorrespondentSummary {
    pub id: Uuid,
    pub name: String,
    #[schema(value_type = Object)]
    pub metadata: Value,
    pub created_at: String,
    pub updated_at: String,
    pub usage_count: i64,
}

#[derive(Deserialize, ToSchema)]
pub struct CreateCorrespondentRequest {
    pub name: String,
    #[serde(default)]
    #[schema(nullable, value_type = Object)]
    pub metadata: Option<Value>,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateCorrespondentRequest {
    #[schema(nullable)]
    pub name: Option<String>,
    #[schema(nullable, value_type = Object)]
    pub metadata: Option<Value>,
}

#[derive(AsChangeset, Default)]
#[diesel(table_name = correspondents)]
struct CorrespondentChangeset<'a> {
    name: Option<&'a str>,
    metadata: Option<&'a Value>,
}

#[utoipa::path(
    get,
    path = "/api/correspondents",
    responses((status = 200, description = "Correspondents", body = [CorrespondentSummary])),
    tag = "Correspondents"
)]
pub async fn list_correspondents(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<CorrespondentSummary>>> {
    let correspondents_list: Vec<Correspondent> = correspondents::table
        .filter(correspondents::tenant_id.eq(tenant_id))
        .order(correspondents::name.asc())
        .load(&mut *conn)?;

    let usage_rows: Vec<(Uuid, i64)> = document_correspondents::table
        .filter(document_correspondents::tenant_id.eq(tenant_id))
        .group_by(document_correspondents::correspondent_id)
        .select((document_correspondents::correspondent_id, count_star()))
        .load(&mut *conn)?;

    let mut usage_map: HashMap<Uuid, i64> = HashMap::new();
    for (correspondent_id, count) in usage_rows {
        usage_map.insert(correspondent_id, count);
    }

    let mut response = Vec::with_capacity(correspondents_list.len());
    for correspondent in correspondents_list {
        let total = usage_map.remove(&correspondent.id).unwrap_or(0);
        response.push(build_summary(correspondent, total));
    }

    ok_json(response)
}

#[utoipa::path(
    post,
    path = "/api/correspondents",
    request_body = CreateCorrespondentRequest,
    responses((status = 200, description = "Correspondent created", body = CorrespondentSummary)),
    tag = "Correspondents"
)]
pub async fn create_correspondent(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<CreateCorrespondentRequest>,
) -> AppResult<JsonResponse<CorrespondentSummary>> {
    let name = normalize_name(&payload.name, || {
        AppError::bad_request("name must not be empty")
    })?;

    let metadata_value = normalize_metadata(payload.metadata);
    let new_id = Uuid::new_v4();
    let new_correspondent = NewCorrespondent {
        id: new_id,
        name: name.clone(),
        metadata: metadata_value,
        tenant_id,
    };

    match diesel::insert_into(correspondents::table)
        .values(&new_correspondent)
        .execute(&mut *conn)
    {
        Ok(_) => {}
        Err(diesel::result::Error::DatabaseError(DatabaseErrorKind::UniqueViolation, _)) => {
            return Err(AppError::bad_request("correspondent name already exists"));
        }
        Err(err) => return Err(AppError::from(err)),
    }

    let correspondent: Correspondent = correspondents::table
        .find(new_id)
        .filter(correspondents::tenant_id.eq(tenant_id))
        .first(&mut *conn)
        .into_app_result()?;

    ok_json(build_summary(correspondent, 0))
}

#[utoipa::path(
    patch,
    path = "/api/correspondents/{id}",
    params(("id" = Uuid, Path, description = "Correspondent ID")),
    request_body = UpdateCorrespondentRequest,
    responses((status = 200, description = "Correspondent updated", body = CorrespondentSummary)),
    tag = "Correspondents"
)]
pub async fn update_correspondent(
    Path(correspondent_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<UpdateCorrespondentRequest>,
) -> AppResult<JsonResponse<CorrespondentSummary>> {
    let existing: Correspondent = correspondents::table
        .find(correspondent_id)
        .filter(correspondents::tenant_id.eq(tenant_id))
        .first(&mut *conn)
        .into_app_result()?;

    let mut new_name: Option<String> = None;
    if let Some(ref candidate) = payload.name {
        let normalized = normalize_name(candidate, || {
            AppError::bad_request("name must not be empty")
        })?;
        if normalized != existing.name {
            ensure_name_available(
                || {
                    correspondents::table
                        .filter(correspondents::name.eq(&normalized))
                        .filter(correspondents::id.ne(correspondent_id))
                        .filter(correspondents::tenant_id.eq(tenant_id))
                        .first::<Correspondent>(&mut *conn)
                        .optional()
                },
                || AppError::bad_request("correspondent name already exists"),
            )?;
            new_name = Some(normalized);
        }
    }

    let mut new_metadata: Option<Value> = None;
    if let Some(metadata) = payload.metadata.clone() {
        let candidate = normalize_metadata(Some(metadata));
        if candidate != existing.metadata {
            new_metadata = Some(candidate);
        }
    }

    if new_name.is_none() && new_metadata.is_none() {
        let usage = load_usage_for_correspondent(&mut conn, tenant_id, correspondent_id)?;
        return ok_json(build_summary(existing.clone(), usage));
    }

    let mut changeset = CorrespondentChangeset::default();
    if let Some(ref name) = new_name {
        changeset.name = Some(name.as_str());
    }
    if let Some(ref metadata) = new_metadata {
        changeset.metadata = Some(metadata);
    }

    let now = Utc::now().naive_utc();
    diesel::update(
        correspondents::table
            .find(correspondent_id)
            .filter(correspondents::tenant_id.eq(tenant_id)),
    )
    .set((&changeset, correspondents::updated_at.eq(now)))
    .execute(&mut *conn)
    .into_app_result()?
    .or_not_found()?;

    let updated: Correspondent = correspondents::table
        .find(correspondent_id)
        .filter(correspondents::tenant_id.eq(tenant_id))
        .first(&mut *conn)
        .into_app_result()?;
    let usage = load_usage_for_correspondent(&mut conn, tenant_id, correspondent_id)?;
    ok_json(build_summary(updated, usage))
}

#[utoipa::path(
    delete,
    path = "/api/correspondents/{id}",
    params(("id" = Uuid, Path, description = "Correspondent ID")),
    responses((status = 204, description = "Correspondent deleted")),
    tag = "Correspondents"
)]
pub async fn delete_correspondent(
    Path(correspondent_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<StatusCode> {
    let usage: i64 = document_correspondents::table
        .filter(document_correspondents::tenant_id.eq(tenant_id))
        .filter(document_correspondents::correspondent_id.eq(correspondent_id))
        .select(count_star())
        .first(&mut *conn)?;

    if usage > 0 {
        return Err(AppError::bad_request(
            "cannot delete correspondent that is still assigned to documents",
        ));
    }

    diesel::delete(
        correspondents::table
            .filter(correspondents::id.eq(correspondent_id))
            .filter(correspondents::tenant_id.eq(tenant_id)),
    )
    .execute(&mut *conn)
    .into_app_result()?
    .or_not_found()?;
    no_content()
}

fn build_summary(correspondent: Correspondent, usage_count: i64) -> CorrespondentSummary {
    CorrespondentSummary {
        id: correspondent.id,
        name: correspondent.name,
        metadata: correspondent.metadata,
        created_at: to_iso(correspondent.created_at),
        updated_at: to_iso(correspondent.updated_at),
        usage_count,
    }
}

fn normalize_metadata(input: Option<Value>) -> Value {
    match input {
        None | Some(Value::Null) => Value::Object(Default::default()),
        Some(value) => value,
    }
}

fn load_usage_for_correspondent(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    correspondent_id: Uuid,
) -> AppResult<i64> {
    let total: i64 = document_correspondents::table
        .filter(document_correspondents::correspondent_id.eq(correspondent_id))
        .filter(document_correspondents::tenant_id.eq(tenant_id))
        .select(count_star())
        .get_result(conn)?;

    Ok(total)
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        crate::routes::correspondents::list_correspondents,
        crate::routes::correspondents::create_correspondent,
        crate::routes::correspondents::update_correspondent,
        crate::routes::correspondents::delete_correspondent
    ),
    components(schemas(
        crate::routes::correspondents::CorrespondentSummary,
        crate::routes::correspondents::CreateCorrespondentRequest,
        crate::routes::correspondents::UpdateCorrespondentRequest
    ))
)]
pub struct CorrespondentsApiDoc;
