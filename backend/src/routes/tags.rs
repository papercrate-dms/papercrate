use axum::{extract::Path, http::StatusCode, Json};
use diesel::{dsl::count_star, prelude::*};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    auth::TenantScopedConn,
    error::{AppError, AppResult},
    http::responders::{no_content, ok_json, IntoAppResult, JsonResponse, RowsAffectedExt},
    models::{NewTag, Tag},
    schema::{document_tags, tags},
    utils::{
        json::deserialize_patch_field,
        named_entity::{ensure_name_available, normalize_name},
    },
};

#[derive(Deserialize, ToSchema)]
pub struct CreateTagRequest {
    pub label: String,
    #[schema(nullable)]
    pub color: Option<String>,
}

#[derive(AsChangeset, Default)]
#[diesel(table_name = tags)]
struct UpdateTagChangeset<'a> {
    label: Option<&'a str>,
    color: Option<Option<&'a str>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn update_tag_request_deserializes_null_fields() {
        let request: UpdateTagRequest = serde_json::from_value(json!({
            "label": null,
            "color": null
        }))
        .unwrap();
        assert!(matches!(request.label, Some(None)));
        assert!(matches!(request.color, Some(None)));
    }

    #[test]
    fn update_tag_request_omitted_fields_are_none() {
        let request: UpdateTagRequest = serde_json::from_value(json!({})).unwrap();
        assert!(request.label.is_none());
        assert!(request.color.is_none());
    }
}

#[derive(Serialize, ToSchema)]
pub struct TagCatalogEntry {
    pub id: Uuid,
    pub label: String,
    #[schema(nullable)]
    pub color: Option<String>,
    pub usage_count: i64,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct UpdateTagRequest {
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    #[schema(nullable, value_type = Option<String>)]
    pub label: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_patch_field")]
    #[schema(nullable, value_type = Option<String>)]
    pub color: Option<Option<String>>,
}

#[utoipa::path(
    get,
    path = "/api/tags",
    responses((status = 200, description = "Tags", body = [TagCatalogEntry])),
    tag = "Tags"
)]
pub async fn list_tags(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<JsonResponse<Vec<TagCatalogEntry>>> {
    let tag_list: Vec<Tag> = tags::table
        .filter(tags::tenant_id.eq(tenant_id))
        .order(tags::label.asc())
        .load(&mut conn)?;

    let usage_rows: Vec<(Uuid, i64)> = document_tags::table
        .filter(document_tags::tenant_id.eq(tenant_id))
        .group_by(document_tags::tag_id)
        .select((document_tags::tag_id, count_star()))
        .load(&mut conn)?;

    let usage_map: HashMap<Uuid, i64> = usage_rows.into_iter().collect();

    let response: Vec<TagCatalogEntry> = tag_list
        .into_iter()
        .map(|tag| TagCatalogEntry {
            id: tag.id,
            label: tag.label,
            color: tag.color,
            usage_count: *usage_map.get(&tag.id).unwrap_or(&0),
        })
        .collect();

    ok_json(response)
}

#[utoipa::path(
    post,
    path = "/api/tags",
    request_body = CreateTagRequest,
    responses((status = 200, description = "Tag created", body = TagCatalogEntry)),
    tag = "Tags"
)]
pub async fn create_tag(
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<CreateTagRequest>,
) -> AppResult<JsonResponse<TagCatalogEntry>> {
    let label = normalize_name(&payload.label, || {
        AppError::bad_request("label must not be empty")
    })?;

    let new_tag = NewTag {
        id: Uuid::new_v4(),
        label: label.clone(),
        color: payload.color,
        tenant_id,
    };

    match diesel::insert_into(tags::table)
        .values(&new_tag)
        .execute(&mut conn)
    {
        Ok(_) => {}
        Err(diesel::result::Error::DatabaseError(
            diesel::result::DatabaseErrorKind::UniqueViolation,
            _,
        )) => {
            return Err(AppError::bad_request("tag label already exists"));
        }
        Err(err) => return Err(AppError::from(err)),
    }

    let tag: Tag = tags::table
        .find(new_tag.id)
        .filter(tags::tenant_id.eq(tenant_id))
        .first(&mut conn)
        .into_app_result()?;

    ok_json(TagCatalogEntry {
        id: tag.id,
        label: tag.label,
        color: tag.color,
        usage_count: 0,
    })
}

#[utoipa::path(
    patch,
    path = "/api/tags/{id}",
    params(("id" = Uuid, Path, description = "Tag ID")),
    request_body = UpdateTagRequest,
    responses((status = 200, description = "Tag updated", body = TagCatalogEntry)),
    tag = "Tags"
)]
pub async fn update_tag(
    Path(tag_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
    Json(payload): Json<UpdateTagRequest>,
) -> AppResult<JsonResponse<TagCatalogEntry>> {
    let existing: Tag = tags::table
        .find(tag_id)
        .filter(tags::tenant_id.eq(tenant_id))
        .first(&mut conn)
        .into_app_result()?;
    let UpdateTagRequest { label, color } = payload;

    if label.is_none() && color.is_none() {
        let usage_count: i64 = document_tags::table
            .filter(document_tags::tag_id.eq(tag_id))
            .select(count_star())
            .first(&mut conn)?;
        return ok_json(TagCatalogEntry {
            id: existing.id,
            label: existing.label.clone(),
            color: existing.color.clone(),
            usage_count,
        });
    }

    let mut new_label: Option<String> = None;
    let mut label_changed = false;
    match label {
        None => {}
        Some(None) => {
            return Err(AppError::bad_request("label cannot be null"));
        }
        Some(Some(value)) => {
            let normalized =
                normalize_name(&value, || AppError::bad_request("label must not be empty"))?;
            if normalized != existing.label {
                ensure_name_available(
                    || {
                        tags::table
                            .filter(tags::label.eq(&normalized))
                            .filter(tags::id.ne(tag_id))
                            .filter(tags::tenant_id.eq(tenant_id))
                            .first::<Tag>(&mut conn)
                            .optional()
                    },
                    || AppError::bad_request("tag label already exists"),
                )?;
                new_label = Some(normalized);
                label_changed = true;
            }
        }
    }

    let mut color_change: Option<Option<String>> = None;
    let mut color_changed = false;
    match color {
        None => {}
        Some(None) => {
            color_change = Some(None);
            color_changed = true;
        }
        Some(Some(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Err(AppError::bad_request("color must not be empty"));
            }
            if existing.color.as_deref() != Some(trimmed) {
                color_change = Some(Some(trimmed.to_string()));
                color_changed = true;
            }
        }
    }

    if !label_changed && !color_changed {
        let usage_count: i64 = document_tags::table
            .filter(document_tags::tag_id.eq(tag_id))
            .filter(document_tags::tenant_id.eq(tenant_id))
            .select(count_star())
            .first(&mut conn)?;
        return ok_json(TagCatalogEntry {
            id: existing.id,
            label: existing.label.clone(),
            color: existing.color.clone(),
            usage_count,
        });
    }

    let changeset = UpdateTagChangeset {
        label: new_label.as_deref(),
        color: color_change
            .as_ref()
            .map(|opt| opt.as_ref().map(|value| value.as_str())),
    };

    diesel::update(
        tags::table
            .find(tag_id)
            .filter(tags::tenant_id.eq(tenant_id)),
    )
    .set(&changeset)
    .execute(&mut conn)
    .into_app_result()?
    .or_not_found()?;

    let updated: Tag = tags::table
        .find(tag_id)
        .filter(tags::tenant_id.eq(tenant_id))
        .first(&mut conn)
        .into_app_result()?;
    let usage_count: i64 = document_tags::table
        .filter(document_tags::tag_id.eq(tag_id))
        .filter(document_tags::tenant_id.eq(tenant_id))
        .select(count_star())
        .first(&mut conn)?;

    ok_json(TagCatalogEntry {
        id: updated.id,
        label: updated.label,
        color: updated.color,
        usage_count,
    })
}

#[utoipa::path(
    delete,
    path = "/api/tags/{id}",
    params(("id" = Uuid, Path, description = "Tag ID")),
    responses((status = 204, description = "Tag deleted")),
    tag = "Tags"
)]
pub async fn delete_tag(
    Path(tag_id): Path<Uuid>,
    TenantScopedConn {
        mut conn,
        tenant_id,
        ..
    }: TenantScopedConn,
) -> AppResult<StatusCode> {
    let usage: i64 = document_tags::table
        .filter(document_tags::tag_id.eq(tag_id))
        .filter(document_tags::tenant_id.eq(tenant_id))
        .select(count_star())
        .first(&mut conn)?;

    if usage > 0 {
        return Err(AppError::bad_request(
            "cannot delete tag that is still assigned to documents",
        ));
    }

    diesel::delete(
        tags::table
            .find(tag_id)
            .filter(tags::tenant_id.eq(tenant_id)),
    )
    .execute(&mut conn)
    .into_app_result()?
    .or_not_found()?;

    no_content()
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(
        crate::routes::tags::list_tags,
        crate::routes::tags::create_tag,
        crate::routes::tags::update_tag,
        crate::routes::tags::delete_tag
    ),
    components(schemas(
        crate::routes::tags::CreateTagRequest,
        crate::routes::tags::TagCatalogEntry,
        crate::routes::tags::UpdateTagRequest
    ))
)]
pub struct TagsApiDoc;
