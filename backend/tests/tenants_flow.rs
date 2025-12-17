use anyhow::Result;
use axum::http::StatusCode;
use chrono::Utc;
use diesel::prelude::*;
use papercrate::models::TenantStatus;
use papercrate::schema::tenants::dsl as tenants_dsl;
use papercrate::test_support::{acquire_db_lock, TestApp, TestUserRole};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn tenant_management_is_scoped_to_memberships() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let username = "tenant-owner";
    app.insert_user(username, TestUserRole::Owner).await?;
    let token = app.login_token(username, "irrelevant").await?;

    let other_tenant_id = app
        .with_conn(|conn| {
            let other_id = Uuid::new_v4();
            let now = Utc::now().naive_utc();
            diesel::insert_into(tenants_dsl::tenants)
                .values((
                    tenants_dsl::id.eq(other_id),
                    tenants_dsl::name.eq(format!("foreign-{other_id}")),
                    tenants_dsl::storage_root.eq(Some(format!("test-tenants/{other_id}/"))),
                    tenants_dsl::quickwit_index.eq(None::<String>),
                    tenants_dsl::config.eq(json!({})),
                    tenants_dsl::created_at.eq(now),
                    tenants_dsl::updated_at.eq(now),
                    tenants_dsl::status.eq(TenantStatus::Active),
                    tenants_dsl::created_by.eq(None::<Uuid>),
                ))
                .execute(conn)?;
            Ok(other_id)
        })
        .await?;

    let response = app
        .patch_json(
            &format!("/api/tenants/{other_tenant_id}"),
            &json!({ "name": "should-not-work" }),
            Some(&token),
        )
        .await?;

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    Ok(())
}
