use anyhow::{anyhow, Result};
use axum::http::StatusCode;
use diesel::prelude::*;
use papercrate::auth::capability_sets::{ensure_capability_set, owner_capabilities};
use papercrate::models::{NewUser, NewUserMembership, Tag, TenantStatus};
use papercrate::schema::{
    tags::dsl as tags_dsl, tenants::dsl as tenants_dsl, user_memberships::dsl as memberships_dsl,
    users::dsl as users_dsl,
};
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde::Deserialize;
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize)]
struct CreateTagPayload<'a> {
    label: &'a str,
    color: Option<&'a str>,
}

#[derive(Deserialize)]
struct DocumentDetail {
    document: DocumentInfo,
}

#[derive(Deserialize)]
struct DocumentInfo {
    id: Uuid,
    tags: Vec<TagInfo>,
}

#[derive(Deserialize)]
struct TagInfo {
    label: String,
    #[allow(dead_code)]
    color: Option<String>,
}

#[derive(Deserialize)]
struct TagResponse {
    id: Uuid,
    label: String,
    color: Option<String>,
    usage_count: i64,
}

#[derive(Serialize)]
struct AssignTagsRequest {
    tag_ids: Vec<Uuid>,
}

#[tokio::test]
async fn tag_assignment_flow() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "tagpass";
    app.insert_user("tagger", TestUserRole::Owner).await?;
    let token = app.login_token("tagger", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "tagged.txt",
            "text/plain",
            b"tag me",
            None,
            &token,
        )
        .await?;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let upload_body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&upload_body)?;

    let create_tag = app
        .post_json(
            "/api/tags",
            &CreateTagPayload {
                label: "Important",
                color: Some("#FF0000"),
            },
            Some(&token),
        )
        .await?;
    assert_eq!(create_tag.status(), StatusCode::OK);
    let body = body_to_vec(create_tag.into_body()).await?;
    let tag: TagResponse = serde_json::from_slice(&body)?;
    assert_eq!(tag.label, "Important");
    assert_eq!(tag.color.as_deref(), Some("#FF0000"));
    assert_eq!(tag.usage_count, 0);

    let update = app
        .patch_json(
            &format!("/api/tags/{}", tag.id),
            &serde_json::json!({
                "label": "Critical",
                "color": "#00FF00"
            }),
            Some(&token),
        )
        .await?;
    let updated_status = update.status();
    let updated_body = body_to_vec(update.into_body()).await?;
    if updated_status != StatusCode::OK {
        panic!(
            "update tag failed: {}",
            String::from_utf8_lossy(&updated_body)
        );
    }
    let updated: TagResponse = serde_json::from_slice(&updated_body)?;
    assert_eq!(updated.label, "Critical");
    assert_eq!(updated.color.as_deref(), Some("#00FF00"));
    assert_eq!(updated.usage_count, 0);

    let clear_color = app
        .patch_json(
            &format!("/api/tags/{}", tag.id),
            &serde_json::json!({
                "color": null
            }),
            Some(&token),
        )
        .await?;
    let cleared_status = clear_color.status();
    let cleared_body = body_to_vec(clear_color.into_body()).await?;
    if cleared_status != StatusCode::OK {
        panic!(
            "clear color failed: {}",
            String::from_utf8_lossy(&cleared_body)
        );
    }
    let cleared: TagResponse = serde_json::from_slice(&cleared_body)?;
    assert_eq!(cleared.color, None);
    assert_eq!(cleared.usage_count, 0);

    let assign = app
        .post_json(
            &format!("/api/documents/{}/tags", detail.document.id),
            &AssignTagsRequest {
                tag_ids: vec![tag.id],
            },
            Some(&token),
        )
        .await?;
    assert_eq!(assign.status(), StatusCode::NO_CONTENT);

    let refreshed = app
        .get(
            &format!("/api/documents/{}", detail.document.id),
            Some(&token),
        )
        .await?;
    assert_eq!(refreshed.status(), StatusCode::OK);
    let refreshed_body = body_to_vec(refreshed.into_body()).await?;
    let refreshed_detail: DocumentDetail = serde_json::from_slice(&refreshed_body)?;
    assert_eq!(refreshed_detail.document.tags.len(), 1);
    assert_eq!(refreshed_detail.document.tags[0].label, "Critical");

    let remove = app
        .delete(
            &format!("/api/documents/{}/tags/{}", detail.document.id, tag.id),
            Some(&token),
        )
        .await?;
    assert_eq!(remove.status(), StatusCode::NO_CONTENT);

    let final_check = app
        .get(
            &format!("/api/documents/{}", detail.document.id),
            Some(&token),
        )
        .await?;
    let final_body = body_to_vec(final_check.into_body()).await?;
    let final_detail: DocumentDetail = serde_json::from_slice(&final_body)?;
    assert!(final_detail.document.tags.is_empty());

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn tags_are_isolated_between_tenants() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password_a = "tenant-a";
    app.insert_user("alice", TestUserRole::Owner).await?;
    let token_a = app.login_token("alice", password_a).await?;

    let shared_label = "Shared Label";

    let create_a = app
        .post_json(
            "/api/tags",
            &CreateTagPayload {
                label: shared_label,
                color: Some("#123456"),
            },
            Some(&token_a),
        )
        .await?;
    assert_eq!(create_a.status(), StatusCode::OK);

    let tenant_b_id = Uuid::new_v4();
    let user_b_id = Uuid::new_v4();
    app.with_conn(move |conn| {
        let storage_root = format!("test-tenants/{tenant_b_id}/");
        diesel::insert_into(tenants_dsl::tenants)
            .values((
                tenants_dsl::id.eq(tenant_b_id),
                tenants_dsl::name.eq("tenant-b"),
                tenants_dsl::storage_root.eq(Some(storage_root)),
                tenants_dsl::status.eq(TenantStatus::Active),
            ))
            .execute(conn)?;

        let new_user = NewUser {
            id: user_b_id,
            username: "bob".to_string(),
        };
        diesel::insert_into(users_dsl::users)
            .values(&new_user)
            .execute(conn)?;

        let owner_capability_set_id =
            ensure_capability_set(conn, tenant_b_id, owner_capabilities())
                .map_err(|err| anyhow!("failed to ensure owner capability set: {:?}", err))?
                .id;

        let membership = NewUserMembership {
            id: Uuid::new_v4(),
            user_id: user_b_id,
            tenant_id: tenant_b_id,
            capability_set_id: Some(owner_capability_set_id),
        };
        diesel::insert_into(memberships_dsl::user_memberships)
            .values(&membership)
            .execute(conn)?;

        Ok::<_, anyhow::Error>(())
    })
    .await?;

    let token_b = app.login_token("bob", "").await?;

    let create_b = app
        .post_json(
            "/api/tags",
            &CreateTagPayload {
                label: shared_label,
                color: Some("#654321"),
            },
            Some(&token_b),
        )
        .await?;
    assert_eq!(create_b.status(), StatusCode::OK);

    app.with_conn(move |conn| {
        let tags: Vec<Tag> = tags_dsl::tags
            .filter(tags_dsl::label.eq(shared_label))
            .order(tags_dsl::tenant_id.asc())
            .load(conn)?;

        assert_eq!(tags.len(), 2);
        assert_ne!(tags[0].tenant_id, tags[1].tenant_id);
        Ok::<_, anyhow::Error>(())
    })
    .await?;

    Ok(())
}
