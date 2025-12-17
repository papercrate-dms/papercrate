use anyhow::{anyhow, Result};
use axum::http::StatusCode;
use diesel::prelude::*;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole, UploadExtras};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use papercrate::jobs::{mark_job_succeeded, JOB_PURGE_DOCUMENT};
use papercrate::models::{Job, NewDocumentAsset};
use papercrate::schema::document_assets;
use papercrate::workers::{purge::PurgeDocumentJob, JobExecution, JobHandler};
use std::sync::Arc;
#[derive(Deserialize)]
struct DocumentDetail {
    document: DocumentInfo,
}

#[derive(Deserialize)]
struct ApiErrorResponse {
    error: String,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    details: Option<Value>,
}

#[derive(Deserialize)]
struct DocumentInfo {
    id: Uuid,
    title: String,
    filename: String,
    original_name: String,
    #[serde(default)]
    folder_id: Option<Uuid>,
    deleted_at: Option<String>,
    issued_at: Option<String>,
    metadata: Value,
    tags: Vec<TagSummary>,
    #[serde(default)]
    current_version: Option<DocumentVersionPayload>,
}

#[derive(Deserialize)]
struct DocumentVersionPayload {
    id: Uuid,
    version_number: i32,
    size_bytes: i64,
    download: DownloadLinkPayload,
    #[serde(default)]
    assets: Vec<DocumentAssetInfo>,
}

#[derive(Deserialize)]
struct DownloadLinkPayload {
    url: String,
    expires_at: i64,
}

#[derive(Deserialize)]
struct DocumentVersionListItem {
    id: Uuid,
    version_number: i32,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct DocumentAssetInfo {
    id: Uuid,
    asset_type: String,
}

#[derive(Deserialize)]
struct AssetProxyDetail {
    id: Uuid,
    download: Option<DownloadLinkPayload>,
}

#[derive(Deserialize)]
struct DocumentListItem {
    id: Uuid,
    #[serde(default)]
    current_version: Option<DocumentVersionPayload>,
}

#[derive(Deserialize)]
struct BulkReanalyze {
    queued: usize,
}

#[derive(Deserialize)]
struct BulkMoveResult {
    updated: usize,
}

#[derive(Deserialize)]
struct BulkTagResult {
    added: usize,
    removed: usize,
}

#[derive(Deserialize)]
struct TagSummary {
    label: String,
}

#[derive(Deserialize)]
struct AnalyzeJobPayload {
    document_id: Uuid,
    document_version_id: Uuid,
    #[serde(default)]
    force: bool,
}

#[derive(Deserialize)]
struct FolderResponse {
    folder: FolderInfo,
}

#[derive(Deserialize)]
struct FolderInfo {
    id: Uuid,
}

#[derive(Deserialize)]
struct FolderContents {
    documents: Vec<DocumentListItem>,
}

#[derive(Deserialize)]
struct TagResponse {
    id: Uuid,
}

#[derive(Serialize)]
struct BulkMoveRequest<'a> {
    document_ids: &'a [Uuid],
    folder_id: Option<Uuid>,
}

#[derive(Serialize)]
struct BulkTagRequest<'a> {
    document_ids: &'a [Uuid],
    tag_ids: &'a [Uuid],
    action: &'a str,
}

#[derive(Serialize)]
struct CreateFolderRequest<'a> {
    name: &'a str,
    parent_id: Option<Uuid>,
}

#[derive(Serialize)]
struct CreateTagPayload<'a> {
    label: &'a str,
    color: Option<&'a str>,
}

#[tokio::test]
async fn upload_and_list_document() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "passw0rd";
    app.insert_user("dana", TestUserRole::Owner).await?;
    let token = app.login_token("dana", password).await?;

    let file_bytes = b"example document body".to_vec();
    let upload = app
        .upload_document(
            "/api/documents",
            "doc.txt",
            "text/plain",
            &file_bytes,
            None,
            &token,
        )
        .await?;
    {
        let status = upload.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    assert_eq!(detail.document.original_name, "doc.txt");
    assert_eq!(detail.document.title, "doc");
    assert_eq!(detail.document.deleted_at, None);
    assert!(detail.document.issued_at.is_none());
    assert!(detail.document.tags.is_empty());
    let current_version = detail
        .document
        .current_version
        .as_ref()
        .expect("current version detail");
    assert!(current_version.download.url.starts_with("/api/download/"));
    assert!(current_version.download.expires_at > 0);
    assert_eq!(current_version.version_number, 1);
    assert_eq!(current_version.size_bytes, file_bytes.len() as i64);
    assert!(current_version.assets.is_empty());

    assert_eq!(app.storage().object_count().await, 1);

    let response = app.get("/api/documents", Some(&token)).await?;
    {
        let status = response.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let body = body_to_vec(response.into_body()).await?;
    let mut list: Vec<DocumentListItem> = serde_json::from_slice(&body)?;
    assert_eq!(list.len(), 1);
    let item = list.pop().unwrap();
    assert_eq!(item.id, detail.document.id);
    assert_eq!(
        item.current_version
            .as_ref()
            .map(|version| version.version_number),
        Some(1)
    );
    assert!(item
        .current_version
        .as_ref()
        .expect("list current version")
        .download
        .url
        .starts_with("/api/download/"));

    let redirect = app.get(&current_version.download.url, None).await?;
    assert_eq!(redirect.status(), StatusCode::TEMPORARY_REDIRECT);
    let location = redirect
        .headers()
        .get("location")
        .expect("redirect location header");
    let location = location.to_str().expect("location header utf8");
    assert!(!location.is_empty());

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn upload_document_with_custom_title_sets_filename() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "passw0rd";
    app.insert_user("nora", TestUserRole::Owner).await?;
    let token = app.login_token("nora", password).await?;

    let file_bytes = b"example contract body".to_vec();
    let title = "Vendor Contract";
    let original_filename = "scan.pdf";

    let upload = app
        .upload_document_with_options(
            "/api/documents",
            original_filename,
            "application/pdf",
            &file_bytes,
            None,
            Some(title),
            None,
            &token,
        )
        .await?;
    {
        let status = upload.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    assert_eq!(detail.document.title, title);
    assert_eq!(detail.document.filename, format!("{title}.pdf"));
    assert_eq!(detail.document.original_name, original_filename);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn asset_detail_uses_proxy_urls_when_configured() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::with_config(|config| config.proxy_downloads = true).await?;
    let tenant_id = app.tenant_id().await?;

    let username = "proxy-assets";
    let password = "secret";
    app.insert_user(username, TestUserRole::Owner).await?;
    let token = app.login_token(username, password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "proxy.pdf",
            "application/pdf",
            b"dummy",
            None,
            &token,
        )
        .await?;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;
    let document = detail.document;
    let version = document
        .current_version
        .as_ref()
        .ok_or_else(|| anyhow!("current version missing"))?;

    let mut conn = app
        .state
        .db_for_tenant(tenant_id)
        .map_err(|err| anyhow!("tenant connection: {err:?}"))?;

    let asset_id = Uuid::new_v4();
    let s3_key = "objects/preview.png".to_string();

    diesel::insert_into(document_assets::table)
        .values(&NewDocumentAsset {
            id: asset_id,
            document_version_id: version.id,
            asset_type: "preview".to_string(),
            mime_type: "image/png".to_string(),
            metadata: json!({}),
            s3_key: s3_key.clone(),
            tenant_id,
        })
        .execute(&mut conn)?;

    drop(conn);

    let response = app
        .get(&format!("/api/assets/{asset_id}"), Some(&token))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    let asset_detail: AssetProxyDetail = serde_json::from_slice(&body)?;
    assert_eq!(asset_detail.id, asset_id);
    let download = asset_detail
        .download
        .as_ref()
        .ok_or_else(|| anyhow!("missing download link"))?;
    assert!(download.url.starts_with("/api/download/"));
    assert!(download.expires_at > 0);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn document_list_sorting_controls() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "passw0rd";
    app.insert_user("sorting", TestUserRole::Owner).await?;
    let token = app.login_token("sorting", password).await?;

    let first = app
        .upload_document_with_options(
            "/api/documents",
            "alpha.txt",
            "text/plain",
            b"alpha",
            None,
            Some("Alpha"),
            None,
            &token,
        )
        .await?;
    assert!(first.status().is_success());
    let first_body = body_to_vec(first.into_body()).await?;
    let first_doc: DocumentDetail = serde_json::from_slice(&first_body)?;

    let second = app
        .upload_document_with_options(
            "/api/documents",
            "zulu.txt",
            "text/plain",
            b"zulu",
            None,
            Some("Zulu"),
            None,
            &token,
        )
        .await?;
    assert!(second.status().is_success());
    let second_body = body_to_vec(second.into_body()).await?;
    let second_doc: DocumentDetail = serde_json::from_slice(&second_body)?;

    // Default sort should be title ASC => Alpha first.
    let default_resp = app.get("/api/documents", Some(&token)).await?;
    assert_eq!(default_resp.status(), StatusCode::OK);
    let default_body = body_to_vec(default_resp.into_body()).await?;
    let default_list: Vec<DocumentListItem> = serde_json::from_slice(&default_body)?;
    assert_eq!(default_list.len(), 2);
    assert_eq!(default_list[0].id, first_doc.document.id);
    assert_eq!(default_list[1].id, second_doc.document.id);

    // Sort by created_at DESC, expecting most recent (second) first.
    let created_desc = app
        .get("/api/documents?sort=created_at&dir=desc", Some(&token))
        .await?;
    assert_eq!(created_desc.status(), StatusCode::OK);
    let created_body = body_to_vec(created_desc.into_body()).await?;
    let created_list: Vec<DocumentListItem> = serde_json::from_slice(&created_body)?;
    assert_eq!(created_list.len(), 2);
    assert_eq!(created_list[0].id, second_doc.document.id);
    assert_eq!(created_list[1].id, first_doc.document.id);

    // Folder contents respects the same parameters.
    let folder_resp = app
        .get(
            "/api/folders/root/contents?sort=created_at&dir=desc",
            Some(&token),
        )
        .await?;
    assert_eq!(folder_resp.status(), StatusCode::OK);
    let folder_body = body_to_vec(folder_resp.into_body()).await?;
    let folder_contents: FolderContents = serde_json::from_slice(&folder_body)?;
    assert_eq!(folder_contents.documents.len(), 2);
    assert_eq!(folder_contents.documents[0].id, second_doc.document.id);
    assert_eq!(folder_contents.documents[1].id, first_doc.document.id);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn duplicate_and_restore_document() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "pass1234";
    app.insert_user("sam", TestUserRole::Owner).await?;
    let token = app.login_token("sam", password).await?;

    let payload = b"same bytes".to_vec();
    let first = app
        .upload_document(
            "/api/documents",
            "dup.bin",
            "application/octet-stream",
            &payload,
            None,
            &token,
        )
        .await?;
    let first_status = first.status();
    let first_body = body_to_vec(first.into_body()).await?;
    assert!(
        first_status == StatusCode::OK
            || first_status == StatusCode::CREATED
            || first_status == StatusCode::NO_CONTENT,
        "unexpected first upload status {} with body {}",
        first_status,
        String::from_utf8_lossy(&first_body)
    );
    let first_detail: DocumentDetail = serde_json::from_slice(&first_body)?;

    let second = app
        .upload_document(
            "/api/documents",
            "dup.bin",
            "application/octet-stream",
            &payload,
            None,
            &token,
        )
        .await?;
    let second_status = second.status();
    let second_body = body_to_vec(second.into_body()).await?;
    assert_eq!(second_status, StatusCode::CONFLICT);
    let second_error: ApiErrorResponse = serde_json::from_slice(&second_body)?;
    assert_eq!(second_error.code.as_deref(), Some("duplicate_document"));
    let conflict_id = second_error
        .details
        .as_ref()
        .and_then(|details| details.get("conflict_document_id"))
        .and_then(|value| value.as_str())
        .and_then(|value| Uuid::parse_str(value).ok())
        .expect("conflict_document_id present");
    assert_eq!(conflict_id, first_detail.document.id);
    assert_eq!(app.storage().object_count().await, 1);

    let delete = app
        .post_json(
            &format!("/api/documents/{}/trash", first_detail.document.id),
            &json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(delete.status(), StatusCode::NO_CONTENT);

    let trashed_conflict = app
        .upload_document(
            "/api/documents",
            "dup.bin",
            "application/octet-stream",
            &payload,
            None,
            &token,
        )
        .await?;
    assert_eq!(trashed_conflict.status(), StatusCode::CONFLICT);
    let trashed_body = body_to_vec(trashed_conflict.into_body()).await?;
    let trashed_error: ApiErrorResponse = serde_json::from_slice(&trashed_body)?;
    assert_eq!(trashed_error.code.as_deref(), Some("duplicate_document"));
    assert!(trashed_error.error.contains("trash"));
    let trashed_details = trashed_error.details.as_ref().expect("details present");
    assert_eq!(
        trashed_details
            .get("conflict_document_in_trash")
            .and_then(|value| value.as_bool()),
        Some(true)
    );

    let third = app
        .upload_document_with_extras(
            "/api/documents",
            "dup.bin",
            "application/octet-stream",
            &payload,
            None,
            UploadExtras {
                title: None,
                metadata_json: None,
                tag_ids_json: None,
                correspondents_json: None,
                issued_at: None,
                skip_existing: Some(false),
            },
            &token,
        )
        .await?;
    let third_status = third.status();
    let third_body = body_to_vec(third.into_body()).await?;
    assert!(
        third_status == StatusCode::OK
            || third_status == StatusCode::CREATED
            || third_status == StatusCode::NO_CONTENT,
        "unexpected third upload status {} with body {}",
        third_status,
        String::from_utf8_lossy(&third_body)
    );
    let third_detail: DocumentDetail = serde_json::from_slice(&third_body)?;

    assert_eq!(third_detail.document.id, first_detail.document.id);
    assert_eq!(third_detail.document.deleted_at, None);
    assert!(third_detail
        .document
        .current_version
        .as_ref()
        .expect("third current version")
        .assets
        .is_empty());
    assert_eq!(app.storage().object_count().await, 1);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn upload_skips_existing_when_requested() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "skip-doc";
    app.insert_user("skip", TestUserRole::Owner).await?;
    let token = app.login_token("skip", password).await?;

    let primary_tag_payload = CreateTagPayload {
        label: "primary",
        color: None,
    };
    let primary_tag_resp = app
        .post_json("/api/tags", &primary_tag_payload, Some(&token))
        .await?;
    {
        let status = primary_tag_resp.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let primary_tag_body = body_to_vec(primary_tag_resp.into_body()).await?;
    let primary_tag: TagResponse = serde_json::from_slice(&primary_tag_body)?;

    let payload = b"identical document payload";
    let primary_tag_ids = format!("[\"{}\"]", primary_tag.id);
    let extras = UploadExtras {
        title: Some("Original"),
        metadata_json: None,
        tag_ids_json: Some(primary_tag_ids.as_str()),
        correspondents_json: None,
        issued_at: None,
        skip_existing: None,
    };

    let first_upload = app
        .upload_document_with_extras(
            "/api/documents",
            "original.pdf",
            "application/pdf",
            payload,
            None,
            extras,
            &token,
        )
        .await?;
    {
        let status = first_upload.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let first_body = body_to_vec(first_upload.into_body()).await?;
    let first_detail: DocumentDetail = serde_json::from_slice(&first_body)?;

    let alt_tag_payload = CreateTagPayload {
        label: "alternate",
        color: None,
    };
    let alt_tag_resp = app
        .post_json("/api/tags", &alt_tag_payload, Some(&token))
        .await?;
    {
        let status = alt_tag_resp.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let alt_tag_body = body_to_vec(alt_tag_resp.into_body()).await?;
    let alt_tag: TagResponse = serde_json::from_slice(&alt_tag_body)?;

    let alt_tag_ids = format!("[\"{}\"]", alt_tag.id);
    let skip_extras = UploadExtras {
        title: Some("Updated"),
        metadata_json: None,
        tag_ids_json: Some(alt_tag_ids.as_str()),
        correspondents_json: None,
        issued_at: None,
        skip_existing: Some(true),
    };

    let skip_resp = app
        .upload_document_with_extras(
            "/api/documents",
            "ignored.pdf",
            "application/pdf",
            payload,
            None,
            skip_extras,
            &token,
        )
        .await?;
    assert_eq!(skip_resp.status(), StatusCode::CONFLICT);
    let skip_body = body_to_vec(skip_resp.into_body()).await?;
    let skip_error: ApiErrorResponse = serde_json::from_slice(&skip_body)?;
    assert_eq!(skip_error.code.as_deref(), Some("duplicate_document"));
    let conflict_id = skip_error
        .details
        .as_ref()
        .and_then(|details| details.get("conflict_document_id"))
        .and_then(|value| value.as_str())
        .and_then(|value| Uuid::parse_str(value).ok())
        .expect("conflict_document_id present");
    assert_eq!(conflict_id, first_detail.document.id);

    let fetch = app
        .get(
            &format!("/api/documents/{}", first_detail.document.id),
            Some(&token),
        )
        .await?;
    {
        let status = fetch.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let fetch_body = body_to_vec(fetch.into_body()).await?;
    let fetched: DocumentDetail = serde_json::from_slice(&fetch_body)?;

    assert_eq!(fetched.document.id, first_detail.document.id);
    assert_eq!(fetched.document.title, first_detail.document.title);
    assert_eq!(fetched.document.tags.len(), 1);
    assert_eq!(fetched.document.tags[0].label, "primary");

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn filter_documents_without_tags() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "tagfilter";
    app.insert_user("tagfilter", TestUserRole::Owner).await?;
    let token = app.login_token("tagfilter", password).await?;

    // Create a tag and upload a document that uses it.
    let tag_payload = CreateTagPayload {
        label: "with-tag",
        color: None,
    };
    let tag_resp = app
        .post_json("/api/tags", &tag_payload, Some(&token))
        .await?;
    assert!(tag_resp.status().is_success());
    let tag_body = body_to_vec(tag_resp.into_body()).await?;
    let tag: TagResponse = serde_json::from_slice(&tag_body)?;

    let tag_json = format!("[\"{}\"]", tag.id);
    let tagged_upload = app
        .upload_document_with_extras(
            "/api/documents",
            "with-tag.txt",
            "text/plain",
            b"tagged",
            None,
            UploadExtras {
                title: Some("With Tag"),
                metadata_json: None,
                tag_ids_json: Some(tag_json.as_str()),
                correspondents_json: None,
                issued_at: None,
                skip_existing: None,
            },
            &token,
        )
        .await?;
    assert!(tagged_upload.status().is_success());

    let untagged_upload = app
        .upload_document(
            "/api/documents",
            "without-tag.txt",
            "text/plain",
            b"untagged",
            None,
            &token,
        )
        .await?;
    assert!(untagged_upload.status().is_success());
    let untagged_body = body_to_vec(untagged_upload.into_body()).await?;
    let untagged_detail: DocumentDetail = serde_json::from_slice(&untagged_body)?;

    // Sanity: both documents appear in the default listing.
    let all_resp = app.get("/api/documents", Some(&token)).await?;
    assert_eq!(all_resp.status(), StatusCode::OK);
    let all_body = body_to_vec(all_resp.into_body()).await?;
    let all_docs: Vec<DocumentListItem> = serde_json::from_slice(&all_body)?;
    assert_eq!(all_docs.len(), 2);

    // Filter for documents without tags.
    let none_resp = app.get("/api/documents?tags=none", Some(&token)).await?;
    assert_eq!(none_resp.status(), StatusCode::OK);
    let none_body = body_to_vec(none_resp.into_body()).await?;
    let none_docs: Vec<DocumentListItem> = serde_json::from_slice(&none_body)?;
    assert_eq!(none_docs.len(), 1);
    assert_eq!(none_docs[0].id, untagged_detail.document.id);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn bulk_move_documents_to_folder() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "bulkmove";
    app.insert_user("mover", TestUserRole::Owner).await?;
    let token = app.login_token("mover", password).await?;

    let alpha = app
        .upload_document(
            "/api/documents",
            "alpha.txt",
            "text/plain",
            b"alpha",
            None,
            &token,
        )
        .await?;
    {
        let status = alpha.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let alpha_body = body_to_vec(alpha.into_body()).await?;
    let alpha_detail: DocumentDetail = serde_json::from_slice(&alpha_body)?;

    let beta = app
        .upload_document(
            "/api/documents",
            "beta.txt",
            "text/plain",
            b"beta",
            None,
            &token,
        )
        .await?;
    {
        let status = beta.status();
        assert!(status.is_success(), "status was {}", status);
    }
    let beta_body = body_to_vec(beta.into_body()).await?;
    let beta_detail: DocumentDetail = serde_json::from_slice(&beta_body)?;

    let folder_resp = app
        .post_json(
            "/api/folders",
            &CreateFolderRequest {
                name: "Archives",
                parent_id: None,
            },
            Some(&token),
        )
        .await?;
    {
        let status = folder_resp.status();
        assert!(status.is_success(), "status was {}", status);
    }
    let folder_body = body_to_vec(folder_resp.into_body()).await?;
    let folder: FolderResponse = serde_json::from_slice(&folder_body)?;

    let move_resp = app
        .post_json(
            "/api/documents/bulk/move",
            &BulkMoveRequest {
                document_ids: &[alpha_detail.document.id, beta_detail.document.id],
                folder_id: Some(folder.folder.id),
            },
            Some(&token),
        )
        .await?;
    let move_status = move_resp.status();
    let move_body = body_to_vec(move_resp.into_body()).await?;
    assert!(
        move_status.is_success(),
        "status was {} body {}",
        move_status,
        String::from_utf8_lossy(&move_body)
    );
    let result: BulkMoveResult = serde_json::from_slice(&move_body)?;
    assert_eq!(result.updated, 2);

    let folder_contents = app
        .get(
            &format!("/api/folders/{}/contents", folder.folder.id),
            Some(&token),
        )
        .await?;
    {
        let status = folder_contents.status();
        assert!(status.is_success(), "status was {}", status);
    }
    let folder_body = body_to_vec(folder_contents.into_body()).await?;
    let folder_docs: FolderContents = serde_json::from_slice(&folder_body)?;
    let moved_ids: Vec<_> = folder_docs.documents.iter().map(|doc| doc.id).collect();
    assert!(moved_ids.contains(&alpha_detail.document.id));
    assert!(moved_ids.contains(&beta_detail.document.id));

    let root_contents = app.get("/api/folders/root/contents", Some(&token)).await?;
    let root_body = body_to_vec(root_contents.into_body()).await?;
    let root_docs: FolderContents = serde_json::from_slice(&root_body)?;
    assert!(root_docs
        .documents
        .iter()
        .all(|doc| doc.id != alpha_detail.document.id && doc.id != beta_detail.document.id));

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn bulk_add_tags_for_selection() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "bulktags";
    app.insert_user("tagger", TestUserRole::Owner).await?;
    let token = app.login_token("tagger", password).await?;

    let first = app
        .upload_document(
            "/api/documents",
            "notes.txt",
            "text/plain",
            b"notes",
            None,
            &token,
        )
        .await?;
    {
        let status = first.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let first_body = body_to_vec(first.into_body()).await?;
    let first_detail: DocumentDetail = serde_json::from_slice(&first_body)?;

    let second = app
        .upload_document(
            "/api/documents",
            "report.txt",
            "text/plain",
            b"report",
            None,
            &token,
        )
        .await?;
    {
        let status = second.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let second_body = body_to_vec(second.into_body()).await?;
    let second_detail: DocumentDetail = serde_json::from_slice(&second_body)?;

    let urgent_tag = app
        .post_json(
            "/api/tags",
            &CreateTagPayload {
                label: "Urgent",
                color: None,
            },
            Some(&token),
        )
        .await?;
    {
        let status = urgent_tag.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let urgent_body = body_to_vec(urgent_tag.into_body()).await?;
    let urgent: TagResponse = serde_json::from_slice(&urgent_body)?;

    let review_tag = app
        .post_json(
            "/api/tags",
            &CreateTagPayload {
                label: "Review",
                color: None,
            },
            Some(&token),
        )
        .await?;
    {
        let status = review_tag.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let review_body = body_to_vec(review_tag.into_body()).await?;
    let review: TagResponse = serde_json::from_slice(&review_body)?;

    let add_resp = app
        .post_json(
            "/api/documents/bulk/tags",
            &BulkTagRequest {
                document_ids: &[first_detail.document.id, second_detail.document.id],
                tag_ids: &[urgent.id, review.id],
                action: "add",
            },
            Some(&token),
        )
        .await?;
    {
        let status = add_resp.status();
        assert!(
            status == StatusCode::OK
                || status == StatusCode::CREATED
                || status == StatusCode::NO_CONTENT
        );
    }
    let add_body = body_to_vec(add_resp.into_body()).await?;
    let add_result: BulkTagResult = serde_json::from_slice(&add_body)?;
    assert_eq!(add_result.added, 4);

    for doc_id in [&first_detail.document.id, &second_detail.document.id] {
        let refreshed = app
            .get(&format!("/api/documents/{}", doc_id), Some(&token))
            .await?;
        {
            let status = refreshed.status();
            assert!(status == StatusCode::OK || status == StatusCode::CREATED);
        }
        let refreshed_body = body_to_vec(refreshed.into_body()).await?;
        let detail: DocumentDetail = serde_json::from_slice(&refreshed_body)?;
        let labels: Vec<_> = detail
            .document
            .tags
            .iter()
            .map(|tag| tag.label.as_str())
            .collect();
        assert!(labels.contains(&"Urgent"));
        assert!(labels.contains(&"Review"));
    }

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn bulk_remove_tags_from_selection() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "bulktagremove";
    app.insert_user("tagrem", TestUserRole::Owner).await?;
    let token = app.login_token("tagrem", password).await?;

    let first = app
        .upload_document(
            "/api/documents",
            "meeting-notes.txt",
            "text/plain",
            b"notes",
            None,
            &token,
        )
        .await?;
    let first_body = body_to_vec(first.into_body()).await?;
    let first_detail: DocumentDetail = serde_json::from_slice(&first_body)?;

    let second = app
        .upload_document(
            "/api/documents",
            "draft.txt",
            "text/plain",
            b"draft",
            None,
            &token,
        )
        .await?;
    let second_body = body_to_vec(second.into_body()).await?;
    let second_detail: DocumentDetail = serde_json::from_slice(&second_body)?;

    let urgent_tag = app
        .post_json(
            "/api/tags",
            &CreateTagPayload {
                label: "Urgent",
                color: None,
            },
            Some(&token),
        )
        .await?;
    let urgent_body = body_to_vec(urgent_tag.into_body()).await?;
    let urgent: TagResponse = serde_json::from_slice(&urgent_body)?;

    let review_tag = app
        .post_json(
            "/api/tags",
            &CreateTagPayload {
                label: "Review",
                color: None,
            },
            Some(&token),
        )
        .await?;
    let review_body = body_to_vec(review_tag.into_body()).await?;
    let review: TagResponse = serde_json::from_slice(&review_body)?;

    let seed_resp = app
        .post_json(
            "/api/documents/bulk/tags",
            &BulkTagRequest {
                document_ids: &[first_detail.document.id, second_detail.document.id],
                tag_ids: &[urgent.id, review.id],
                action: "add",
            },
            Some(&token),
        )
        .await?;
    assert!(seed_resp.status().is_success());

    let remove_resp = app
        .post_json(
            "/api/documents/bulk/tags",
            &BulkTagRequest {
                document_ids: &[first_detail.document.id, second_detail.document.id],
                tag_ids: &[urgent.id],
                action: "remove",
            },
            Some(&token),
        )
        .await?;
    assert!(remove_resp.status().is_success());
    let remove_body = body_to_vec(remove_resp.into_body()).await?;
    let remove_result: BulkTagResult = serde_json::from_slice(&remove_body)?;
    assert_eq!(remove_result.removed, 2);
    assert_eq!(remove_result.added, 0);

    for doc_id in [&first_detail.document.id, &second_detail.document.id] {
        let refreshed = app
            .get(&format!("/api/documents/{}", doc_id), Some(&token))
            .await?;
        let refreshed_body = body_to_vec(refreshed.into_body()).await?;
        let detail: DocumentDetail = serde_json::from_slice(&refreshed_body)?;
        let labels: Vec<_> = detail
            .document
            .tags
            .iter()
            .map(|tag| tag.label.as_str())
            .collect();
        assert!(!labels.contains(&"Urgent"));
        assert!(labels.contains(&"Review"));
    }

    let idempotent_resp = app
        .post_json(
            "/api/documents/bulk/tags",
            &BulkTagRequest {
                document_ids: &[first_detail.document.id, second_detail.document.id],
                tag_ids: &[urgent.id],
                action: "remove",
            },
            Some(&token),
        )
        .await?;
    assert!(idempotent_resp.status().is_success());
    let idempotent_body = body_to_vec(idempotent_resp.into_body()).await?;
    let idempotent_result: BulkTagResult = serde_json::from_slice(&idempotent_body)?;
    assert_eq!(idempotent_result.removed, 0);
    assert_eq!(idempotent_result.added, 0);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn bulk_reanalyze_selected_documents() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "subsetrean";
    app.insert_user("subset", TestUserRole::Owner).await?;
    let token = app.login_token("subset", password).await?;

    app.clear_jobs().await?;

    let first = app
        .upload_document(
            "/api/documents",
            "doc-one.txt",
            "text/plain",
            b"one",
            None,
            &token,
        )
        .await?;
    let first_body = body_to_vec(first.into_body()).await?;
    let first_detail: DocumentDetail = serde_json::from_slice(&first_body)?;

    let second = app
        .upload_document(
            "/api/documents",
            "doc-two.txt",
            "text/plain",
            b"two",
            None,
            &token,
        )
        .await?;
    let second_body = body_to_vec(second.into_body()).await?;
    let second_detail: DocumentDetail = serde_json::from_slice(&second_body)?;

    let third = app
        .upload_document(
            "/api/documents",
            "doc-three.txt",
            "text/plain",
            b"three",
            None,
            &token,
        )
        .await?;
    let third_body = body_to_vec(third.into_body()).await?;
    let third_detail: DocumentDetail = serde_json::from_slice(&third_body)?;

    app.clear_jobs().await?;

    let response = app
        .post_json(
            "/api/documents/bulk/reanalyze",
            &serde_json::json!({
                "document_ids": [
                    first_detail.document.id,
                    third_detail.document.id
                ],
                "force": true
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let body = body_to_vec(response.into_body()).await?;
    let bulk: BulkReanalyze = serde_json::from_slice(&body)?;
    assert_eq!(bulk.queued, 2);

    let jobs = app.jobs_by_type("analyze-document").await?;
    assert_eq!(jobs.len(), 2);
    let mut payload_docs = Vec::new();
    for job in jobs {
        let payload: AnalyzeJobPayload = serde_json::from_value(job.payload)?;
        assert!(payload.force);
        payload_docs.push((payload.document_id, payload.document_version_id));
    }

    assert!(payload_docs
        .iter()
        .all(|(doc_id, _)| *doc_id != second_detail.document.id));

    let mut expected = vec![
        (
            first_detail.document.id,
            first_detail
                .document
                .current_version
                .as_ref()
                .expect("first current version")
                .id,
        ),
        (
            third_detail.document.id,
            third_detail
                .document
                .current_version
                .as_ref()
                .expect("third current version")
                .id,
        ),
    ];
    payload_docs.sort();
    expected.sort();
    assert_eq!(payload_docs, expected);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn patch_document_updates_title_and_handles_conflict() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "patch-title";
    app.insert_user("editor", TestUserRole::Owner).await?;
    let token = app.login_token("editor", password).await?;

    let first_upload = app
        .upload_document(
            "/api/documents",
            "report.pdf",
            "application/pdf",
            b"fake pdf contents",
            None,
            &token,
        )
        .await?;
    let first_body = body_to_vec(first_upload.into_body()).await?;
    let mut first_detail: DocumentDetail = serde_json::from_slice(&first_body)?;

    let update = app
        .patch_json(
            &format!("/api/documents/{}", first_detail.document.id),
            &json!({
                "title": "Quarterly Summary"
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(update.status(), StatusCode::OK);
    let update_body = body_to_vec(update.into_body()).await?;
    first_detail = serde_json::from_slice(&update_body)?;
    assert_eq!(first_detail.document.title, "Quarterly Summary");
    assert_eq!(first_detail.document.filename, "Quarterly Summary.pdf");

    let second_upload = app
        .upload_document(
            "/api/documents",
            "notes.pdf",
            "application/pdf",
            b"other pdf",
            None,
            &token,
        )
        .await?;
    let second_body = body_to_vec(second_upload.into_body()).await?;
    let second_detail: DocumentDetail = serde_json::from_slice(&second_body)?;

    let conflict = app
        .patch_json(
            &format!("/api/documents/{}", second_detail.document.id),
            &json!({
                "title": "Quarterly Summary"
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let conflict_body = body_to_vec(conflict.into_body()).await?;
    let conflict_json: ApiErrorResponse = serde_json::from_slice(&conflict_body)?;
    assert_eq!(conflict_json.code.as_deref(), Some("duplicate_filename"));

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn patch_document_updates_and_clears_issued_at() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "patch-issued";
    app.insert_user("scheduler", TestUserRole::Owner).await?;
    let token = app.login_token("scheduler", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "invoice.txt",
            "text/plain",
            b"invoice contents",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;
    assert!(detail.document.issued_at.is_none());

    let issued_at = "2021-02-03T04:05:06Z";
    let response = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "issued_at": issued_at
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body = body_to_vec(response.into_body()).await?;
    let patched: DocumentDetail = serde_json::from_slice(&body)?;
    assert_eq!(
        patched.document.issued_at.as_deref(),
        Some("2021-02-03T04:05:06+00:00")
    );

    let cleared = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "issued_at": null
            }),
            Some(&token),
        )
        .await?;
    let cleared_status = cleared.status();
    let cleared_body = body_to_vec(cleared.into_body()).await?;
    assert!(
        cleared_status == StatusCode::OK,
        "clear issued_at failed status {} body {}",
        cleared_status,
        String::from_utf8_lossy(&cleared_body)
    );
    let cleared_detail: DocumentDetail = serde_json::from_slice(&cleared_body)?;
    assert!(cleared_detail.document.issued_at.is_none());

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn patch_document_metadata_merge_and_replace() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "patch-meta";
    app.insert_user("curator", TestUserRole::Owner).await?;
    let token = app.login_token("curator", password).await?;

    let initial_metadata = r#"{"existing":{"keep":true},"other":1}"#;
    let upload = app
        .upload_document_with_options(
            "/api/documents",
            "meta.txt",
            "text/plain",
            b"meta",
            None,
            None,
            Some(initial_metadata),
            &token,
        )
        .await?;
    let upload_body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&upload_body)?;
    assert_eq!(
        detail.document.metadata,
        json!({
            "existing": {"keep": true},
            "other": 1
        })
    );

    let merge_response = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "metadata": {
                    "value": {
                        "existing": {"update": 5},
                        "added": "new"
                    }
                }
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(merge_response.status(), StatusCode::OK);
    let merge_body = body_to_vec(merge_response.into_body()).await?;
    let merged: DocumentDetail = serde_json::from_slice(&merge_body)?;
    assert_eq!(
        merged.document.metadata,
        json!({
            "existing": {"keep": true, "update": 5},
            "other": 1,
            "added": "new"
        })
    );

    let replace_response = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "metadata": {
                    "replace": true,
                    "value": {"fresh": true}
                }
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(replace_response.status(), StatusCode::OK);
    let replace_body = body_to_vec(replace_response.into_body()).await?;
    let replaced: DocumentDetail = serde_json::from_slice(&replace_body)?;
    assert_eq!(replaced.document.metadata, json!({"fresh": true}));

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn patch_document_validation_errors() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "patch-errors";
    app.insert_user("auditor", TestUserRole::Owner).await?;
    let token = app.login_token("auditor", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "errors.txt",
            "text/plain",
            b"errors",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    let empty_title = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({ "title": "   " }),
            Some(&token),
        )
        .await?;
    assert_eq!(empty_title.status(), StatusCode::BAD_REQUEST);
    let title_body = body_to_vec(empty_title.into_body()).await?;
    let title_error: ApiErrorResponse = serde_json::from_slice(&title_body)?;
    assert_eq!(title_error.error, "title must not be empty");

    let empty_issued = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({ "issued_at": "" }),
            Some(&token),
        )
        .await?;
    assert_eq!(empty_issued.status(), StatusCode::BAD_REQUEST);
    let issued_body = body_to_vec(empty_issued.into_body()).await?;
    let issued_error: ApiErrorResponse = serde_json::from_slice(&issued_body)?;
    assert_eq!(issued_error.error, "issued_at must not be empty");

    let invalid_merge = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "metadata": {
                    "value": 5
                }
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(invalid_merge.status(), StatusCode::BAD_REQUEST);
    let merge_body = body_to_vec(invalid_merge.into_body()).await?;
    let merge_error: ApiErrorResponse = serde_json::from_slice(&merge_body)?;
    assert_eq!(
        merge_error.error,
        "metadata value must be a JSON object when replace is false"
    );

    let replace_scalar = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "metadata": {
                    "replace": true,
                    "value": 5
                }
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(replace_scalar.status(), StatusCode::OK);
    let replace_body = body_to_vec(replace_scalar.into_body()).await?;
    let replace_detail: DocumentDetail = serde_json::from_slice(&replace_body)?;
    assert_eq!(replace_detail.document.metadata, json!(5));

    let merge_after_scalar = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "metadata": {
                    "value": { "new": 1 }
                }
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(merge_after_scalar.status(), StatusCode::BAD_REQUEST);
    let merge_after_body = body_to_vec(merge_after_scalar.into_body()).await?;
    let merge_after_error: ApiErrorResponse = serde_json::from_slice(&merge_after_body)?;
    assert_eq!(
        merge_after_error.error,
        "existing metadata is not an object; set replace=true to overwrite"
    );

    let malformed_timestamp = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({ "issued_at": "not-a-timestamp" }),
            Some(&token),
        )
        .await?;
    assert_eq!(malformed_timestamp.status(), StatusCode::BAD_REQUEST);
    let malformed_body = body_to_vec(malformed_timestamp.into_body()).await?;
    let malformed_error: ApiErrorResponse = serde_json::from_slice(&malformed_body)?;
    assert!(
        malformed_error
            .error
            .starts_with("issued_at must be an RFC3339 timestamp"),
        "unexpected error: {}",
        malformed_error.error
    );

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn patch_document_updates_multiple_fields() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "patch-multi";
    app.insert_user("planner", TestUserRole::Owner).await?;
    let token = app.login_token("planner", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "multi.pdf",
            "application/pdf",
            b"multi",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    let response = app
        .patch_json(
            &format!("/api/documents/{}", detail.document.id),
            &json!({
                "title": "Annual Report",
                "issued_at": "2022-05-01T12:00:00Z",
                "metadata": {
                    "value": {
                        "department": "finance",
                        "year": 2022
                    }
                }
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let response_body = body_to_vec(response.into_body()).await?;
    let updated: DocumentDetail = serde_json::from_slice(&response_body)?;
    assert_eq!(updated.document.title, "Annual Report");
    assert_eq!(updated.document.filename, "Annual Report.pdf");
    assert_eq!(
        updated.document.issued_at.as_deref(),
        Some("2022-05-01T12:00:00+00:00")
    );
    assert_eq!(
        updated.document.metadata,
        json!({
            "department": "finance",
            "year": 2022
        })
    );

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn list_documents_by_status_filter() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "statusfilter";
    app.insert_user("statususer", TestUserRole::Owner).await?;
    let token = app.login_token("statususer", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "trash.txt",
            "text/plain",
            b"trash",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    let delete_resp = app
        .post_json(
            &format!("/api/documents/{}/trash", detail.document.id),
            &json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(delete_resp.status(), StatusCode::NO_CONTENT);

    let active_resp = app.get("/api/documents", Some(&token)).await?;
    assert!(active_resp.status().is_success());
    let active_body = body_to_vec(active_resp.into_body()).await?;
    let active_docs: Vec<DocumentListItem> = serde_json::from_slice(&active_body)?;
    assert!(active_docs.iter().all(|doc| doc.id != detail.document.id));

    let deleted_resp = app
        .get("/api/documents?status=deleted", Some(&token))
        .await?;
    assert!(deleted_resp.status().is_success());
    let deleted_body = body_to_vec(deleted_resp.into_body()).await?;
    let deleted_docs: Vec<DocumentListItem> = serde_json::from_slice(&deleted_body)?;
    assert!(deleted_docs.iter().any(|doc| doc.id == detail.document.id));

    let all_resp = app.get("/api/documents?status=all", Some(&token)).await?;
    assert!(all_resp.status().is_success());
    let all_body = body_to_vec(all_resp.into_body()).await?;
    let all_docs: Vec<DocumentListItem> = serde_json::from_slice(&all_body)?;
    assert!(all_docs.iter().any(|doc| doc.id == detail.document.id));

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn trash_document_requires_active_state() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "trashstate";
    app.insert_user("trashstate", TestUserRole::Owner).await?;
    let token = app.login_token("trashstate", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "trash-once.txt",
            "text/plain",
            b"trash",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    let first = app
        .post_json(
            &format!("/api/documents/{}/trash", detail.document.id),
            &json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(first.status(), StatusCode::NO_CONTENT);

    let second = app
        .post_json(
            &format!("/api/documents/{}/trash", detail.document.id),
            &json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(second.status(), StatusCode::CONFLICT);

    app.cleanup().await?;
    Ok(())
}
#[tokio::test]
async fn purge_document_removes_data() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "purge";
    app.insert_user("purger", TestUserRole::Owner).await?;
    let token = app.login_token("purger", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "purge.bin",
            "application/octet-stream",
            b"permanent",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;
    let document_id = detail.document.id;

    assert_eq!(app.storage().object_count().await, 1);

    let trash_resp = app
        .post_json(
            &format!("/api/documents/{}/trash", document_id),
            &json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(trash_resp.status(), StatusCode::NO_CONTENT);

    let delete_resp = app
        .delete(&format!("/api/documents/{}", document_id), Some(&token))
        .await?;
    assert_eq!(delete_resp.status(), StatusCode::ACCEPTED);

    let duplicate_delete = app
        .delete(&format!("/api/documents/{}", document_id), Some(&token))
        .await?;
    assert_eq!(duplicate_delete.status(), StatusCode::ACCEPTED);

    let purge_job_count: i64 = app
        .with_conn(|conn| {
            use diesel::dsl::count_star;
            use diesel::prelude::*;
            use papercrate::schema::jobs::dsl::*;

            let count: i64 = jobs
                .filter(job_type.eq(JOB_PURGE_DOCUMENT))
                .select(count_star())
                .get_result(conn)?;
            Ok(count)
        })
        .await?;
    assert_eq!(purge_job_count, 1);

    let job: Job = app
        .with_conn(|conn| {
            use diesel::prelude::*;
            use papercrate::schema::jobs::dsl::*;

            let job = jobs
                .filter(job_type.eq(JOB_PURGE_DOCUMENT))
                .order(created_at.desc())
                .first(conn)?;
            Ok(job)
        })
        .await?;

    let handler = PurgeDocumentJob::new();
    let state = Arc::new(app.state.clone());
    let storage = app
        .state
        .storage_for_tenant(job.tenant_id.expect("job should have tenant"))
        .map_err(|err| anyhow!("tenant storage unavailable: {err:?}"))?;
    let execution = handler.handle(state, job.clone(), storage).await;
    assert!(matches!(execution, JobExecution::Success));

    app.with_conn(move |conn| {
        mark_job_succeeded(conn, job.id)?;
        Ok(())
    })
    .await?;

    let fetch = app
        .get(&format!("/api/documents/{}", document_id), Some(&token))
        .await?;
    assert_eq!(fetch.status(), StatusCode::NOT_FOUND);

    assert_eq!(app.storage().object_count().await, 0);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_document_requires_trash() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "conflict";
    app.insert_user("conflict-user", TestUserRole::Owner)
        .await?;
    let token = app.login_token("conflict-user", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "conflict.bin",
            "application/octet-stream",
            b"restore",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    let delete_resp = app
        .delete(
            &format!("/api/documents/{}", detail.document.id),
            Some(&token),
        )
        .await?;
    assert_eq!(delete_resp.status(), StatusCode::CONFLICT);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn restore_document_to_original_and_custom_folder() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "restoretest";
    app.insert_user("restorer", TestUserRole::Owner).await?;
    let token = app.login_token("restorer", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "to-restore.txt",
            "text/plain",
            b"restore",
            None,
            &token,
        )
        .await?;
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;

    let delete_resp = app
        .post_json(
            &format!("/api/documents/{}/trash", detail.document.id),
            &json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(delete_resp.status(), StatusCode::NO_CONTENT);

    let restore_resp = app
        .post_json(
            &format!("/api/documents/{}/restore", detail.document.id),
            &serde_json::json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(restore_resp.status(), StatusCode::NO_CONTENT);

    let fetched = app
        .get(
            &format!("/api/documents/{}", detail.document.id),
            Some(&token),
        )
        .await?;
    assert!(fetched.status().is_success());
    let fetched_body = body_to_vec(fetched.into_body()).await?;
    let fetched_detail: DocumentDetail = serde_json::from_slice(&fetched_body)?;
    assert!(fetched_detail.document.deleted_at.is_none());

    let folder_resp = app
        .post_json(
            "/api/folders",
            &CreateFolderRequest {
                name: "Restored",
                parent_id: None,
            },
            Some(&token),
        )
        .await?;
    assert!(folder_resp.status().is_success());
    let folder_body = body_to_vec(folder_resp.into_body()).await?;
    let folder: FolderResponse = serde_json::from_slice(&folder_body)?;

    let delete_again = app
        .post_json(
            &format!("/api/documents/{}/trash", detail.document.id),
            &json!({}),
            Some(&token),
        )
        .await?;
    assert_eq!(delete_again.status(), StatusCode::NO_CONTENT);

    let restore_custom = app
        .post_json(
            &format!("/api/documents/{}/restore", detail.document.id),
            &serde_json::json!({
                "folder_id": folder.folder.id
            }),
            Some(&token),
        )
        .await?;
    assert_eq!(restore_custom.status(), StatusCode::NO_CONTENT);

    let fetched_custom = app
        .get(
            &format!("/api/documents/{}", detail.document.id),
            Some(&token),
        )
        .await?;
    let fetched_custom_body = body_to_vec(fetched_custom.into_body()).await?;
    let fetched_custom_detail: DocumentDetail = serde_json::from_slice(&fetched_custom_body)?;
    assert_eq!(
        fetched_custom_detail.document.folder_id,
        Some(folder.folder.id)
    );
    assert!(fetched_custom_detail.document.deleted_at.is_none());

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn list_document_versions_and_fetch_detail() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "versionlist";
    app.insert_user("versions", TestUserRole::Owner).await?;
    let token = app.login_token("versions", password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "versioned.txt",
            "text/plain",
            b"versioned",
            None,
            &token,
        )
        .await?;
    let upload_body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&upload_body)?;

    let version_id = detail
        .document
        .current_version
        .as_ref()
        .expect("current version")
        .id;

    let list_resp = app
        .get(
            &format!("/api/documents/{}/versions", detail.document.id),
            Some(&token),
        )
        .await?;
    assert!(list_resp.status().is_success());
    let list_body = body_to_vec(list_resp.into_body()).await?;
    let versions: Vec<DocumentVersionListItem> = serde_json::from_slice(&list_body)?;
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].id, version_id);
    assert_eq!(versions[0].version_number, 1);

    let detail_resp = app
        .get(
            &format!(
                "/api/documents/{}/versions/{}",
                detail.document.id, version_id
            ),
            Some(&token),
        )
        .await?;
    assert!(detail_resp.status().is_success());
    let detail_body = body_to_vec(detail_resp.into_body()).await?;
    let version_detail: DocumentVersionPayload = serde_json::from_slice(&detail_body)?;
    assert_eq!(version_detail.id, version_id);
    assert!(version_detail.download.url.starts_with("/api/download/"));
    assert!(version_detail.download.expires_at > 0);
    assert!(version_detail.assets.is_empty());

    app.cleanup().await?;
    Ok(())
}
