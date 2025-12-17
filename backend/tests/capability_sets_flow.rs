use anyhow::Result;
use axum::http::StatusCode;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Deserialize)]
struct CapabilitySetResponse {
    id: Uuid,
    slug: String,
    cap_version: i32,
    #[allow(dead_code)]
    is_system: bool,
    capabilities: Vec<String>,
}

#[tokio::test]
async fn capability_set_crud_flow() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "caps-admin";
    app.insert_user("caps", TestUserRole::Owner).await?;
    let token = app.login_token("caps", password).await?;

    // Initial list should contain system sets.
    let initial = app.get("/api/capability-sets", Some(&token)).await?;
    assert_eq!(initial.status(), StatusCode::OK);
    let initial_body = body_to_vec(initial.into_body()).await?;
    let sets: Vec<CapabilitySetResponse> = serde_json::from_slice(&initial_body)?;
    let owner_id = sets
        .iter()
        .find(|set| set.slug == "owner")
        .map(|set| set.id)
        .expect("owner set present");
    assert!(sets.iter().any(|set| set.slug == "user"));
    assert!(sets.iter().any(|set| set.slug == "readonly"));
    assert!(sets.iter().any(|set| set.slug == "webdav"));

    let capabilities_resp = app.get("/api/capabilities", Some(&token)).await?;
    assert_eq!(capabilities_resp.status(), StatusCode::OK);
    let capabilities_body = body_to_vec(capabilities_resp.into_body()).await?;
    let capabilities: Vec<String> = serde_json::from_slice(&capabilities_body)?;
    assert!(capabilities.contains(&"documents:read".to_string()));
    assert!(capabilities.contains(&"capability_sets:write".to_string()));
    assert_eq!(
        capabilities.len(),
        papercrate::models::ApiCapability::variants().len()
    );

    // Create a new capability set.
    let create = app
        .post_json(
            "/api/capability-sets",
            &json!({
                "slug": "api_readonly",
                "capabilities": ["documents:read", "capability_sets:read"]
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(create.status(), StatusCode::CREATED);
    let create_body = body_to_vec(create.into_body()).await?;
    let created: CapabilitySetResponse = serde_json::from_slice(&create_body)?;
    assert_eq!(created.slug, "api_readonly");
    assert!(created.capabilities.contains(&"documents:read".to_string()));
    assert!(created
        .capabilities
        .contains(&"capability_sets:read".to_string()));

    // Update capabilities.
    let update = app
        .patch_json(
            &format!("/api/capability-sets/{}", created.id),
            &json!({
                "capabilities": ["documents:read", "documents:edit"],
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(update.status(), StatusCode::OK);
    let update_body = body_to_vec(update.into_body()).await?;
    let updated: CapabilitySetResponse = serde_json::from_slice(&update_body)?;
    assert_eq!(updated.cap_version, created.cap_version + 1);
    assert!(updated.capabilities.contains(&"documents:edit".to_string()));
    assert!(!updated
        .capabilities
        .contains(&"capability_sets:read".to_string()));

    // Attempt to delete system set should conflict.
    let delete_owner = app
        .delete(&format!("/api/capability-sets/{}", owner_id), Some(&token))
        .await?;
    assert_eq!(delete_owner.status(), StatusCode::CONFLICT);

    // Delete custom set succeeds.
    let delete = app
        .delete(
            &format!("/api/capability-sets/{}", created.id),
            Some(&token),
        )
        .await?;
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);

    let final_list = app.get("/api/capability-sets", Some(&token)).await?;
    assert_eq!(final_list.status(), StatusCode::OK);
    let final_body = body_to_vec(final_list.into_body()).await?;
    let final_sets: Vec<CapabilitySetResponse> = serde_json::from_slice(&final_body)?;
    assert!(!final_sets.iter().any(|set| set.slug == "api_readonly"));

    app.cleanup().await?;
    Ok(())
}
