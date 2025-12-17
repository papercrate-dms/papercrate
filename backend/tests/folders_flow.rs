use anyhow::Result;
use axum::http::StatusCode;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Deserialize)]
struct FolderResponse {
    folder: FolderInfo,
}

#[derive(Deserialize)]
struct FolderInfo {
    id: Uuid,
    name: String,
    parent_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct FolderContents {
    folder: Option<FolderInfo>,
    subfolders: Vec<FolderInfo>,
    documents: Vec<DocSummary>,
}

#[derive(Deserialize)]
struct DocSummary {
    id: Uuid,
}

#[derive(Deserialize)]
struct FolderTreeNodeResponse {
    name: String,
    children: Vec<FolderTreeNodeResponse>,
}

#[derive(Serialize)]
struct CreateFolder<'a> {
    name: &'a str,
    parent_id: Option<Uuid>,
}

#[derive(Serialize)]
struct EnsureFolderPath<'a> {
    parent_id: Option<Uuid>,
    segments: &'a [&'a str],
}

#[derive(Serialize)]
struct MoveDocumentRequest {
    folder_id: Option<Uuid>,
}

#[derive(Deserialize)]
struct DocumentDetail {
    document: DocSummary,
}

#[tokio::test]
async fn folder_move_and_delete_flow() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "folderpass";
    app.insert_user("folder-admin", TestUserRole::Owner).await?;
    let token = app.login_token("folder-admin", password).await?;

    let folder_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Projects",
                parent_id: None,
            },
            Some(&token),
        )
        .await?;
    assert_eq!(folder_resp.status(), StatusCode::CREATED);
    let folder_body = body_to_vec(folder_resp.into_body()).await?;
    let folder: FolderResponse = serde_json::from_slice(&folder_body)?;

    let upload = app
        .upload_document(
            "/api/documents",
            "plan.pdf",
            "application/pdf",
            b"dummy",
            None,
            &token,
        )
        .await?;
    let upload_body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&upload_body)?;

    let move_resp = app
        .patch_json(
            &format!("/api/documents/{}/folder", detail.document.id),
            &MoveDocumentRequest {
                folder_id: Some(folder.folder.id),
            },
            Some(&token),
        )
        .await?;
    assert_eq!(move_resp.status(), StatusCode::NO_CONTENT);

    let contents = app
        .get(
            &format!("/api/folders/{}/contents", folder.folder.id),
            Some(&token),
        )
        .await?;
    assert_eq!(contents.status(), StatusCode::OK);
    let contents_body = body_to_vec(contents.into_body()).await?;
    let contents: FolderContents = serde_json::from_slice(&contents_body)?;
    assert_eq!(contents.documents.len(), 1);
    assert_eq!(contents.documents[0].id, detail.document.id);

    let root_contents = app.get("/api/folders/root/contents", Some(&token)).await?;
    let root_body = body_to_vec(root_contents.into_body()).await?;
    let root: FolderContents = serde_json::from_slice(&root_body)?;
    assert!(root
        .documents
        .iter()
        .all(|doc| doc.id != detail.document.id));

    let delete_attempt = app
        .delete(&format!("/api/folders/{}", folder.folder.id), Some(&token))
        .await?;
    assert_eq!(delete_attempt.status(), StatusCode::BAD_REQUEST);

    let move_back = app
        .patch_json(
            &format!("/api/documents/{}/folder", detail.document.id),
            &MoveDocumentRequest { folder_id: None },
            Some(&token),
        )
        .await?;
    assert_eq!(move_back.status(), StatusCode::NO_CONTENT);

    let delete = app
        .delete(&format!("/api/folders/{}", folder.folder.id), Some(&token))
        .await?;
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn folder_tree_lists_hierarchy() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "folderpass";
    app.insert_user("folder-tree", TestUserRole::Owner).await?;
    let token = app.login_token("folder-tree", password).await?;

    let alpha_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Alpha",
                parent_id: None,
            },
            Some(&token),
        )
        .await?;
    assert_eq!(alpha_resp.status(), StatusCode::CREATED);
    let alpha_body = body_to_vec(alpha_resp.into_body()).await?;
    let alpha: FolderResponse = serde_json::from_slice(&alpha_body)?;

    let archive_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Archive",
                parent_id: Some(alpha.folder.id),
            },
            Some(&token),
        )
        .await?;
    assert_eq!(archive_resp.status(), StatusCode::CREATED);

    let beta_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Beta",
                parent_id: None,
            },
            Some(&token),
        )
        .await?;
    assert_eq!(beta_resp.status(), StatusCode::CREATED);

    let tree_resp = app.get("/api/folders/tree", Some(&token)).await?;
    assert_eq!(tree_resp.status(), StatusCode::OK);
    let tree_body = body_to_vec(tree_resp.into_body()).await?;
    let tree: Vec<FolderTreeNodeResponse> = serde_json::from_slice(&tree_body)?;

    assert_eq!(tree.len(), 2);
    assert_eq!(tree[0].name, "Alpha");
    assert_eq!(tree[0].children.len(), 1);
    assert_eq!(tree[0].children[0].name, "Archive");
    assert!(tree[0].children[0].children.is_empty());

    assert_eq!(tree[1].name, "Beta");
    assert!(tree[1].children.is_empty());

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn update_folder_parent_to_root() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "rootpass";
    app.insert_user("root-admin", TestUserRole::Owner).await?;
    let token = app.login_token("root-admin", password).await?;

    // Create a parent folder under root
    let parent_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Parent",
                parent_id: None,
            },
            Some(&token),
        )
        .await?;
    assert_eq!(parent_resp.status(), StatusCode::CREATED);
    let parent_body = body_to_vec(parent_resp.into_body()).await?;
    let parent: FolderResponse = serde_json::from_slice(&parent_body)?;

    // Create a child folder inside the parent
    let child_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Child",
                parent_id: Some(parent.folder.id),
            },
            Some(&token),
        )
        .await?;
    assert_eq!(child_resp.status(), StatusCode::CREATED);
    let child_body = body_to_vec(child_resp.into_body()).await?;
    let child: FolderResponse = serde_json::from_slice(&child_body)?;

    // Move the child back to the root by setting parent_id to null
    let update_resp = app
        .patch_json(
            &format!("/api/folders/{}", child.folder.id),
            &json!({ "parent_id": null }),
            Some(&token),
        )
        .await?;
    assert_eq!(update_resp.status(), StatusCode::NO_CONTENT);

    // Fetch the child folder and ensure parent_id is now null
    let updated_resp = app
        .get(&format!("/api/folders/{}", child.folder.id), Some(&token))
        .await?;
    assert_eq!(updated_resp.status(), StatusCode::OK);
    let updated_body = body_to_vec(updated_resp.into_body()).await?;
    let updated_folder: FolderResponse = serde_json::from_slice(&updated_body)?;
    assert!(updated_folder.folder.parent_id.is_none());

    // Root contents should include the child folder by name
    let root_contents = app.get("/api/folders/root/contents", Some(&token)).await?;
    assert_eq!(root_contents.status(), StatusCode::OK);
    let root_body = body_to_vec(root_contents.into_body()).await?;
    let root: FolderContents = serde_json::from_slice(&root_body)?;
    assert!(root
        .subfolders
        .iter()
        .any(|folder| folder.id == child.folder.id));

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn ensure_path_creates_nested_folders() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "pathpass";
    app.insert_user("path-admin", TestUserRole::Owner).await?;
    let token = app.login_token("path-admin", password).await?;

    let base_path = EnsureFolderPath {
        parent_id: None,
        segments: &["Team", "Engineering", "Backend"],
    };
    let first_resp = app
        .post_json("/api/folders/path", &base_path, Some(&token))
        .await?;
    assert!(first_resp.status().is_success());
    let first_body = body_to_vec(first_resp.into_body()).await?;
    let first_folder: FolderResponse = serde_json::from_slice(&first_body)?;

    let second_resp = app
        .post_json("/api/folders/path", &base_path, Some(&token))
        .await?;
    assert!(second_resp.status().is_success());
    let second_body = body_to_vec(second_resp.into_body()).await?;
    let second_folder: FolderResponse = serde_json::from_slice(&second_body)?;
    assert_eq!(second_folder.folder.id, first_folder.folder.id);

    let engineering_resp = app
        .post_json(
            "/api/folders/path",
            &EnsureFolderPath {
                parent_id: None,
                segments: &["Team", "Engineering"],
            },
            Some(&token),
        )
        .await?;
    assert_eq!(engineering_resp.status(), StatusCode::OK);
    let engineering_body = body_to_vec(engineering_resp.into_body()).await?;
    let engineering_folder: FolderResponse = serde_json::from_slice(&engineering_body)?;
    assert_ne!(engineering_folder.folder.id, first_folder.folder.id);

    let infra_resp = app
        .post_json(
            "/api/folders/path",
            &EnsureFolderPath {
                parent_id: Some(engineering_folder.folder.id),
                segments: &["Infrastructure"],
            },
            Some(&token),
        )
        .await?;
    assert_eq!(infra_resp.status(), StatusCode::OK);
    let infra_body = body_to_vec(infra_resp.into_body()).await?;
    let infra_folder: FolderResponse = serde_json::from_slice(&infra_body)?;
    assert_ne!(infra_folder.folder.id, engineering_folder.folder.id);

    let infra_dupe_resp = app
        .post_json(
            "/api/folders/path",
            &EnsureFolderPath {
                parent_id: Some(engineering_folder.folder.id),
                segments: &["Infrastructure"],
            },
            Some(&token),
        )
        .await?;
    assert_eq!(infra_dupe_resp.status(), StatusCode::OK);
    let infra_dupe_body = body_to_vec(infra_dupe_resp.into_body()).await?;
    let infra_dupe_folder: FolderResponse = serde_json::from_slice(&infra_dupe_body)?;
    assert_eq!(infra_dupe_folder.folder.id, infra_folder.folder.id);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn create_folder_is_idempotent() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "idempotent";
    app.insert_user("folders-idem", TestUserRole::Owner).await?;
    let token = app.login_token("folders-idem", password).await?;

    let payload = CreateFolder {
        name: "Archive",
        parent_id: None,
    };

    let first_resp = app
        .post_json("/api/folders", &payload, Some(&token))
        .await?;
    assert_eq!(first_resp.status(), StatusCode::CREATED);
    let first_body = body_to_vec(first_resp.into_body()).await?;
    let first_folder: FolderResponse = serde_json::from_slice(&first_body)?;

    let second_resp = app
        .post_json("/api/folders", &payload, Some(&token))
        .await?;
    assert_eq!(second_resp.status(), StatusCode::OK);
    let second_body = body_to_vec(second_resp.into_body()).await?;
    let second_folder: FolderResponse = serde_json::from_slice(&second_body)?;

    assert_eq!(first_folder.folder.id, second_folder.folder.id);

    let root_contents = app.get("/api/folders/root/contents", Some(&token)).await?;
    let root_body = body_to_vec(root_contents.into_body()).await?;
    let root: FolderContents = serde_json::from_slice(&root_body)?;
    let occurrences = root
        .subfolders
        .iter()
        .filter(|folder| folder.id == first_folder.folder.id)
        .count();
    assert_eq!(occurrences, 1);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn ensure_folder_path_is_idempotent() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "pathpass";
    app.insert_user("path-admin", TestUserRole::Owner).await?;
    let token = app.login_token("path-admin", password).await?;

    let segments = ["500 Immobilien", "501 Kreuzweg 2", "501.01 Rechtliches"];
    let payload = EnsureFolderPath {
        parent_id: None,
        segments: &segments,
    };

    let first_resp = app
        .post_json("/api/folders/path", &payload, Some(&token))
        .await?;
    assert!(first_resp.status().is_success());
    let first_body = body_to_vec(first_resp.into_body()).await?;
    let first_folder: FolderResponse = serde_json::from_slice(&first_body)?;

    let second_resp = app
        .post_json("/api/folders/path", &payload, Some(&token))
        .await?;
    assert!(second_resp.status().is_success());
    let second_body = body_to_vec(second_resp.into_body()).await?;
    let second_folder: FolderResponse = serde_json::from_slice(&second_body)?;

    assert_eq!(first_folder.folder.id, second_folder.folder.id);

    // Verify intermediate folders are not duplicated
    let root_contents = app.get("/api/folders/root/contents", Some(&token)).await?;
    let root_body = body_to_vec(root_contents.into_body()).await?;
    let root: FolderContents = serde_json::from_slice(&root_body)?;
    let root_occurrences = root
        .subfolders
        .iter()
        .filter(|folder| folder.name == segments[0])
        .count();
    assert_eq!(root_occurrences, 1);

    let level_one = root
        .subfolders
        .iter()
        .find(|folder| folder.name == segments[0])
        .map(|folder| folder.id)
        .expect("root segment not created");

    let level_one_contents = app
        .get(
            &format!("/api/folders/{}/contents", level_one),
            Some(&token),
        )
        .await?;
    let level_one_body = body_to_vec(level_one_contents.into_body()).await?;
    let level_one_folders: FolderContents = serde_json::from_slice(&level_one_body)?;
    let level_one_occurrences = level_one_folders
        .subfolders
        .iter()
        .filter(|folder| folder.name == segments[1])
        .count();
    assert_eq!(level_one_occurrences, 1);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn folder_rename_updates_name_and_child_paths() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "renamepass";
    app.insert_user("rename-admin", TestUserRole::Owner).await?;
    let token = app.login_token("rename-admin", password).await?;

    let parent_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Projects",
                parent_id: None,
            },
            Some(&token),
        )
        .await?;
    assert_eq!(parent_resp.status(), StatusCode::CREATED);
    let parent_body = body_to_vec(parent_resp.into_body()).await?;
    let parent: FolderResponse = serde_json::from_slice(&parent_body)?;

    let child_resp = app
        .post_json(
            "/api/folders",
            &CreateFolder {
                name: "Q1",
                parent_id: Some(parent.folder.id),
            },
            Some(&token),
        )
        .await?;
    assert_eq!(child_resp.status(), StatusCode::CREATED);
    let child_body = body_to_vec(child_resp.into_body()).await?;
    let child: FolderResponse = serde_json::from_slice(&child_body)?;

    let rename_resp = app
        .patch_json(
            &format!("/api/folders/{}", parent.folder.id),
            &json!({ "name": "Archive" }),
            Some(&token),
        )
        .await?;
    assert_eq!(rename_resp.status(), StatusCode::NO_CONTENT);

    let root_contents = app.get("/api/folders/root/contents", Some(&token)).await?;
    assert_eq!(root_contents.status(), StatusCode::OK);
    let root_body = body_to_vec(root_contents.into_body()).await?;
    let root: FolderContents = serde_json::from_slice(&root_body)?;
    let renamed = root
        .subfolders
        .iter()
        .find(|f| f.id == parent.folder.id)
        .expect("renamed folder present");
    assert_eq!(renamed.name, "Archive");

    let folders_only = app
        .get(
            &format!(
                "/api/folders/{}/contents?include_documents=false",
                parent.folder.id
            ),
            Some(&token),
        )
        .await?;
    assert_eq!(folders_only.status(), StatusCode::OK);
    let folders_only_body = body_to_vec(folders_only.into_body()).await?;
    let folders_only_contents: FolderContents = serde_json::from_slice(&folders_only_body)?;
    assert!(folders_only_contents.documents.is_empty());

    let child_contents = app
        .get(
            &format!("/api/folders/{}/contents", child.folder.id),
            Some(&token),
        )
        .await?;
    assert_eq!(child_contents.status(), StatusCode::OK);
    let child_contents_body = body_to_vec(child_contents.into_body()).await?;
    let child_details: FolderContents = serde_json::from_slice(&child_contents_body)?;
    let child_folder = child_details.folder.expect("child folder info");
    assert_eq!(child_folder.name, "Q1");

    app.cleanup().await?;
    Ok(())
}
