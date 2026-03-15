use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
    Json,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization, Cookie},
    typed_header::TypedHeader,
};
use utoipa::OpenApi;

use crate::{
    auth::{
        passkeys::{
            AuthenticationChallengeResponse, PasskeyLoginFinishPayload, PasskeyLoginStartPayload,
            PasskeyRegistrationFinishPayload, PasskeySummary, RegistrationChallengeResponse,
        },
        AuthenticatedUser, TenantScopedConn,
    },
    error::{AppError, AppResult},
    http::responders::JsonResponse,
    services::auth::{
        ApiTokenExchangeRequest, AuthService, LoginRequest, LoginResponse, LoginResponseVariants,
        SignupFinishRequest, SignupStartRequest, SignupStartResponse, TenantListResponse,
        TenantSelectionRequest, TenantSelectionResponse, TenantSnippet, SESSION_COOKIE_NAME,
    },
    state::AppState,
};

#[derive(OpenApi)]
#[openapi(
    paths(
        login,
        api_token_exchange,
        signup_start,
        signup_finish,
        refresh,
        logout,
        me,
        select_tenant,
        passkey_register_start,
        passkey_register_finish,
        passkey_login_start,
        passkey_login_finish,
    ),
    components(schemas(
        LoginRequest,
        ApiTokenExchangeRequest,
        SignupStartRequest,
        SignupStartResponse,
        SignupFinishRequest,
        LoginResponse,
        LoginResponseVariants,
        TenantSnippet,
        TenantSelectionResponse,
        TenantSelectionRequest,
        TenantListResponse,
        crate::auth::AuthenticatedUser,
        crate::auth::passkeys::RegistrationChallengeResponse,
        crate::auth::passkeys::AuthenticationChallengeResponse,
        crate::auth::passkeys::PasskeySummary,
        crate::auth::passkeys::PasskeyRegistrationFinishPayload,
        crate::auth::passkeys::PasskeyLoginStartPayload,
        crate::auth::passkeys::PasskeyLoginFinishPayload,
        crate::models::ApiCapability,
    ))
)]
pub struct AuthApiDoc;

#[utoipa::path(
    post,
    path = "/api/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login succeeded", body = LoginResponseVariants),
        (status = 401, description = "Invalid credentials")
    ),
    tag = "Auth"
)]
pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> AppResult<Response> {
    AuthService::new(&state).login(payload)
}

#[utoipa::path(
    post,
    path = "/api/auth/exchange-api-token",
    request_body = ApiTokenExchangeRequest,
    responses((status = 200, description = "Access token issued", body = LoginResponse)),
    tag = "Auth"
)]
pub async fn api_token_exchange(
    State(state): State<AppState>,
    Json(payload): Json<ApiTokenExchangeRequest>,
) -> AppResult<JsonResponse<LoginResponse>> {
    AuthService::new(&state).exchange_api_token(payload)
}

#[utoipa::path(
    post,
    path = "/api/auth/signup/start",
    request_body = SignupStartRequest,
    responses(
        (status = 200, description = "Signup challenge created", body = SignupStartResponse),
        (status = 400, description = "Invalid signup request"),
        (status = 409, description = "Username already exists")
    ),
    tag = "Auth"
)]
pub async fn signup_start(
    State(state): State<AppState>,
    Json(payload): Json<SignupStartRequest>,
) -> AppResult<JsonResponse<SignupStartResponse>> {
    AuthService::new(&state).signup_start(payload)
}

#[utoipa::path(
    post,
    path = "/api/auth/signup/finish",
    request_body = SignupFinishRequest,
    responses(
        (status = 200, description = "Signup completed", body = LoginResponseVariants),
        (status = 400, description = "Invalid signup completion"),
        (status = 409, description = "Username already exists")
    ),
    tag = "Auth"
)]
pub async fn signup_finish(
    State(state): State<AppState>,
    Json(payload): Json<SignupFinishRequest>,
) -> AppResult<Response> {
    AuthService::new(&state).signup_finish(payload)
}

#[utoipa::path(
    post,
    path = "/api/auth/refresh",
    responses(
        (status = 200, description = "Refreshed access token", body = LoginResponse),
        (status = 401, description = "Missing or invalid refresh token")
    ),
    tag = "Auth"
)]
pub async fn refresh(
    State(state): State<AppState>,
    jar: Option<TypedHeader<Cookie>>,
) -> AppResult<Response> {
    let cookies = jar.ok_or_else(AppError::unauthorized)?;
    let refresh_value = cookies
        .get(SESSION_COOKIE_NAME)
        .ok_or_else(AppError::unauthorized)?;

    AuthService::new(&state).refresh(refresh_value)
}

#[utoipa::path(
    post,
    path = "/api/auth/select-tenant",
    request_body = TenantSelectionRequest,
    responses((status = 200, description = "Tenant selected", body = LoginResponse)),
    tag = "Auth"
)]
pub async fn select_tenant(
    State(state): State<AppState>,
    TypedHeader(Authorization(bearer)): TypedHeader<Authorization<Bearer>>,
    Json(payload): Json<TenantSelectionRequest>,
) -> AppResult<Response> {
    AuthService::new(&state).select_tenant(bearer.token(), payload.tenant_id)
}

#[utoipa::path(
    post,
    path = "/api/auth/logout",
    responses((status = 204, description = "Session revoked")),
    tag = "Auth"
)]
pub async fn logout(
    State(state): State<AppState>,
    TenantScopedConn { mut conn, user, .. }: TenantScopedConn,
    jar: Option<TypedHeader<Cookie>>,
) -> AppResult<(HeaderMap, StatusCode)> {
    let refresh_cookie = jar.as_ref().and_then(|cookies| {
        cookies
            .get(SESSION_COOKIE_NAME)
            .map(|value| value.to_owned())
    });
    conn.scoped(|tx| {
        AuthService::new(&state).logout(tx, &user, refresh_cookie.as_deref())
    })
}

#[utoipa::path(
    get,
    path = "/api/auth/me",
    responses((status = 200, description = "Current session", body = crate::auth::AuthenticatedUser)),
    tag = "Auth"
)]
pub async fn me(user: AuthenticatedUser) -> Json<AuthenticatedUser> {
    Json(user)
}

#[utoipa::path(
    post,
    path = "/api/auth/passkeys/register/start",
    responses((status = 200, body = crate::auth::passkeys::RegistrationChallengeResponse)),
    tag = "Auth"
)]
pub async fn passkey_register_start(
    State(state): State<AppState>,
    user: AuthenticatedUser,
) -> AppResult<JsonResponse<RegistrationChallengeResponse>> {
    AuthService::new(&state).passkey_register_start(user)
}

#[utoipa::path(
    post,
    path = "/api/auth/passkeys/register/finish",
    request_body = crate::auth::passkeys::PasskeyRegistrationFinishPayload,
    responses((status = 201, body = crate::auth::passkeys::PasskeySummary)),
    tag = "Auth"
)]
pub async fn passkey_register_finish(
    State(state): State<AppState>,
    user: AuthenticatedUser,
    Json(payload): Json<PasskeyRegistrationFinishPayload>,
) -> AppResult<JsonResponse<PasskeySummary>> {
    AuthService::new(&state).passkey_register_finish(user, payload)
}

#[utoipa::path(
    post,
    path = "/api/auth/passkeys/login/start",
    request_body = crate::auth::passkeys::PasskeyLoginStartPayload,
    responses((status = 200, body = crate::auth::passkeys::AuthenticationChallengeResponse)),
    tag = "Auth"
)]
pub async fn passkey_login_start(
    State(state): State<AppState>,
    Json(payload): Json<PasskeyLoginStartPayload>,
) -> AppResult<JsonResponse<AuthenticationChallengeResponse>> {
    AuthService::new(&state).passkey_login_start(&payload.username)
}

#[utoipa::path(
    post,
    path = "/api/auth/passkeys/login/finish",
    request_body = crate::auth::passkeys::PasskeyLoginFinishPayload,
    responses(
        (status = 200, description = "Passkey login successful", body = LoginResponseVariants),
        (status = 401, description = "Authentication failed")
    ),
    tag = "Auth"
)]
pub async fn passkey_login_finish(
    State(state): State<AppState>,
    Json(payload): Json<PasskeyLoginFinishPayload>,
) -> AppResult<Response> {
    AuthService::new(&state).passkey_login_finish(payload)
}
