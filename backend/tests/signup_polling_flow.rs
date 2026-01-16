use anyhow::Result;
use axum::http::StatusCode;
use chrono::{Duration as ChronoDuration, Utc};
use diesel::prelude::*;
use papercrate::models::{MagicToken, MagicTokenKind, TenantStatus};
use papercrate::schema::tenants;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Deserialize, Debug)]
struct LoginTenant {
    id: Uuid,
    name: String,
}

#[derive(Deserialize, Debug)]
struct LoginResponse {
    access_token: String,
    tenant: LoginTenant,
}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
enum TestLoginResponse {
    Token(LoginResponse),
    Selection(TestSelectionResponse),
}

#[derive(Deserialize, Debug)]
struct TestSelectionResponse {
    access_token: String,
    tenants: Vec<TestTenantSnippet>,
}

#[derive(Deserialize, Debug)]
struct TestTenantSnippet {
    id: Uuid,
    name: String,
}



#[tokio::test]
async fn signup_polling_flow_works() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    // 1. Setup User and Tenant (Creating status) via helper
    // We insert as 'Owner' to get default tenant.
    let user_id = app.insert_user("polling-user", TestUserRole::Owner).await?;
    let tenant_id = app.tenant_id().await?;

    // Set Tenant to Creating
    app.with_conn(move |conn| {
        diesel::update(tenants::table.find(tenant_id))
            .set(tenants::status.eq(TenantStatus::Creating))
            .execute(conn)?;
        Ok(())
    })
    .await?;

    // 2. Create Magic Token for Login (Bypass WebAuthn)
    let magic_value = "polling-login-token";
    let token_hash = {
        let mut hasher = Sha256::new();
        hasher.update(magic_value.as_bytes());
        hex::encode(hasher.finalize())
    };

    app.with_conn(move |conn| {
        use papercrate::schema::magic_tokens::dsl as magic_dsl;
        let token = MagicToken {
            id: Uuid::new_v4(),
            user_id,
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

    // 3. Perform Login -> Expect Selection Response (since tenant is Creating, not Active)
    let payload = json!({
        "username": "polling-user",
        "magic_token": magic_value,
    });

    let login_response = app.post_json("/api/auth/login", &payload, None).await?;
    assert_eq!(login_response.status(), StatusCode::OK);
    let body = body_to_vec(login_response.into_body()).await?;
    let variant: TestLoginResponse = serde_json::from_slice(&body)?;

    let (selection_token, _) = match variant {
        TestLoginResponse::Selection(sel) => {
            assert_eq!(sel.tenants.len(), 1);
            let t = &sel.tenants[0];
            assert_eq!(t.id, tenant_id);
            // Verify status logic indirectly: backend returns it in selection because it's the only one but not active
            (sel.access_token, t.id)
        },
        TestLoginResponse::Token(_) => panic!("Expected Selection response because tenant is Creating (not Active)"),
    };

    // 4. Attempt Select -> Should Fail (Tenant not active)
    let select_payload = json!({ "tenant_id": tenant_id });
    let fail_response = app
        .post_json("/api/auth/select-tenant", &select_payload, Some(&selection_token))
        .await?;
    // Expect 400 Bad Request ("tenant not active") or 403
    assert!(!fail_response.status().is_success(), "Select should fail for Creating tenant");

    // 5. Activate Tenant (Simulate Worker)
    app.with_conn(move |conn| {
        diesel::update(tenants::table.find(tenant_id))
            .set(tenants::status.eq(TenantStatus::Active))
            .execute(conn)?;
        Ok(())
    })
    .await?;

    // 6. Retry Select -> Should Success
    let success_response = app
        .post_json("/api/auth/select-tenant", &select_payload, Some(&selection_token))
        .await?;
    assert_eq!(success_response.status(), StatusCode::OK);
    let body = body_to_vec(success_response.into_body()).await?;
    let login: TestLoginResponse = serde_json::from_slice(&body)?;
    match login {
        TestLoginResponse::Token(t) => {
            assert_eq!(t.tenant.id, tenant_id);
        }
        _ => panic!("Expected Token response after successful selection"),
    }

    app.cleanup().await?;
    Ok(())
}
