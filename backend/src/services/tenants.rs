use chrono::Utc;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::{AppError, AppResult};
use crate::http::responders::{ok_json, JsonResponse};
use crate::models::ApiCapability;
use crate::schema::{
    capability_sets::dsl as cs_dsl, user_memberships::dsl as memberships_dsl,
    user_sessions::dsl as session_dsl, users::dsl as users_dsl,
};
use crate::state::AppState;

#[derive(Deserialize, ToSchema)]
pub struct UpdateTenantRequest {
    #[schema(example = "Acme Inc.")]
    pub name: String,
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateTenantUserRequest {
    #[schema(example = "a2f1bc73-4c90-4bb9-9da9-1c5d04be12ac")]
    pub capability_set_id: Uuid,
}

#[derive(Serialize, ToSchema)]
#[schema(example = json!({
    "user_id": "11111111-2222-3333-4444-555555555555",
    "username": "cfo",
    "capability_set_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "capability_set_slug": "owner"
}))]
pub struct TenantUserSummary {
    pub user_id: Uuid,
    pub username: String,
    pub capability_set_id: Option<Uuid>,
    pub capability_set_slug: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[schema(example = json!({
    "users": [
        {
            "user_id": "11111111-2222-3333-4444-555555555555",
            "username": "alice",
            "capability_set_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "capability_set_slug": "owner"
        },
        {
            "user_id": "66666666-7777-8888-9999-000000000000",
            "username": "bob",
            "capability_set_id": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
            "capability_set_slug": "user"
        }
    ]
}))]
pub struct TenantUserListResponse {
    pub users: Vec<TenantUserSummary>,
}

pub struct TenantApiService<'a> {
    state: &'a AppState,
}

impl<'a> TenantApiService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn update_name(
        &self,
        user: AuthenticatedUser,
        tenant_id: Uuid,
        payload: UpdateTenantRequest,
    ) -> AppResult<JsonResponse<crate::services::auth::TenantSnippet>> {
        self.ensure_can_manage(&user, tenant_id)?;
        let tenant = self.state.tenants.update_name(tenant_id, &payload.name)?;
        ok_json(crate::services::auth::TenantSnippet {
            id: tenant.id,
            name: tenant.name,
        })
    }

    pub fn list_users(
        &self,
        user: &AuthenticatedUser,
        tenant_id: Uuid,
    ) -> AppResult<JsonResponse<TenantUserListResponse>> {
        self.ensure_can_manage(user, tenant_id)?;
        let mut conn = self.state.db_for_tenant(tenant_id)?;
        let rows: Vec<(Uuid, String, Option<Uuid>, Option<String>)> =
            memberships_dsl::user_memberships
                .inner_join(users_dsl::users.on(users_dsl::id.eq(memberships_dsl::user_id)))
                .left_join(
                    cs_dsl::capability_sets
                        .on(cs_dsl::id.nullable().eq(memberships_dsl::capability_set_id)),
                )
                .select((
                    users_dsl::id,
                    users_dsl::username,
                    memberships_dsl::capability_set_id,
                    cs_dsl::slug.nullable(),
                ))
                .order(users_dsl::username.asc())
                .load(&mut *conn)?;

        let users = rows
            .into_iter()
            .map(
                |(user_id, username, capability_set_id, capability_set_slug)| TenantUserSummary {
                    user_id,
                    username,
                    capability_set_id,
                    capability_set_slug,
                },
            )
            .collect();

        ok_json(TenantUserListResponse { users })
    }

    pub fn get_user(
        &self,
        user: &AuthenticatedUser,
        tenant_id: Uuid,
        target_user_id: Uuid,
    ) -> AppResult<JsonResponse<TenantUserSummary>> {
        self.ensure_can_manage(user, tenant_id)?;
        let mut conn = self.state.db_for_tenant(tenant_id)?;
        let summary = self.load_membership_summary(&mut *conn, tenant_id, target_user_id)?;
        ok_json(summary)
    }

    pub fn update_user(
        &self,
        user: &AuthenticatedUser,
        tenant_id: Uuid,
        target_user_id: Uuid,
        payload: UpdateTenantUserRequest,
    ) -> AppResult<JsonResponse<TenantUserSummary>> {
        self.ensure_can_manage(user, tenant_id)?;
        let mut conn = self.state.db_for_tenant(tenant_id)?;

        let capability_set_id = self.resolve_capability_set_id(&mut *conn, tenant_id, &payload)?;

        let updated = diesel::update(
            memberships_dsl::user_memberships
                .filter(memberships_dsl::tenant_id.eq(tenant_id))
                .filter(memberships_dsl::user_id.eq(target_user_id)),
        )
        .set((
            memberships_dsl::capability_set_id.eq(Some(capability_set_id)),
            memberships_dsl::updated_at.eq(Utc::now().naive_utc()),
        ))
        .execute(&mut *conn)?;

        if updated == 0 {
            return Err(AppError::not_found());
        }

        let summary = self.load_membership_summary(&mut *conn, tenant_id, target_user_id)?;
        ok_json(summary)
    }

    pub fn remove_user(
        &self,
        user: &AuthenticatedUser,
        tenant_id: Uuid,
        target_user_id: Uuid,
    ) -> AppResult<()> {
        self.ensure_can_manage(user, tenant_id)?;
        let mut conn = self.state.db_for_tenant(tenant_id)?;

        let removed = diesel::delete(
            memberships_dsl::user_memberships
                .filter(memberships_dsl::tenant_id.eq(tenant_id))
                .filter(memberships_dsl::user_id.eq(target_user_id)),
        )
        .execute(&mut *conn)?;

        if removed == 0 {
            return Err(AppError::not_found());
        }

        diesel::delete(
            session_dsl::user_sessions
                .filter(session_dsl::tenant_id.eq(tenant_id))
                .filter(session_dsl::user_id.eq(target_user_id)),
        )
        .execute(&mut *conn)?;

        Ok(())
    }

    fn ensure_can_manage(&self, user: &AuthenticatedUser, tenant_id: Uuid) -> AppResult<()> {
        if user.tenant_id != tenant_id {
            return Err(AppError::forbidden("cannot manage another tenant"));
        }

        if !user.capabilities.contains(&ApiCapability::TenantsWrite) {
            return Err(AppError::forbidden("missing tenants:write capability"));
        }

        Ok(())
    }

    fn resolve_capability_set_id(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        payload: &UpdateTenantUserRequest,
    ) -> AppResult<Uuid> {
        let exists = cs_dsl::capability_sets
            .filter(cs_dsl::tenant_id.eq(tenant_id))
            .filter(cs_dsl::id.eq(payload.capability_set_id))
            .select(cs_dsl::id)
            .first::<Uuid>(conn)
            .optional()?;
        exists.ok_or_else(AppError::not_found)
    }

    fn load_membership_summary(
        &self,
        conn: &mut PgConnection,
        tenant_id: Uuid,
        user_id: Uuid,
    ) -> AppResult<TenantUserSummary> {
        let row = memberships_dsl::user_memberships
            .filter(memberships_dsl::tenant_id.eq(tenant_id))
            .filter(memberships_dsl::user_id.eq(user_id))
            .inner_join(users_dsl::users.on(users_dsl::id.eq(memberships_dsl::user_id)))
            .left_join(
                cs_dsl::capability_sets
                    .on(cs_dsl::id.nullable().eq(memberships_dsl::capability_set_id)),
            )
            .select((
                users_dsl::id,
                users_dsl::username,
                memberships_dsl::capability_set_id,
                cs_dsl::slug.nullable(),
            ))
            .first::<(Uuid, String, Option<Uuid>, Option<String>)>(conn)
            .optional()?;

        match row {
            Some((user_id, username, capability_set_id, capability_set_slug)) => {
                Ok(TenantUserSummary {
                    user_id,
                    username,
                    capability_set_id,
                    capability_set_slug,
                })
            }
            None => Err(AppError::not_found()),
        }
    }
}
