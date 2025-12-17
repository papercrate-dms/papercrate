use anyhow::{Context, Result};
use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use diesel::prelude::*;
use diesel::OptionalExtension;
use papercrate::auth::capability_sets;
use papercrate::models::{ApiCapability, ApiToken};
use papercrate::routes::webdav;
use papercrate::schema::api_tokens;
use papercrate::schema::capability_sets::dsl as capability_sets_dsl;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde::Deserialize;
use serde_json::json;
use tower::ServiceExt;
use uuid::Uuid;

const LEGACY_WEBDAV_CAPS: &[&str] = &[
    "documents:edit",
    "documents:read",
    "documents:upload",
    "documents:write",
    "folders:edit",
    "folders:read",
    "folders:write",
    "webdav:read",
];

const READ_ONLY_CAPS: &[&str] = &["documents:read"];
const LIMITED_WEBDAV_CAPS: &[&str] = &["documents:read", "webdav:read"];

#[derive(Debug, Deserialize)]
struct TokenInfo {
    id: Uuid,
    label: Option<String>,
    last_used_at: Option<String>,
    revoked_at: Option<String>,
    capability_set_id: Uuid,
}

#[derive(Debug, Deserialize)]
struct CreateTokenResponse {
    token: String,
    #[serde(rename = "token_info")]
    info: TokenInfo,
}

#[derive(Debug, Deserialize)]
struct LoginResponseView {
    access_token: String,
    token_type: String,
    expires_in: i64,
    tenant: TenantView,
}

#[derive(Debug, Deserialize)]
struct TenantView {
    id: Uuid,
    name: String,
}

#[tokio::test]
async fn api_token_crud_flow() -> Result<()> {
    let _guard = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let username = "alice";
    let password = "correct horse battery";
    app.insert_user(username, TestUserRole::Owner).await?;
    let access_token = app.login_token(username, password).await?;

    let legacy_set_id =
        ensure_capability_set_slug(&app, &access_token, "legacy_webdav", LEGACY_WEBDAV_CAPS)
            .await?;

    let created = create_token(&app, &access_token, Some("dav"), legacy_set_id, None).await?;
    let token_id = created.info.id;
    assert_eq!(created.info.label.as_deref(), Some("dav"));
    assert!(created.info.last_used_at.is_none());
    assert_eq!(created.info.capability_set_id, legacy_set_id);

    let regenerated = regenerate_token(&app, &access_token, token_id).await?;
    assert_eq!(regenerated.info.id, token_id);
    assert_ne!(regenerated.token, created.token);
    assert!(regenerated.info.last_used_at.is_none());

    let listed = list_tokens(&app, &access_token).await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, token_id);
    assert_eq!(listed[0].capability_set_id, legacy_set_id);

    let tenant_id_for_token = app
        .with_conn(move |conn| {
            let tenant_id = api_tokens::table
                .find(token_id)
                .select(api_tokens::tenant_id)
                .first::<Uuid>(conn)?;
            Ok::<_, anyhow::Error>(tenant_id)
        })
        .await?;

    let readonly_set_id =
        ensure_capability_set_slug(&app, &access_token, "readonly", READ_ONLY_CAPS).await?;

    let readonly_token =
        create_token(&app, &access_token, Some("readonly"), readonly_set_id, None).await?;
    let readonly_exchange = exchange_token(&app, &readonly_token.token).await?;
    assert_eq!(readonly_exchange.tenant.id, tenant_id_for_token);
    delete_token(&app, &access_token, readonly_token.info.id).await?;

    let exchange = exchange_token(&app, &regenerated.token).await?;
    assert_eq!(exchange.token_type, "Bearer");
    assert!(!exchange.access_token.is_empty());
    assert!(exchange.expires_in > 0);
    assert_eq!(exchange.tenant.id, tenant_id_for_token);
    assert!(!exchange.tenant.name.is_empty());

    delete_token(&app, &access_token, token_id).await?;

    let listed_after = list_tokens(&app, &access_token).await?;
    let revoked_entry = listed_after
        .iter()
        .find(|entry| entry.id == token_id)
        .expect("revoked token still listed");
    assert!(revoked_entry.revoked_at.is_some());

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn webdav_basic_auth_uses_api_tokens() -> Result<()> {
    let _guard = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let username = "bruce";
    let password = "wayne";
    app.insert_user(username, TestUserRole::Owner).await?;
    let access_token = app.login_token(username, password).await?;

    let legacy_set_id =
        ensure_capability_set_slug(&app, &access_token, "legacy_webdav", LEGACY_WEBDAV_CAPS)
            .await?;

    let created = create_token(&app, &access_token, Some("webdav"), legacy_set_id, None).await?;
    let token_id = created.info.id;

    let router = webdav::create_router().with_state(app.state.clone());
    let original_secret = created.token.clone();
    let auth_header = format!(
        "Basic {}",
        BASE64.encode(format!("{}:{}", username, original_secret))
    );

    let propfind = Method::from_bytes(b"PROPFIND")?;
    let success_request = Request::builder()
        .method(propfind.clone())
        .uri("/")
        .header(header::AUTHORIZATION, auth_header.clone())
        .header("depth", "0")
        .body(Body::empty())?;
    let response = router.clone().oneshot(success_request).await?;
    assert_eq!(response.status(), StatusCode::MULTI_STATUS);

    let used = app
        .with_conn(move |conn| {
            let record = api_tokens::table.find(token_id).first::<ApiToken>(conn)?;
            Ok::<_, anyhow::Error>(record.last_used_at)
        })
        .await?;
    assert!(used.is_some());

    let regenerated = regenerate_token(&app, &access_token, token_id).await?;
    assert_ne!(regenerated.token, original_secret);

    let unused_after_regen = app
        .with_conn(move |conn| {
            let record = api_tokens::table.find(token_id).first::<ApiToken>(conn)?;
            Ok::<_, anyhow::Error>(record.last_used_at)
        })
        .await?;
    assert!(unused_after_regen.is_none());

    let old_secret_request = Request::builder()
        .method(propfind.clone())
        .uri("/")
        .header(
            header::AUTHORIZATION,
            format!(
                "Basic {}",
                BASE64.encode(format!("{}:{}", username, original_secret))
            ),
        )
        .header("depth", "0")
        .body(Body::empty())?;
    let old_secret_response = router.clone().oneshot(old_secret_request).await?;
    assert_eq!(old_secret_response.status(), StatusCode::UNAUTHORIZED);

    let new_secret_header = format!(
        "Basic {}",
        BASE64.encode(format!("{}:{}", username, regenerated.token))
    );

    let success_request = Request::builder()
        .method(propfind.clone())
        .uri("/")
        .header(header::AUTHORIZATION, new_secret_header.clone())
        .header("depth", "0")
        .body(Body::empty())?;
    let response = router.clone().oneshot(success_request).await?;
    assert_eq!(response.status(), StatusCode::MULTI_STATUS);

    // Token without webdav_read cannot authenticate.
    let read_only_set_id =
        ensure_capability_set_slug(&app, &access_token, "documents_read", READ_ONLY_CAPS).await?;

    let limited_token =
        create_token(&app, &access_token, Some("limited"), read_only_set_id, None).await?;
    assert_eq!(limited_token.info.capability_set_id, read_only_set_id);

    let limited_header = format!(
        "Basic {}",
        BASE64.encode(format!("{}:{}", username, limited_token.token))
    );

    let limited_request = Request::builder()
        .method(propfind.clone())
        .uri("/")
        .header(header::AUTHORIZATION, limited_header.clone())
        .header("depth", "0")
        .body(Body::empty())?;
    let limited_response = router.clone().oneshot(limited_request).await?;
    assert_eq!(limited_response.status(), StatusCode::UNAUTHORIZED);

    let limited_set_id = ensure_capability_set_slug(
        &app,
        &access_token,
        "documents_read_webdav",
        LIMITED_WEBDAV_CAPS,
    )
    .await?;

    let upgraded_token = create_token(
        &app,
        &access_token,
        Some("limited-webdav"),
        limited_set_id,
        None,
    )
    .await?;
    assert_eq!(upgraded_token.info.capability_set_id, limited_set_id);

    let upgraded_request = Request::builder()
        .method(propfind.clone())
        .uri("/")
        .header(
            header::AUTHORIZATION,
            format!(
                "Basic {}",
                BASE64.encode(format!("{}:{}", username, upgraded_token.token))
            ),
        )
        .header("depth", "0")
        .body(Body::empty())?;
    let upgraded_response = router.clone().oneshot(upgraded_request).await?;
    assert_eq!(upgraded_response.status(), StatusCode::MULTI_STATUS);

    delete_token(&app, &access_token, token_id).await?;

    let failure_request = Request::builder()
        .method(propfind)
        .uri("/")
        .header(header::AUTHORIZATION, new_secret_header)
        .header("depth", "0")
        .body(Body::empty())?;
    let failure_response = router.oneshot(failure_request).await?;
    assert_eq!(failure_response.status(), StatusCode::UNAUTHORIZED);

    app.cleanup().await?;
    Ok(())
}

async fn create_token(
    app: &TestApp,
    access_token: &str,
    label: Option<&str>,
    capability_set_id: Uuid,
    expires_at: Option<&str>,
) -> Result<CreateTokenResponse> {
    let mut payload = json!({
        "capability_set_id": capability_set_id,
    });

    if let Some(label) = label {
        payload["label"] = json!(label);
    }

    if let Some(expires) = expires_at {
        payload["expires_at"] = json!(expires);
    }

    let response = app
        .post_json("/api/profile/api-tokens", &payload, Some(access_token))
        .await?;
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = body_to_vec(response.into_body()).await?;
    Ok(serde_json::from_slice(&body)?)
}

async fn regenerate_token(
    app: &TestApp,
    access_token: &str,
    token_id: Uuid,
) -> Result<CreateTokenResponse> {
    let response = app
        .post_json(
            &format!("/api/profile/api-tokens/{token_id}/regenerate"),
            &json!({}),
            Some(access_token),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    Ok(serde_json::from_slice(&body)?)
}

async fn list_tokens(app: &TestApp, access_token: &str) -> Result<Vec<TokenInfo>> {
    let response = app
        .get("/api/profile/api-tokens", Some(access_token))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    Ok(serde_json::from_slice(&body)?)
}

async fn delete_token(app: &TestApp, access_token: &str, token_id: Uuid) -> Result<()> {
    let response = app
        .delete(
            &format!("/api/profile/api-tokens/{token_id}"),
            Some(access_token),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    Ok(())
}

async fn ensure_capability_set_slug(
    app: &TestApp,
    access_token: &str,
    slug: &str,
    capabilities: &[&str],
) -> Result<Uuid> {
    let claims = app
        .state
        .jwt
        .verify_token(access_token)
        .context("failed to decode access token claims")?;
    let tenant_id = claims.tenant_id;
    let slug = slug.to_string();
    let desired_capabilities = capabilities
        .iter()
        .map(|value| {
            value
                .parse::<ApiCapability>()
                .map_err(|err| anyhow::anyhow!("invalid capability '{value}': {err}"))
        })
        .collect::<Result<Vec<_>>>()?;

    let caps_for_insert = desired_capabilities.clone();
    app.with_conn(move |conn| {
        if let Some(existing) = capability_sets_dsl::capability_sets
            .filter(capability_sets_dsl::tenant_id.eq(tenant_id))
            .filter(capability_sets_dsl::slug.eq(&slug))
            .select(capability_sets_dsl::id)
            .first::<Uuid>(conn)
            .optional()?
        {
            return Ok(existing);
        }

        let created =
            capability_sets::create_capability_set(conn, tenant_id, &slug, caps_for_insert)
                .map_err(|err| {
                    anyhow::anyhow!("failed to create capability set '{slug}': {err:?}")
                })?;
        Ok(created.id)
    })
    .await
}
async fn exchange_token(app: &TestApp, api_token: &str) -> Result<LoginResponseView> {
    let response = app
        .post_json(
            "/api/auth/exchange-api-token",
            &json!({ "api_token": api_token }),
            None,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    Ok(serde_json::from_slice(&body)?)
}
