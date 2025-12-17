use anyhow::Result;
use axum::http::StatusCode;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
struct DocumentDetail {
    document: DocumentInfo,
}

#[derive(Clone, Deserialize)]
struct DocumentInfo {
    current_version: Option<DocumentVersion>,
}

#[derive(Clone, Deserialize)]
struct DocumentVersion {
    download: DownloadLink,
}

#[derive(Clone, Deserialize)]
struct DownloadLink {
    url: String,
    expires_at: i64,
}

#[tokio::test]
async fn document_download_redirects_when_proxy_disabled() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let username = "download-user";
    let password = "secret";
    app.insert_user(username, TestUserRole::Owner).await?;
    let token = app.login_token(username, password).await?;

    let upload = app
        .upload_document(
            "/api/documents",
            "download.pdf",
            "application/pdf",
            b"dummy",
            None,
            &token,
        )
        .await?;
    assert_eq!(upload.status(), StatusCode::CREATED);
    let body = body_to_vec(upload.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;
    let download_link = detail
        .document
        .current_version
        .as_ref()
        .expect("missing version")
        .download
        .clone();
    assert!(download_link.expires_at > 0);
    let download_path = download_link.url.clone();

    let redirect = app.get(&download_path, None).await?;
    assert_eq!(redirect.status(), StatusCode::TEMPORARY_REDIRECT);
    let location = redirect
        .headers()
        .get("location")
        .expect("redirect location header")
        .to_str()
        .expect("location utf8");
    assert!(location.starts_with("https://fake-storage/"));

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn download_with_invalid_token_is_rejected() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let response = app.get("/api/download/not-a-token", None).await?;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    app.cleanup().await?;
    Ok(())
}
