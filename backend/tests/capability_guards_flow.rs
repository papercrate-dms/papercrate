use anyhow::{anyhow, Result};
use axum::http::StatusCode;
use diesel::prelude::*;
use papercrate::models::ApiCapability;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde_json::json;

async fn set_user_capabilities(
    app: &TestApp,
    user_id: uuid::Uuid,
    caps: &[ApiCapability],
) -> Result<()> {
    let capabilities = caps.to_vec();
    app.with_conn(move |conn| {
        use papercrate::schema::user_memberships::dsl as memberships_dsl;

        let membership = memberships_dsl::user_memberships
            .filter(memberships_dsl::user_id.eq(user_id))
            .first::<papercrate::models::UserMembership>(conn)?;

        let capability_set = papercrate::auth::capability_sets::ensure_capability_set(
            conn,
            membership.tenant_id,
            &capabilities,
        )
        .map_err(|err| anyhow!("failed to ensure capability set: {:?}", err))?;

        diesel::update(memberships_dsl::user_memberships.find(membership.id))
            .set(memberships_dsl::capability_set_id.eq(Some(capability_set.id)))
            .execute(conn)?;

        Ok(())
    })
    .await
}

#[tokio::test]
async fn documents_routes_enforce_capabilities() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "limited-docs";
    let user_id = app.insert_user("limited-docs", TestUserRole::Owner).await?;
    set_user_capabilities(&app, user_id, &[ApiCapability::DocumentsRead]).await?;

    let token = app.login_token("limited-docs", password).await?;

    let list = app.get("/api/documents", Some(&token)).await?;
    assert_eq!(list.status(), StatusCode::OK);

    let upload = app
        .upload_document(
            "/api/documents",
            "limited.txt",
            "text/plain",
            b"limited",
            None,
            &token,
        )
        .await?;
    assert_eq!(upload.status(), StatusCode::FORBIDDEN);
    let upload_body = body_to_vec(upload.into_body()).await?;
    assert!(String::from_utf8_lossy(&upload_body).contains("missing"));

    let capability_sets = app.get("/api/capability-sets", Some(&token)).await?;
    assert_eq!(capability_sets.status(), StatusCode::FORBIDDEN);
    let caps_body = body_to_vec(capability_sets.into_body()).await?;
    assert!(String::from_utf8_lossy(&caps_body).contains("missing"));

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn capability_set_routes_require_write_privilege() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "caps-reader";
    let user_id = app.insert_user("caps-reader", TestUserRole::Member).await?;
    set_user_capabilities(&app, user_id, &[ApiCapability::CapabilitySetsRead]).await?;

    let token = app.login_token("caps-reader", password).await?;

    let list = app.get("/api/capability-sets", Some(&token)).await?;
    assert_eq!(list.status(), StatusCode::OK);

    let create = app
        .post_json(
            "/api/capability-sets",
            &json!({
                "slug": "should-fail",
                "capabilities": ["documents:read"]
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(create.status(), StatusCode::FORBIDDEN);
    let create_body = body_to_vec(create.into_body()).await?;
    assert!(String::from_utf8_lossy(&create_body).contains("missing"));

    app.cleanup().await?;
    Ok(())
}
