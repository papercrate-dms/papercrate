use axum::http::{header::SET_COOKIE, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{Duration as ChronoDuration, TimeZone, Utc};
use diesel::{pg::PgConnection, prelude::*, Connection, OptionalExtension};
use rand::{rngs::OsRng, TryRngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;
use uuid::Uuid;
use webauthn_rs::prelude::RegisterPublicKeyCredential;

use crate::auth::{
    api_tokens::{find_active_token_by_secret, touch_api_token},
    capability_sets::load_capability_set,
    jwt::{AccessTokenContext, PrincipalKind},
    passkeys::{
        AuthenticationChallengeResponse, PasskeyLoginFinishPayload,
        PasskeyRegistrationFinishPayload, PasskeySummary, RegistrationChallengeResponse,
    },
    AuthenticatedUser,
};
use crate::error::{AppError, AppResult};
use crate::http::responders::{ok_json, JsonResponse};
use crate::models::{
    MagicToken, MagicTokenKind, NewUser, NewUserSession, TenantStatus, User, UserMembership,
    UserSession,
};
use crate::schema::{
    magic_tokens::dsl as magic_dsl,
    tenants::dsl as tenant_dsl,
    user_memberships::dsl as memberships_dsl,
    user_passkeys::dsl as passkey_dsl,
    user_sessions::{self, dsl as session_dsl},
    users::dsl,
};
use crate::state::{AppState, PgPooledConnection};
use crate::tenants::{
    apply_tenant_guc, apply_user_guc, apply_user_session_hash, clear_user_guc,
    clear_user_session_hash,
};
use crate::utils::text::normalize_identifier;

pub const SESSION_COOKIE_NAME: &str = "refresh_token";

#[derive(Deserialize, ToSchema)]
pub struct LoginRequest {
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    #[schema(nullable)]
    pub password: Option<String>,
    #[serde(default)]
    #[schema(nullable)]
    pub magic_token: Option<String>,
    #[serde(default)]
    #[schema(nullable)]
    pub preferred_tenant_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ApiTokenExchangeRequest {
    pub api_token: String,
}

#[derive(Serialize, Deserialize, ToSchema, Clone)]
pub struct LoginResponse {
    pub access_token: String,
    pub token_type: String,
    pub expires_in: i64,
    pub tenant: TenantSnippet,
}

#[derive(Serialize, Deserialize, ToSchema, Clone)]
pub struct TenantSnippet {
    pub id: Uuid,
    pub name: String,
}

#[derive(Serialize, Deserialize, ToSchema, Clone)]
pub struct TenantSelectionResponse {
    pub access_token: String,
    pub tenants: Vec<TenantSnippet>,
}

#[derive(Serialize, Deserialize, ToSchema, Clone)]
pub struct TenantListResponse {
    pub tenants: Vec<TenantSnippet>,
}

#[derive(Deserialize, ToSchema)]
pub struct TenantSelectionRequest {
    pub tenant_id: Uuid,
}

#[derive(Deserialize, ToSchema)]
pub struct SignupStartRequest {
    pub username: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct SignupStartResponse {
    pub signup_token: String,
    pub challenge: RegistrationChallengeResponse,
}

#[derive(Deserialize, ToSchema)]
pub struct SignupFinishRequest {
    pub signup_token: String,
    #[schema(value_type = Object)]
    pub credential: RegisterPublicKeyCredential,
    #[schema(nullable)]
    pub nickname: Option<String>,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum LoginResponseVariants {
    Token(LoginResponse),
    Selection(TenantSelectionResponse),
}

pub struct AuthService<'a> {
    state: &'a AppState,
}

impl<'a> AuthService<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn login(&self, payload: LoginRequest) -> AppResult<Response> {
        let magic_token = payload
            .magic_token
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty());

        if magic_token.is_none() {
            if payload.password.is_some() {
                return Err(AppError::bad_request(
                    "password authentication is no longer supported",
                ));
            }

            return Err(AppError::bad_request(
                "magic_token is required for passwordless login",
            ));
        }

        let token_value = magic_token.unwrap();

        let mut conn = self.state.db_unscoped()?;
        let username_hint = payload.username.trim();
        let preferred_tenant_id = payload.preferred_tenant_id;

        self.magic_token_login(
            &mut conn,
            token_value,
            (!username_hint.is_empty()).then_some(username_hint),
            preferred_tenant_id,
        )
    }

    pub fn exchange_api_token(
        &self,
        payload: ApiTokenExchangeRequest,
    ) -> AppResult<JsonResponse<LoginResponse>> {
        let secret = payload.api_token.trim();
        if secret.is_empty() {
            return Err(AppError::bad_request("api_token must not be empty"));
        }

        let mut conn = self.state.db_unscoped()?;

        let token = find_active_token_by_secret(&mut conn, None, secret, None)?
            .ok_or_else(AppError::unauthorized)?;

        let user: User = dsl::users.find(token.user_id).first(&mut conn)?;

        apply_user_guc(&mut conn, user.id)?;
        let membership = memberships_dsl::user_memberships
            .filter(memberships_dsl::user_id.eq(user.id))
            .filter(memberships_dsl::tenant_id.eq(token.tenant_id))
            .first::<UserMembership>(&mut conn)
            .optional()?;
        clear_user_guc(&mut conn)?;

        let membership = membership.ok_or_else(AppError::unauthorized)?;

        let membership_capability_set = membership.capability_set_id.ok_or_else(|| {
            AppError::new(
                StatusCode::FORBIDDEN,
                "membership has no capability set assigned",
            )
        })?;

        let token_capability_set = load_capability_set(&mut conn, token.capability_set_id)?;
        let _membership_set = load_capability_set(&mut conn, membership_capability_set)?;

        apply_tenant_guc(&mut conn, token.tenant_id)?;
        touch_api_token(&mut conn, token.id)?;

        let access_token = self
            .state
            .jwt
            .generate_token(AccessTokenContext {
                user_id: user.id,
                tenant_id: token.tenant_id,
                username: user.username.clone(),
                principal_kind: PrincipalKind::ApiToken,
                principal_id: token.id,
                capability_set_id: token_capability_set.id,
                cap_version: token_capability_set.cap_version,
            })
            .map_err(AppError::from)?;

        let tenant_name: String = tenant_dsl::tenants
            .find(token.tenant_id)
            .select(tenant_dsl::name)
            .first(&mut conn)
            .map_err(AppError::from)?;

        ok_json(LoginResponse {
            access_token,
            token_type: "Bearer".to_string(),
            expires_in: self.state.config.jwt_expiry_minutes * 60,
            tenant: TenantSnippet {
                id: token.tenant_id,
                name: tenant_name,
            },
        })
    }

    pub fn signup_start(
        &self,
        payload: SignupStartRequest,
    ) -> AppResult<JsonResponse<SignupStartResponse>> {
        let username = normalize_username(&payload.username)?;

        let mut conn = self.state.db_unscoped()?;
        let exists: bool = dsl::users
            .filter(dsl::username.eq(&username))
            .first::<User>(&mut conn)
            .optional()?
            .is_some();
        if exists {
            return Err(AppError::conflict("username already exists"));
        }

        let user_id = Uuid::new_v4();
        let challenge = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?
            .start_signup_registration(&mut conn, user_id, username.as_str())?;

        let signup_token = self
            .state
            .jwt
            .generate_signup_token(user_id, challenge.challenge_id, username.clone())
            .map_err(AppError::from)?;

        ok_json(SignupStartResponse {
            signup_token,
            challenge,
        })
    }

    pub fn signup_finish(&self, payload: SignupFinishRequest) -> AppResult<Response> {
        let claims = self
            .state
            .jwt
            .verify_signup_token(&payload.signup_token)
            .map_err(|_| AppError::unauthorized())?;

        let mut conn = self.state.db_unscoped()?;

        let exists: bool = dsl::users
            .filter(dsl::username.eq(&claims.username))
            .first::<User>(&mut conn)
            .optional()?
            .is_some();
        if exists {
            return Err(AppError::conflict("username already exists"));
        }

        let service = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?;

        let prepared_passkey = service.consume_signup_challenge(
            &mut conn,
            claims.challenge_id,
            &payload.credential,
        )?;

        let state_clone = self.state.clone();
        let response = conn.transaction::<Response, AppError, _>(|conn| {
            insert_user(conn, claims.sub, &claims.username)?;

            let tenant = state_clone.tenants.create_tenant_with_conn(
                conn,
                &claims.username,
                None,
                None,
                TenantStatus::Creating,
                &[claims.sub],
                Some(claims.sub),
            )?;

            let passkey_insert =
                prepared_passkey.into_new_user_passkey(claims.sub, payload.nickname.clone());

            diesel::insert_into(passkey_dsl::user_passkeys)
                .values(&passkey_insert)
                .execute(conn)
                .map_err(AppError::from)?;

            let user: User = dsl::users.find(claims.sub).first(conn)?;
            self.issue_session(conn, &user, tenant.id)
        })?;

        Ok(response)
    }

    pub fn refresh(&self, refresh_value: &str) -> AppResult<Response> {
        let hashed = hash_session_token(refresh_value);
        let mut conn = self.state.db_unscoped()?;
        let now = Utc::now();
        let now_naive = now.naive_utc();

        apply_user_session_hash(&mut conn, &hashed)?;
        let token = match session_dsl::user_sessions
            .filter(session_dsl::token_hash.eq(&hashed))
            .filter(session_dsl::revoked_at.is_null())
            .filter(session_dsl::expires_at.gt(now_naive))
            .first::<UserSession>(&mut conn)
        {
            Ok(token) => token,
            Err(diesel::result::Error::NotFound) => return Err(AppError::unauthorized()),
            Err(err) => return Err(AppError::from(err)),
        };

        clear_user_session_hash(&mut conn)?;
        apply_tenant_guc(&mut conn, token.tenant_id)?;
        clear_user_guc(&mut conn)?;

        diesel::update(session_dsl::user_sessions.filter(session_dsl::id.eq(token.id)))
            .set((
                session_dsl::revoked_at.eq(now_naive),
                session_dsl::updated_at.eq(now_naive),
            ))
            .execute(&mut conn)?;

        let user: User = dsl::users
            .find(token.user_id)
            .first(&mut conn)
            .map_err(AppError::from)?;

        self.issue_session(&mut conn, &user, token.tenant_id)
    }

    pub fn select_tenant(&self, token: &str, tenant_id: Uuid) -> AppResult<Response> {
        let user_id = match self.state.jwt.verify_tenant_selector_token(token) {
            Ok(claims) => claims.sub,
            Err(_) => self
                .state
                .jwt
                .verify_token(token)
                .map(|claims| claims.sub)
                .map_err(|_| AppError::unauthorized())?,
        };

        let mut conn = self.state.db_unscoped()?;
        apply_user_guc(&mut conn, user_id)?;

        let membership_exists = memberships_dsl::user_memberships
            .filter(memberships_dsl::user_id.eq(user_id))
            .filter(memberships_dsl::tenant_id.eq(tenant_id))
            .select(memberships_dsl::tenant_id)
            .first::<Uuid>(&mut conn)
            .optional()?;

        clear_user_guc(&mut conn)?;

        if membership_exists.is_none() {
            return Err(AppError::unauthorized());
        }

        let user: User = dsl::users
            .find(user_id)
            .first(&mut conn)
            .map_err(AppError::from)?;

        self.issue_session(&mut conn, &user, tenant_id)
    }

    pub fn logout(
        &self,
        conn: &mut PgPooledConnection,
        user: &AuthenticatedUser,
        refresh_cookie: Option<&str>,
    ) -> AppResult<(HeaderMap, StatusCode)> {
        let now = Utc::now().naive_utc();

        let revoked = if let Some(value) = refresh_cookie {
            let hashed = hash_session_token(value);
            diesel::update(
                session_dsl::user_sessions
                    .filter(session_dsl::token_hash.eq(hashed))
                    .filter(session_dsl::user_id.eq(user.user_id))
                    .filter(session_dsl::revoked_at.is_null()),
            )
            .set((
                session_dsl::revoked_at.eq(now),
                session_dsl::updated_at.eq(now),
            ))
            .execute(conn)?
        } else {
            0
        };

        if revoked == 0 {
            diesel::update(
                session_dsl::user_sessions
                    .filter(session_dsl::user_id.eq(user.user_id))
                    .filter(session_dsl::tenant_id.eq(user.tenant_id))
                    .filter(session_dsl::revoked_at.is_null()),
            )
            .set((
                session_dsl::revoked_at.eq(now),
                session_dsl::updated_at.eq(now),
            ))
            .execute(conn)?;
        }

        let mut headers = HeaderMap::new();
        headers.insert(SET_COOKIE, build_clear_session_cookie(self.state));
        Ok((headers, StatusCode::NO_CONTENT))
    }

    pub fn list_tenants(&self, user_id: Uuid) -> AppResult<JsonResponse<TenantListResponse>> {
        let mut conn = self.state.db_unscoped()?;
        apply_user_guc(&mut conn, user_id)?;

        let tenant_ids: Vec<Uuid> = memberships_dsl::user_memberships
            .filter(memberships_dsl::user_id.eq(user_id))
            .select(memberships_dsl::tenant_id)
            .load(&mut conn)?;

        clear_user_guc(&mut conn)?;

        let mut tenants = Vec::with_capacity(tenant_ids.len());
        for tenant_id in tenant_ids {
            let (name, status): (String, TenantStatus) = tenant_dsl::tenants
                .find(tenant_id)
                .select((tenant_dsl::name, tenant_dsl::status))
                .first(&mut conn)
                .map_err(AppError::from)?;
            if status != TenantStatus::Active {
                continue;
            }
            tenants.push(TenantSnippet {
                id: tenant_id,
                name,
            });
        }

        ok_json(TenantListResponse { tenants })
    }

    pub fn get_tenant(
        &self,
        user_id: Uuid,
        tenant_id: Uuid,
    ) -> AppResult<JsonResponse<TenantSnippet>> {
        let mut conn = self.state.db_unscoped()?;
        apply_user_guc(&mut conn, user_id)?;

        let is_member: bool = diesel::select(diesel::dsl::exists(
            memberships_dsl::user_memberships
                .filter(memberships_dsl::user_id.eq(user_id))
                .filter(memberships_dsl::tenant_id.eq(tenant_id)),
        ))
        .get_result(&mut conn)?;

        clear_user_guc(&mut conn)?;

        if !is_member {
            return Err(AppError::not_found());
        }

        let (name, status): (String, TenantStatus) = tenant_dsl::tenants
            .find(tenant_id)
            .select((tenant_dsl::name, tenant_dsl::status))
            .first(&mut conn)
            .map_err(AppError::from)?;

        if status != TenantStatus::Active {
            return Err(AppError::not_found());
        }

        ok_json(TenantSnippet {
            id: tenant_id,
            name,
        })
    }

    pub fn passkey_register_start(
        &self,
        user: AuthenticatedUser,
    ) -> AppResult<JsonResponse<RegistrationChallengeResponse>> {
        let service = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?;

        let mut conn = self.state.db_unscoped()?;
        let current_user: User = dsl::users.find(user.user_id).first(&mut conn)?;
        let challenge = service.start_registration(&mut conn, &current_user)?;
        ok_json(challenge)
    }

    pub fn passkey_register_finish(
        &self,
        user: AuthenticatedUser,
        payload: PasskeyRegistrationFinishPayload,
    ) -> AppResult<JsonResponse<PasskeySummary>> {
        let service = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?;

        let mut conn = self.state.db_unscoped()?;
        let current_user: User = dsl::users.find(user.user_id).first(&mut conn)?;

        let PasskeyRegistrationFinishPayload {
            challenge_id,
            credential,
            nickname,
        } = payload;

        let passkey = service.finish_registration(
            &mut conn,
            &current_user,
            challenge_id,
            credential,
            nickname,
        )?;

        ok_json(PasskeySummary::from(passkey))
    }

    pub fn passkey_login_start(
        &self,
        username: &str,
    ) -> AppResult<JsonResponse<AuthenticationChallengeResponse>> {
        let username = normalize_username(username)?;

        let service = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?;

        let mut conn = self.state.db_unscoped()?;
        let user: User = dsl::users
            .filter(dsl::username.eq(&username))
            .first(&mut conn)?;

        let challenge = service.start_authentication(&mut conn, &user)?;
        ok_json(challenge)
    }

    pub fn passkey_login_finish(&self, payload: PasskeyLoginFinishPayload) -> AppResult<Response> {
        let service = self
            .state
            .passkeys
            .as_ref()
            .ok_or_else(|| AppError::bad_request("passkey support is disabled"))?;

        let mut conn = self.state.db_unscoped()?;
        let (user, _passkey, auth_result) =
            service.finish_authentication(&mut conn, payload.challenge_id, payload.credential)?;

        if !auth_result.user_verified() {
            return Err(AppError::unauthorized());
        }

        self.complete_login(&mut conn, &user, None)
    }

    fn complete_login(
        &self,
        conn: &mut PgConnection,
        user: &User,
        preferred_tenant_id: Option<Uuid>,
    ) -> AppResult<Response> {
        apply_user_guc(conn, user.id)?;
        let tenant_ids: Vec<Uuid> = memberships_dsl::user_memberships
            .filter(memberships_dsl::user_id.eq(user.id))
            .select(memberships_dsl::tenant_id)
            .load(conn)?;
        clear_user_guc(conn)?;

        if tenant_ids.is_empty() {
            return Err(AppError::unauthorized());
        }

        let mut active_tenants = Vec::new();
        for tenant_id in tenant_ids {
            let (name, status): (String, TenantStatus) = tenant_dsl::tenants
                .find(tenant_id)
                .select((tenant_dsl::name, tenant_dsl::status))
                .first(conn)
                .map_err(AppError::from)?;
            if status == TenantStatus::Active {
                active_tenants.push((tenant_id, name));
            }
        }

        if active_tenants.is_empty() {
            return Err(AppError::new(
                StatusCode::FORBIDDEN,
                "no active tenants available",
            ));
        }

        if let Some(preferred_id) = preferred_tenant_id {
            if active_tenants.iter().any(|(id, _)| *id == preferred_id) {
                return self.issue_session(conn, user, preferred_id);
            }
        }

        if active_tenants.len() == 1 {
            return self.issue_session(conn, user, active_tenants[0].0);
        }

        let selection_token = self
            .state
            .jwt
            .generate_tenant_selector_token(user.id)
            .map_err(AppError::from)?;

        let tenants = active_tenants
            .into_iter()
            .map(|(id, name)| TenantSnippet { id, name })
            .collect();

        let response = ok_json(LoginResponseVariants::Selection(TenantSelectionResponse {
            access_token: selection_token,
            tenants,
        }))?;

        Ok(response.into_response())
    }

    fn magic_token_login(
        &self,
        conn: &mut PgConnection,
        token_value: &str,
        username_hint: Option<&str>,
        preferred_tenant_id: Option<Uuid>,
    ) -> AppResult<Response> {
        if token_value.is_empty() {
            return Err(AppError::bad_request("magic_token must not be empty"));
        }

        let token_hash = hash_magic_token(token_value);
        let now = Utc::now();
        let now_naive = now.naive_utc();

        conn.transaction::<Response, AppError, _>(|conn| {
            let magic = magic_dsl::magic_tokens
                .filter(magic_dsl::token_hash.eq(&token_hash))
                .filter(magic_dsl::expires_at.gt(now_naive))
                .first::<MagicToken>(conn)
                .map_err(|err| match err {
                    diesel::result::Error::NotFound => AppError::unauthorized(),
                    _ => AppError::from(err),
                })?;

            if let Some(limit) = magic.max_uses {
                if magic.used_count >= limit {
                    return Err(AppError::unauthorized());
                }
            }

            match magic.kind {
                MagicTokenKind::EmailLogin | MagicTokenKind::DemoLogin => {}
            }

            let user: User = dsl::users
                .find(magic.user_id)
                .first(conn)
                .map_err(AppError::from)?;

            if let Some(expected) = username_hint {
                if expected != user.username {
                    return Err(AppError::unauthorized());
                }
            }

            diesel::update(magic_dsl::magic_tokens.filter(magic_dsl::id.eq(magic.id)))
                .set((
                    magic_dsl::used_count.eq(magic.used_count + 1),
                    magic_dsl::last_used_at.eq(Some(now_naive)),
                ))
                .execute(conn)?;

            self.complete_login(conn, &user, preferred_tenant_id)
        })
    }

    fn issue_session(
        &self,
        conn: &mut PgConnection,
        user: &User,
        tenant_id: Uuid,
    ) -> AppResult<Response> {
        crate::auth::ensure_active_tenant_with_conn(conn, tenant_id)?;
        apply_tenant_guc(conn, tenant_id)?;
        clear_user_guc(conn)?;
        clear_user_session_hash(conn)?;

        let membership: UserMembership = memberships_dsl::user_memberships
            .filter(memberships_dsl::user_id.eq(user.id))
            .filter(memberships_dsl::tenant_id.eq(tenant_id))
            .first(conn)?;

        let capability_set_id = membership.capability_set_id.ok_or_else(|| {
            AppError::new(
                StatusCode::FORBIDDEN,
                "membership has no capability set assigned",
            )
        })?;

        let capability_set = load_capability_set(conn, capability_set_id)?;

        let now = Utc::now();
        let session_id = Uuid::new_v4();
        let access_token = self
            .state
            .jwt
            .generate_token(AccessTokenContext {
                user_id: user.id,
                tenant_id,
                username: user.username.clone(),
                principal_kind: PrincipalKind::UserSession,
                principal_id: session_id,
                capability_set_id,
                cap_version: capability_set.cap_version,
            })
            .map_err(AppError::from)?;

        let tenant_name: String = tenant_dsl::tenants
            .find(tenant_id)
            .select(tenant_dsl::name)
            .first(conn)
            .map_err(AppError::from)?;

        let session_value = generate_session_token();
        let session_hash = hash_session_token(&session_value);
        let refresh_expires_at =
            now + ChronoDuration::days(self.state.config.refresh_token_expiry_days);

        let new_session = NewUserSession {
            id: session_id,
            user_id: user.id,
            token_hash: session_hash,
            issued_at: now.naive_utc(),
            expires_at: refresh_expires_at.naive_utc(),
            tenant_id,
        };

        diesel::insert_into(user_sessions::table)
            .values(&new_session)
            .execute(conn)?;

        let json = ok_json(LoginResponseVariants::Token(LoginResponse {
            access_token,
            token_type: "Bearer".to_string(),
            expires_in: self.state.config.jwt_expiry_minutes * 60,
            tenant: TenantSnippet {
                id: tenant_id,
                name: tenant_name,
            },
        }))?;

        let mut response = json.into_response();

        response.headers_mut().insert(
            SET_COOKIE,
            build_session_cookie(self.state, &session_value, refresh_expires_at),
        );

        Ok(response)
    }
}

fn insert_user(conn: &mut PgConnection, id: Uuid, username: &str) -> AppResult<()> {
    let new_user = NewUser {
        id,
        username: username.to_string(),
    };

    diesel::insert_into(dsl::users)
        .values(&new_user)
        .execute(conn)
        .map(|_| ())
        .map_err(AppError::from)
}

fn hash_session_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

fn hash_magic_token(token: &str) -> String {
    hash_session_token(token)
}

fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .expect("failed to read random bytes");
    hex::encode(bytes)
}

fn build_cookie(
    state: &AppState,
    token: Option<&str>,
    expires_at: Option<chrono::DateTime<Utc>>,
    max_age: i64,
) -> HeaderValue {
    let mut parts = vec![format!("{}={}", SESSION_COOKIE_NAME, token.unwrap_or(""))];
    parts.push("Path=/".into());
    parts.push("HttpOnly".into());
    parts.push("SameSite=Strict".into());
    parts.push(format!("Max-Age={}", max_age));
    if let Some(expires) = expires_at {
        parts.push(format!("Expires={}", expires.to_rfc2822()));
    }
    if state.config.refresh_cookie_secure {
        parts.push("Secure".into());
    }
    if let Some(domain) = &state.config.refresh_cookie_domain {
        parts.push(format!("Domain={}", domain));
    }

    HeaderValue::from_str(&parts.join("; ")).expect("valid session cookie")
}

fn build_session_cookie(
    state: &AppState,
    token: &str,
    expires_at: chrono::DateTime<Utc>,
) -> HeaderValue {
    let max_age = ChronoDuration::days(state.config.refresh_token_expiry_days).num_seconds();
    build_cookie(state, Some(token), Some(expires_at), max_age)
}

fn build_clear_session_cookie(state: &AppState) -> HeaderValue {
    let epoch = Utc.timestamp_opt(0, 0).single().unwrap();
    build_cookie(state, None, Some(epoch), 0)
}

fn normalize_username(value: &str) -> AppResult<String> {
    normalize_identifier(
        value,
        100,
        "username must not be empty",
        "username must not exceed 100 characters",
        Some("username may only contain printable characters"),
        |ch| !ch.is_control(),
    )
}
