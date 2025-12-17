use axum::http::StatusCode;
use chrono::Utc;
use diesel::{pg::PgConnection, prelude::*, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    auth::capability_sets::{
        compute_slug, create_capability_set as create_capability_set_record, is_system_slug,
        load_capabilities_for_set, normalize_capabilities, refresh_capability_set,
    },
    error::{AppError, AppResult},
    http::responders::{
        created_json, no_content, ok_json, IntoAppResult, JsonResponse, RowsAffectedExt,
    },
    models::{ApiCapability, CapabilitySet},
    schema::{
        api_tokens,
        capability_sets::{self, dsl as cs_dsl},
        user_memberships,
    },
    utils::text::normalize_identifier,
};

#[derive(Serialize, utoipa::ToSchema)]
pub struct CapabilitySetResponse {
    pub id: Uuid,
    pub slug: String,
    pub is_system: bool,
    pub cap_version: i32,
    pub capabilities: Vec<ApiCapability>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct CreateCapabilitySetRequest {
    #[serde(default)]
    #[serde(rename = "slug")]
    pub slug: Option<String>,
    pub capabilities: Vec<ApiCapability>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct UpdateCapabilitySetRequest {
    #[serde(default)]
    #[serde(rename = "slug")]
    pub slug: Option<String>,
    #[serde(default)]
    pub capabilities: Option<Vec<ApiCapability>>,
}

pub struct CapabilitySetService;

impl CapabilitySetService {
    pub fn new() -> Self {
        Self
    }

    pub fn list(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
    ) -> AppResult<JsonResponse<Vec<CapabilitySetResponse>>> {
        let sets = cs_dsl::capability_sets
            .filter(cs_dsl::tenant_id.eq(tenant_id))
            .order(cs_dsl::slug.asc())
            .load::<CapabilitySet>(conn)?;

        let mut responses = Vec::with_capacity(sets.len());
        for set in sets {
            let capabilities = load_capabilities_for_set(conn, set.id)?;
            responses.push(to_response(set, capabilities));
        }

        ok_json(responses)
    }

    pub fn list_capabilities(&self) -> AppResult<JsonResponse<Vec<ApiCapability>>> {
        let capabilities = ApiCapability::variants()
            .iter()
            .map(|value| value.parse::<ApiCapability>().expect("valid capability"))
            .collect();
        ok_json(capabilities)
    }

    pub fn get(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        id: Uuid,
    ) -> AppResult<JsonResponse<CapabilitySetResponse>> {
        let set = cs_dsl::capability_sets
            .filter(cs_dsl::tenant_id.eq(tenant_id))
            .find(id)
            .first::<CapabilitySet>(conn)
            .into_app_result()?;

        let capabilities = load_capabilities_for_set(conn, set.id)?;
        ok_json(to_response(set, capabilities))
    }

    pub fn create(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        payload: CreateCapabilitySetRequest,
    ) -> AppResult<JsonResponse<CapabilitySetResponse>> {
        let original_caps = payload.capabilities;
        let normalized_caps = normalize_capabilities(original_caps.clone())?;
        if normalized_caps.is_empty() {
            return Err(AppError::bad_request("at least one capability is required"));
        }

        let slug = if let Some(raw) = payload.slug {
            let normalized = normalize_slug(&raw)?;
            if is_system_slug(&normalized) {
                return Err(AppError::conflict("slug is reserved"));
            }
            normalized
        } else {
            let generated = compute_slug(&normalized_caps);
            if is_system_slug(&generated) {
                return Err(AppError::conflict(
                    "capabilities match a reserved system capability set",
                ));
            }
            generated
        };

        let set = create_capability_set_record(conn, tenant_id, &slug, original_caps)?;
        let response = to_response(set, normalized_caps);

        created_json(response)
    }

    pub fn update(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        id: Uuid,
        payload: UpdateCapabilitySetRequest,
    ) -> AppResult<JsonResponse<CapabilitySetResponse>> {
        let set = cs_dsl::capability_sets
            .filter(cs_dsl::tenant_id.eq(tenant_id))
            .find(id)
            .first::<CapabilitySet>(conn)
            .into_app_result()?;

        if set.is_system {
            if payload.slug.is_some() || payload.capabilities.is_some() {
                return Err(AppError::conflict(
                    "system capability sets cannot be modified",
                ));
            }
            let capabilities = load_capabilities_for_set(conn, set.id)?;
            return ok_json(to_response(set, capabilities));
        }

        let set = conn.transaction::<CapabilitySet, AppError, _>(|conn| {
            let mut working = set.clone();

            if let Some(slug) = &payload.slug {
                let normalized = normalize_slug(slug)?;
                if is_system_slug(&normalized) {
                    return Err(AppError::conflict("slug is reserved"));
                }

                if cs_dsl::capability_sets
                    .filter(cs_dsl::tenant_id.eq(tenant_id))
                    .filter(cs_dsl::slug.eq(&normalized))
                    .filter(cs_dsl::id.ne(working.id))
                    .first::<CapabilitySet>(conn)
                    .optional()
                    .into_app_result()?
                    .is_some()
                {
                    return Err(AppError::conflict("slug already exists"));
                }

                diesel::update(cs_dsl::capability_sets.find(working.id))
                    .set((
                        cs_dsl::slug.eq(&normalized),
                        cs_dsl::updated_at.eq(Utc::now().naive_utc()),
                    ))
                    .execute(conn)
                    .into_app_result()?;

                working.slug = normalized;
            }

            if let Some(capabilities) = &payload.capabilities {
                let normalized = normalize_capabilities(capabilities.clone())?;
                if normalized.is_empty() {
                    return Err(AppError::bad_request("at least one capability is required"));
                }

                let updated = refresh_capability_set(conn, &working, &normalized)?;
                working = updated;
            }

            capability_sets::table
                .find(working.id)
                .first::<CapabilitySet>(conn)
                .into_app_result()
        })?;

        let capabilities = load_capabilities_for_set(conn, set.id)?;
        ok_json(to_response(set, capabilities))
    }

    pub fn delete(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        id: Uuid,
    ) -> AppResult<StatusCode> {
        let set = cs_dsl::capability_sets
            .filter(cs_dsl::tenant_id.eq(tenant_id))
            .find(id)
            .first::<CapabilitySet>(conn)
            .into_app_result()?;

        if set.is_system {
            return Err(AppError::conflict(
                "system capability sets cannot be deleted",
            ));
        }

        let in_use_memberships: i64 = user_memberships::table
            .filter(user_memberships::capability_set_id.eq(Some(set.id)))
            .count()
            .get_result(conn)?;

        if in_use_memberships > 0 {
            return Err(AppError::conflict(
                "capability set is assigned to user memberships",
            ));
        }

        let in_use_tokens: i64 = api_tokens::table
            .filter(api_tokens::capability_set_id.eq(set.id))
            .count()
            .get_result(conn)?;

        if in_use_tokens > 0 {
            return Err(AppError::conflict(
                "capability set is assigned to API tokens",
            ));
        }

        diesel::delete(cs_dsl::capability_sets.find(set.id))
            .execute(conn)
            .into_app_result()?
            .or_not_found()?;

        no_content()
    }
}

fn normalize_slug(value: &str) -> AppResult<String> {
    let base = normalize_identifier(
        value,
        64,
        "slug must not be empty",
        "slug must not exceed 64 characters",
        Some("slug may only contain alphanumeric characters, hyphen, underscore, or whitespace"),
        |ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch.is_whitespace(),
    )?;

    let mut normalized = String::with_capacity(base.len());
    for ch in base.chars() {
        if ch.is_whitespace() {
            normalized.push('-');
        } else {
            normalized.push(ch.to_ascii_lowercase());
        }
    }

    if normalized.is_empty() {
        return Err(AppError::bad_request("slug must not be empty"));
    }

    Ok(normalized)
}

fn to_response(set: CapabilitySet, capabilities: Vec<ApiCapability>) -> CapabilitySetResponse {
    CapabilitySetResponse {
        id: set.id,
        slug: set.slug,
        is_system: set.is_system,
        cap_version: set.cap_version,
        capabilities,
    }
}
