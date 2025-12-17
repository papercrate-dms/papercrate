use anyhow::{anyhow, Context, Result};
use axum::http::{header::SET_COOKIE, StatusCode};
use chrono::{Duration as ChronoDuration, Utc};
use diesel::prelude::*;
use papercrate::auth::capability_sets::{ensure_capability_set, owner_capabilities};
use papercrate::auth::jwt::{AccessTokenContext, PrincipalKind};
use papercrate::auth::passkeys::{
    PasskeyLoginFinishPayload, PasskeyLoginStartPayload, PasskeyRegistrationFinishPayload,
    RegistrationChallengeResponse,
};
use papercrate::models::{
    MagicToken, MagicTokenKind, NewUserMembership, NewUserSession, TenantStatus, UserPasskey,
};
use papercrate::openapi::schemas::PasskeySummary;
use papercrate::schema::{
    capability_sets, magic_tokens::dsl as magic_dsl, tenants, tenants::dsl as tenant_dsl,
    user_memberships, user_sessions, users,
};
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use rand::{rngs::OsRng, TryRngCore};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use webauthn_rs_core::proto::{
    AuthenticatorAssertionResponseRaw, AuthenticatorAttestationResponseRaw, PublicKeyCredential,
    RegisterPublicKeyCredential,
};

#[derive(Deserialize)]
struct AuthenticatedUser {
    username: String,
}

#[derive(Deserialize)]
struct ApiErrorResponse {
    error: String,
    #[serde(default)]
    _code: Option<String>,
}

#[derive(Deserialize)]
struct LoginTenant {
    id: Uuid,
    name: String,
}

#[derive(Deserialize)]
struct LoginResponse {
    access_token: String,
    tenant: LoginTenant,
}

#[derive(Deserialize)]
struct SignupStartResponse {
    signup_token: String,
    challenge: RegistrationChallengeResponse,
}

#[derive(Deserialize)]
struct TenantSummary {
    id: Uuid,
    name: String,
}

#[tokio::test]
async fn login_and_me_roundtrip() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "s3cret";
    app.insert_user("alice", TestUserRole::Owner).await?;

    let (login, _) = login_with_session(&app, "alice", password).await?;

    let response = app.get("/api/auth/me", Some(&login.access_token)).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    let user: AuthenticatedUser = serde_json::from_slice(&body)?;

    assert_eq!(user.username, "alice");

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn login_rejects_unknown_user() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let payload = json!({ "username": "ghost", "password": "nope" });
    let response = app.post_json("/api/auth/login", &payload, None).await?;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = body_to_vec(response.into_body()).await?;
    let err: ApiErrorResponse = serde_json::from_slice(&body)?;
    assert_eq!(err.error, "password authentication is no longer supported");

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn signup_start_and_finish_require_valid_passkey() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let payload = json!({ "username": "signup-user" });

    let response = app
        .post_json("/api/auth/signup/start", &payload, None)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    let start: SignupStartResponse = serde_json::from_slice(&body)?;
    assert!(!start.signup_token.is_empty());
    assert_ne!(start.challenge.challenge_id, Uuid::nil());

    app.with_conn(|conn| {
        let exists: bool = diesel::select(diesel::dsl::exists(
            users::table.filter(users::username.eq("signup-user")),
        ))
        .get_result(conn)?;
        assert!(!exists);
        Ok(())
    })
    .await?;

    let finish_payload = json!({
        "signup_token": start.signup_token,
        "credential": fake_register_credential(),
    });
    let finish_response = app
        .post_json("/api/auth/signup/finish", &finish_payload, None)
        .await?;
    assert_eq!(finish_response.status(), StatusCode::BAD_REQUEST);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn passkey_register_start_creates_challenge() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "secret";
    app.insert_user("passkey-user", TestUserRole::Owner).await?;

    let (login, _) = login_with_session(&app, "passkey-user", password).await?;

    let response = app
        .post_json(
            "/api/auth/passkeys/register/start",
            &json!({}),
            Some(&login.access_token),
        )
        .await?;

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    let challenge: RegistrationChallengeResponse = serde_json::from_slice(&body)?;
    assert_ne!(challenge.challenge_id, Uuid::nil());
    let challenge_id = challenge.challenge_id;

    app.with_conn(move |conn| {
        use diesel::dsl::{exists, select};
        use papercrate::schema::webauthn_challenges::dsl;

        let exists: bool = select(exists(
            dsl::webauthn_challenges.filter(dsl::id.eq(challenge_id)),
        ))
        .get_result(conn)?;
        assert!(exists, "challenge not persisted");
        Ok(())
    })
    .await?;

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn passkey_register_finish_rejects_unknown_challenge() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "secret";
    app.insert_user("passkey-register", TestUserRole::Owner)
        .await?;
    let (login, _) = login_with_session(&app, "passkey-register", password).await?;

    let payload = PasskeyRegistrationFinishPayload {
        challenge_id: Uuid::new_v4(),
        credential: fake_register_credential(),
        nickname: None,
    };

    let response = app
        .post_json(
            "/api/auth/passkeys/register/finish",
            &payload,
            Some(&login.access_token),
        )
        .await?;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn passkey_login_start_requires_passkey() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let _password = "secret";
    app.insert_user("passkey-login", TestUserRole::Owner)
        .await?;

    let payload = PasskeyLoginStartPayload {
        username: "passkey-login".to_string(),
    };

    let response = app
        .post_json("/api/auth/passkeys/login/start", &payload, None)
        .await?;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn passkey_login_start_unknown_user_returns_not_found() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let payload = PasskeyLoginStartPayload {
        username: "nobody".to_string(),
    };

    let response = app
        .post_json("/api/auth/passkeys/login/start", &payload, None)
        .await?;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn passkey_login_finish_rejects_invalid_challenge() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let payload = PasskeyLoginFinishPayload {
        challenge_id: Uuid::new_v4(),
        credential: fake_authentication_credential(),
    };

    let response = app
        .post_json("/api/auth/passkeys/login/finish", &payload, None)
        .await?;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn list_passkeys_returns_entries() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "secret";
    let user_id = app
        .insert_user("passkey-owner", TestUserRole::Owner)
        .await?;
    app.insert_passkey(user_id, Some("Laptop")).await?;

    let (session, _) = login_with_session(&app, "passkey-owner", password).await?;

    let response = app
        .get("/api/profile/passkeys", Some(&session.access_token))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);

    let body = body_to_vec(response.into_body()).await?;
    let summaries: Vec<PasskeySummary> = serde_json::from_slice(&body)?;
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].nickname.as_deref(), Some("Laptop"));
    assert!(summaries[0].revoked_at.is_none());

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_passkey_soft_revokes() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "secret";
    let user_id = app
        .insert_user("passkey-delete", TestUserRole::Owner)
        .await?;
    let passkey_id = app.insert_passkey(user_id, Some("Phone")).await?;
    app.insert_passkey(user_id, Some("Backup")).await?;
    let (session, _) = login_with_session(&app, "passkey-delete", password).await?;

    let response = app
        .delete(
            &format!("/api/profile/passkeys/{}?reason=lost", passkey_id),
            Some(&session.access_token),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    app.with_conn(move |conn| {
        use papercrate::schema::user_passkeys::dsl as passkey_dsl;

        let record = passkey_dsl::user_passkeys
            .find(passkey_id)
            .first::<UserPasskey>(conn)?;
        assert!(record.revoked_at.is_some());
        assert_eq!(record.revoked_reason.as_deref(), Some("lost"));
        Ok(())
    })
    .await?;

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_passkey_prevents_last() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "secret";
    let user_id = app
        .insert_user("passkey-guard", TestUserRole::Owner)
        .await?;
    let first_id = app.insert_passkey(user_id, Some("Key A")).await?;
    let last_id = app.insert_passkey(user_id, Some("Key B")).await?;
    let (session, _) = login_with_session(&app, "passkey-guard", password).await?;

    let response = app
        .delete(
            &format!("/api/profile/passkeys/{}", first_id),
            Some(&session.access_token),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let block_response = app
        .delete(
            &format!("/api/profile/passkeys/{}", last_id),
            Some(&session.access_token),
        )
        .await?;
    assert_eq!(block_response.status(), StatusCode::BAD_REQUEST);

    app.cleanup().await?;
    Ok(())
}

fn fake_register_credential() -> RegisterPublicKeyCredential {
    RegisterPublicKeyCredential {
        id: "fake-passkey".to_string(),
        raw_id: vec![1, 2, 3, 4].into(),
        response: AuthenticatorAttestationResponseRaw {
            attestation_object: vec![5, 6, 7, 8].into(),
            client_data_json: vec![9, 10, 11, 12].into(),
            transports: None,
        },
        type_: "public-key".to_string(),
        extensions: Default::default(),
    }
}

fn fake_authentication_credential() -> PublicKeyCredential {
    PublicKeyCredential {
        id: "fake-auth".to_string(),
        raw_id: vec![1, 2, 3].into(),
        response: AuthenticatorAssertionResponseRaw {
            authenticator_data: vec![4, 5, 6].into(),
            client_data_json: vec![7, 8, 9].into(),
            signature: vec![10, 11, 12].into(),
            user_handle: None,
        },
        extensions: Default::default(),
        type_: "public-key".to_string(),
    }
}

#[tokio::test]
async fn login_rejects_invalid_password() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let _password = "valid";
    app.insert_user("robin", TestUserRole::Owner).await?;

    let payload = json!({ "username": "robin", "password": "wrong" });
    let response = app.post_json("/api/auth/login", &payload, None).await?;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = body_to_vec(response.into_body()).await?;
    let err: ApiErrorResponse = serde_json::from_slice(&body)?;
    assert_eq!(err.error, "password authentication is no longer supported");

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn refresh_rotates_refresh_token() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "rotate";
    app.insert_user("rita", TestUserRole::Owner).await?;

    let (login, refresh_cookie) = login_with_session(&app, "rita", password).await?;

    let response = app
        .post_json_with_cookie("/api/auth/refresh", &json!({}), None, Some(&refresh_cookie))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let new_cookie = extract_refresh_cookie(response.headers())?;
    let body = body_to_vec(response.into_body()).await?;
    let refreshed: LoginResponse = serde_json::from_slice(&body)?;
    assert_eq!(refreshed.tenant.name, login.tenant.name);

    let me_response = app
        .get("/api/auth/me", Some(&refreshed.access_token))
        .await?;
    assert_eq!(me_response.status(), StatusCode::OK);

    let retry = app
        .post_json_with_cookie("/api/auth/refresh", &json!({}), None, Some(&refresh_cookie))
        .await?;
    assert_eq!(retry.status(), StatusCode::UNAUTHORIZED);

    // new cookie should differ from old to avoid reuse
    assert_ne!(new_cookie, refresh_cookie);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn logout_revokes_refresh_token() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "logout";
    app.insert_user("logan", TestUserRole::Owner).await?;

    let (login, refresh_cookie) = login_with_session(&app, "logan", password).await?;

    let response = app
        .post_json_with_cookie(
            "/api/auth/logout",
            &json!({}),
            Some(&login.access_token),
            Some(&refresh_cookie),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cleared_cookie = extract_refresh_cookie(response.headers())?;
    assert!(cleared_cookie.ends_with("="));

    let after_logout = app
        .post_json_with_cookie("/api/auth/refresh", &json!({}), None, Some(&refresh_cookie))
        .await?;
    assert_eq!(after_logout.status(), StatusCode::UNAUTHORIZED);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn me_requires_authentication() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let unauthenticated = app.get("/api/auth/me", None).await?;
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let invalid = app.get("/api/auth/me", Some("invalid")).await?;
    assert_eq!(invalid.status(), StatusCode::UNAUTHORIZED);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn login_returns_tenant_selection_when_multiple_memberships() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "multipass";
    let user_id = app.insert_user("multipass", TestUserRole::Owner).await?;

    let secondary_name = "secondary".to_string();
    let name_for_insert = secondary_name.clone();
    let secondary_id = Uuid::new_v4();
    app.with_conn(move |conn| {
        diesel::insert_into(tenants::table)
            .values((
                tenants::id.eq(secondary_id),
                tenants::name.eq(&name_for_insert),
                tenants::status.eq(TenantStatus::Active),
            ))
            .execute(conn)?;

        let owner_capability_set_id =
            ensure_capability_set(conn, secondary_id, owner_capabilities())
                .map_err(|err| anyhow!("failed to ensure owner capability set: {:?}", err))?
                .id;

        let membership = NewUserMembership {
            id: Uuid::new_v4(),
            user_id,
            tenant_id: secondary_id,
            capability_set_id: Some(owner_capability_set_id),
        };

        diesel::insert_into(user_memberships::table)
            .values(&membership)
            .execute(conn)?;
        Ok(())
    })
    .await?;

    let (login, refresh_cookie) = login_with_session(&app, "multipass", password).await?;

    let tenants_response = app.get("/api/tenants", Some(&login.access_token)).await?;
    assert_eq!(tenants_response.status(), StatusCode::OK);
    let tenants_body = body_to_vec(tenants_response.into_body()).await?;
    let tenant_list: Vec<TenantSummary> = serde_json::from_slice(&tenants_body)?;
    assert!(tenant_list.len() >= 2);

    let secondary = tenant_list
        .iter()
        .find(|tenant| tenant.name == secondary_name)
        .map(|t| t.id)
        .context("secondary tenant missing from listing")?;

    let select_response = app
        .post_json_with_cookie(
            "/api/auth/select-tenant",
            &json!({ "tenant_id": secondary }),
            Some(&login.access_token),
            Some(&refresh_cookie),
        )
        .await?;
    assert_eq!(select_response.status(), StatusCode::OK);
    let select_body = body_to_vec(select_response.into_body()).await?;
    let rotated: LoginResponse = serde_json::from_slice(&select_body)?;
    assert_eq!(rotated.tenant.id, secondary);
    assert_eq!(rotated.tenant.name, secondary_name);

    app.cleanup().await?;
    Ok(())
}

async fn login_with_session(
    app: &TestApp,
    username: &str,
    _password: &str,
) -> Result<(LoginResponse, String)> {
    let username = username.to_string();
    let state = app.state.clone();
    app.with_conn(move |conn| {
        use papercrate::schema::user_memberships::dsl as memberships_dsl;
        use papercrate::schema::users::dsl as users_dsl;

        let user: papercrate::models::User = users_dsl::users
            .filter(users_dsl::username.eq(&username))
            .first(conn)?;

        let membership: papercrate::models::UserMembership = memberships_dsl::user_memberships
            .filter(memberships_dsl::user_id.eq(user.id))
            .first(conn)?;

        let tenant: papercrate::models::Tenant =
            tenants::table.find(membership.tenant_id).first(conn)?;

        let capability_set_id = membership
            .capability_set_id
            .ok_or_else(|| anyhow!("membership missing capability set"))?;

        let cap_version = capability_sets::table
            .find(capability_set_id)
            .select(capability_sets::cap_version)
            .first::<i32>(conn)?;

        let now = Utc::now();
        let session_id = Uuid::new_v4();
        let access_token = state
            .jwt
            .generate_token(AccessTokenContext {
                user_id: user.id,
                tenant_id: tenant.id,
                username: user.username.clone(),
                principal_kind: PrincipalKind::UserSession,
                principal_id: session_id,
                capability_set_id,
                cap_version,
            })
            .map_err(|err| anyhow!(err))?;

        let session_value = generate_session_token();
        let session_hash = hash_session_token(&session_value);
        let refresh_expires_at = now + ChronoDuration::days(state.config.refresh_token_expiry_days);

        let new_session = NewUserSession {
            id: session_id,
            user_id: user.id,
            token_hash: session_hash,
            issued_at: now.naive_utc(),
            expires_at: refresh_expires_at.naive_utc(),
            tenant_id: tenant.id,
        };

        diesel::insert_into(user_sessions::table)
            .values(&new_session)
            .execute(conn)?;

        let login = LoginResponse {
            access_token,
            tenant: LoginTenant {
                id: tenant.id,
                name: tenant.name.clone(),
            },
        };

        let cookie = format!("refresh_token={session_value}");
        Ok((login, cookie))
    })
    .await
}

fn extract_refresh_cookie(headers: &axum::http::HeaderMap) -> Result<String> {
    let header_value = headers
        .get(SET_COOKIE)
        .context("missing set-cookie header")?
        .to_str()
        .context("invalid set-cookie header")?;
    let cookie = header_value
        .split(';')
        .next()
        .context("set-cookie missing cookie value")?
        .to_string();
    Ok(cookie)
}

fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .expect("failed to read random bytes");
    hex::encode(bytes)
}

fn hash_session_token(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}
#[tokio::test]
async fn tenant_selection_excludes_inactive_tenants() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let user_id = app.insert_user("tenant-user", TestUserRole::Owner).await?;

    let tenant_id = app
        .with_conn(|conn| {
            let tenant: papercrate::models::Tenant = tenant_dsl::tenants
                .filter(tenant_dsl::name.eq("test_tenant"))
                .first(conn)?;
            Ok::<_, anyhow::Error>(tenant.id)
        })
        .await?;

    app.with_conn(move |conn| {
        diesel::update(tenant_dsl::tenants.find(tenant_id))
            .set(tenant_dsl::status.eq(TenantStatus::Suspended))
            .execute(conn)?;
        Ok(())
    })
    .await?;

    let magic_value = "tenant-status-token";
    let token_hash = {
        let mut hasher = Sha256::new();
        hasher.update(magic_value.as_bytes());
        hex::encode(hasher.finalize())
    };

    let user_id_for_token = user_id;
    app.with_conn(move |conn| {
        let token = MagicToken {
            id: Uuid::new_v4(),
            user_id: user_id_for_token,
            kind: MagicTokenKind::EmailLogin,
            token_hash,
            metadata: json!({}),
            expires_at: (Utc::now() + ChronoDuration::hours(1)).naive_utc(),
            max_uses: None,
            used_count: 0,
            created_at: Utc::now().naive_utc(),
            created_by: None,
            last_used_at: None,
        };

        diesel::insert_into(magic_dsl::magic_tokens)
            .values(&token)
            .execute(conn)?;
        Ok(())
    })
    .await?;

    let payload = json!({
        "username": "tenant-user",
        "magic_token": magic_value,
    });

    let response = app.post_json("/api/auth/login", &payload, None).await?;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = body_to_vec(response.into_body()).await?;
    let err: ApiErrorResponse = serde_json::from_slice(&body)?;
    assert_eq!(err.error, "no active tenants available");

    app.cleanup().await?;
    Ok(())
}
