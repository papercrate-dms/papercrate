use anyhow::Result;
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Deserialize)]
struct DocumentDetail {
    document: DocumentSummary,
}

#[derive(Deserialize)]
struct DocumentSummary {
    id: Uuid,
    #[serde(rename = "title")]
    _title: String,
    #[serde(default)]
    correspondents: Vec<DocumentCorrespondentSummary>,
}

#[derive(Deserialize)]
struct DocumentCorrespondentSummary {
    id: Uuid,
    name: String,
}

#[derive(Deserialize)]
struct CorrespondentSummary {
    id: Uuid,
}

#[derive(Deserialize)]
struct BulkCorrespondentResult {
    assigned: usize,
    removed: usize,
}

struct TestContext {
    app: TestApp,
    token: String,
    document_ids: Vec<Uuid>,
    sender_id: Uuid,
    receiver_id: Uuid,
}

impl TestContext {
    const SENDER_NAME: &'static str = "Acme Corp";
    const RECEIVER_NAME: &'static str = "Bank Ltd";

    async fn new(prefix: &str) -> Result<Self> {
        let app = TestApp::new().await?;
        let username = format!("{prefix}_user");
        let password = format!("{prefix}_pw");
        app.insert_user(&username, TestUserRole::Owner).await?;
        let token = app.login_token(&username, &password).await?;

        let first_id =
            upload_document(&app, &token, &format!("{prefix}-one.txt"), b"letter one").await?;
        let second_id =
            upload_document(&app, &token, &format!("{prefix}-two.txt"), b"letter two").await?;
        let sender_id = create_correspondent(&app, &token, Self::SENDER_NAME).await?;
        let receiver_id = create_correspondent(&app, &token, Self::RECEIVER_NAME).await?;

        Ok(Self {
            app,
            token,
            document_ids: vec![first_id, second_id],
            sender_id,
            receiver_id,
        })
    }

    async fn assign(&self, correspondent_ids: &[Uuid]) -> Result<BulkCorrespondentResult> {
        self.assign_with_action(correspondent_ids, None).await
    }

    async fn assign_with_action(
        &self,
        correspondent_ids: &[Uuid],
        action: Option<&str>,
    ) -> Result<BulkCorrespondentResult> {
        let assignments: Vec<_> = correspondent_ids
            .iter()
            .map(|id| json!({ "correspondent_id": id }))
            .collect();

        let mut payload = json!({
            "document_ids": self.document_ids,
            "assignments": assignments,
        });

        if let Some(action) = action {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("action".to_string(), json!(action));
            }
        }

        let response = self
            .app
            .post_json(
                "/api/documents/bulk/correspondents",
                &payload,
                Some(&self.token),
            )
            .await?;
        assert!(response.status().is_success());
        let body = body_to_vec(response.into_body()).await?;
        Ok(serde_json::from_slice(&body)?)
    }

    async fn fetch_correspondents(
        &self,
        document_id: Uuid,
    ) -> Result<Vec<DocumentCorrespondentSummary>> {
        let detail = fetch_document_detail(&self.app, &self.token, document_id).await?;
        Ok(detail.document.correspondents)
    }

    async fn create_correspondent(&self, name: &str) -> Result<Uuid> {
        create_correspondent(&self.app, &self.token, name).await
    }
}

#[tokio::test]
async fn bulk_assign_correspondents_adds_new_links() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let context = TestContext::new("corresp_add").await?;

    let result = context
        .assign(&[context.sender_id, context.receiver_id])
        .await?;
    assert_eq!(result.assigned, 4);
    assert_eq!(result.removed, 0);

    for doc_id in &context.document_ids {
        let correspondents = context.fetch_correspondents(*doc_id).await?;
        let names: Vec<_> = correspondents
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert!(names.contains(&TestContext::SENDER_NAME));
        assert!(names.contains(&TestContext::RECEIVER_NAME));
        let ids: Vec<_> = correspondents.iter().map(|entry| entry.id).collect();
        assert!(ids.contains(&context.sender_id));
        assert!(ids.contains(&context.receiver_id));
    }

    context.app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn bulk_assign_correspondents_is_idempotent() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let context = TestContext::new("corresp_idempotent").await?;

    context
        .assign(&[context.sender_id, context.receiver_id])
        .await?;
    let repeat = context
        .assign(&[context.sender_id, context.receiver_id])
        .await?;
    assert_eq!(repeat.assigned, 0);
    assert_eq!(repeat.removed, 0);

    context.app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn bulk_remove_correspondents_detaches_links() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let context = TestContext::new("corresp_remove").await?;

    context
        .assign(&[context.sender_id, context.receiver_id])
        .await?;
    let removal = context
        .assign_with_action(&[context.sender_id], Some("remove"))
        .await?;
    assert_eq!(removal.assigned, 0);
    assert_eq!(removal.removed, 2);

    for doc_id in &context.document_ids {
        let correspondents = context.fetch_correspondents(*doc_id).await?;
        assert_eq!(correspondents.len(), 1);
        let entry = &correspondents[0];
        assert_eq!(entry.id, context.receiver_id);
        assert_eq!(entry.name, TestContext::RECEIVER_NAME);
    }

    context.app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn bulk_assign_correspondents_appends_new_entries() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let context = TestContext::new("corresp_append").await?;

    context
        .assign(&[context.sender_id, context.receiver_id])
        .await?;
    context
        .assign_with_action(&[context.sender_id], Some("remove"))
        .await?;

    let charlie_name = "Charlie";
    let charlie_id = context.create_correspondent(charlie_name).await?;
    let add_result = context.assign(&[charlie_id]).await?;
    assert_eq!(add_result.assigned, 2);
    assert_eq!(add_result.removed, 0);

    for doc_id in &context.document_ids {
        let correspondents = context.fetch_correspondents(*doc_id).await?;
        assert_eq!(correspondents.len(), 2);
        let ids: Vec<_> = correspondents.iter().map(|entry| entry.id).collect();
        assert!(ids.contains(&context.receiver_id));
        assert!(ids.contains(&charlie_id));
        let names: Vec<_> = correspondents
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert!(names.contains(&TestContext::RECEIVER_NAME));
        assert!(names.contains(&charlie_name));
    }

    context.app.cleanup().await?;
    Ok(())
}

async fn upload_document(
    app: &TestApp,
    token: &str,
    filename: &str,
    contents: &[u8],
) -> Result<Uuid> {
    let response = app
        .upload_document(
            "/api/documents",
            filename,
            "text/plain",
            contents,
            None,
            token,
        )
        .await?;
    assert!(response.status().is_success());
    let body = body_to_vec(response.into_body()).await?;
    let detail: DocumentDetail = serde_json::from_slice(&body)?;
    Ok(detail.document.id)
}

async fn create_correspondent(app: &TestApp, token: &str, name: &str) -> Result<Uuid> {
    let response = app
        .post_json("/api/correspondents", &json!({ "name": name }), Some(token))
        .await?;
    assert!(response.status().is_success());
    let body = body_to_vec(response.into_body()).await?;
    let summary: CorrespondentSummary = serde_json::from_slice(&body)?;
    Ok(summary.id)
}

async fn fetch_document_detail(
    app: &TestApp,
    token: &str,
    document_id: Uuid,
) -> Result<DocumentDetail> {
    let response = app
        .get(&format!("/api/documents/{document_id}"), Some(token))
        .await?;
    assert!(response.status().is_success());
    let body = body_to_vec(response.into_body()).await?;
    Ok(serde_json::from_slice(&body)?)
}
