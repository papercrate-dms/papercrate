use axum::http::StatusCode;
use chrono::{DateTime, NaiveDateTime};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::{
    api_tokens::{
        create_api_token as issue_token, list_api_tokens as load_tokens,
        regenerate_api_token as rotate_token, revoke_api_token as revoke_token,
    },
    capability_sets::load_capability_set,
    passkeys::PasskeySummary,
};
use crate::error::{AppError, AppResult};
use crate::http::responders::{created_json, no_content, ok_json, JsonResponse};
use crate::models::ApiToken;
use crate::state::{AppState, PgPooledConnection};
use crate::utils::time::to_iso;

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiTokenResponse {
    pub id: Uuid,
    pub tenant_id: Uuid,
    #[schema(nullable)]
    pub label: Option<String>,
    pub capability_set_id: Uuid,
    pub created_at: String,
    #[schema(nullable)]
    pub last_used_at: Option<String>,
    #[schema(nullable)]
    pub expires_at: Option<String>,
    #[schema(nullable)]
    pub revoked_at: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiTokenCreatedResponse {
    pub token: String,
    pub token_info: ApiTokenResponse,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateApiTokenRequest {
    #[schema(nullable)]
    pub label: Option<String>,
    #[schema(nullable)]
    pub expires_at: Option<String>,
    pub capability_set_id: Uuid,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RevokePasskeyQuery {
    #[serde(default)]
    #[schema(nullable)]
    pub reason: Option<String>,
}

pub struct ProfileService<'a> {
    state: &'a AppState,
}

impl<'a> ProfileService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn list_passkeys(
        &self,
        conn: &mut PgPooledConnection,
        user_id: Uuid,
    ) -> AppResult<JsonResponse<Vec<PasskeySummary>>> {
        let service = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?;

        let passkeys = service.list_for_user(conn, user_id)?;
        ok_json(passkeys)
    }

    pub fn list_api_tokens(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        user_id: Uuid,
    ) -> AppResult<JsonResponse<Vec<ApiTokenResponse>>> {
        let tokens = load_tokens(conn, user_id, Some(tenant_id))?;
        let responses = tokens.into_iter().map(api_token_to_response).collect();
        ok_json(responses)
    }

    pub fn create_api_token(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        payload: CreateApiTokenRequest,
    ) -> AppResult<JsonResponse<ApiTokenCreatedResponse>> {
        let expires_at = payload
            .expires_at
            .as_ref()
            .map(|value| parse_timestamp(value))
            .transpose()?;

        let capability_set_id =
            validate_capability_set(conn, tenant_id, payload.capability_set_id)?;

        let issued = issue_token(
            conn,
            user_id,
            tenant_id,
            payload.label.clone(),
            expires_at,
            capability_set_id,
        )?;

        let token_info = api_token_to_response(issued.record);

        let response = ApiTokenCreatedResponse {
            token: issued.token,
            token_info,
        };

        created_json(response)
    }

    pub fn regenerate_api_token(
        &self,
        conn: &mut PgPooledConnection,
        tenant_id: Uuid,
        user_id: Uuid,
        token_id: Uuid,
    ) -> AppResult<JsonResponse<ApiTokenCreatedResponse>> {
        let issued = rotate_token(conn, token_id, user_id, Some(tenant_id))?;
        let token_info = api_token_to_response(issued.record);
        ok_json(ApiTokenCreatedResponse {
            token: issued.token,
            token_info,
        })
    }

    pub fn delete_api_token(
        &self,
        conn: &mut PgPooledConnection,
        user_id: Uuid,
        token_id: Uuid,
    ) -> AppResult<StatusCode> {
        revoke_token(conn, token_id, user_id)?;
        no_content()
    }

    pub fn delete_passkey(
        &self,
        conn: &mut PgPooledConnection,
        user_id: Uuid,
        passkey_id: Uuid,
        reason: Option<String>,
    ) -> AppResult<StatusCode> {
        let service = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?;

        let active_count = service.active_passkey_count(conn, user_id)?;
        if active_count <= 1 {
            return Err(AppError::bad_request(
                "cannot revoke the last remaining passkey",
            ));
        }

        service.revoke_passkey(conn, user_id, passkey_id, reason)?;
        no_content()
    }
}

fn api_token_to_response(token: ApiToken) -> ApiTokenResponse {
    let ApiToken {
        id,
        tenant_id,
        label,
        created_at,
        last_used_at,
        expires_at,
        revoked_at,
        capability_set_id,
        ..
    } = token;

    ApiTokenResponse {
        id,
        tenant_id,
        label,
        capability_set_id,
        created_at: to_iso(created_at),
        last_used_at: last_used_at.map(to_iso),
        expires_at: expires_at.map(to_iso),
        revoked_at: revoked_at.map(to_iso),
    }
}

fn parse_timestamp(value: &str) -> AppResult<NaiveDateTime> {
    let dt = DateTime::parse_from_rfc3339(value)
        .map_err(|_| AppError::bad_request("invalid expires_at timestamp"))?;
    Ok(dt.naive_utc())
}

fn validate_capability_set(
    conn: &mut PgPooledConnection,
    tenant_id: Uuid,
    capability_set_id: Uuid,
) -> AppResult<Uuid> {
    let set = load_capability_set(conn, capability_set_id)?;
    if set.tenant_id != tenant_id {
        return Err(AppError::bad_request(
            "capability set does not belong to the tenant",
        ));
    }
    Ok(set.id)
}
