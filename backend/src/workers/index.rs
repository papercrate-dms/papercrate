use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;

use crate::documents::search::{build_quickwit_ingest_record, quickwit_ingest};

use super::{
    ocr::TEXT_CONTENT_ASSET_TYPE,
    taskflow::{document::DocumentVersionTaskContext, Task, TaskError, TaskResult},
};

pub struct IndexDocumentTask;

impl IndexDocumentTask {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Task<DocumentVersionTaskContext> for IndexDocumentTask {
    fn name(&self) -> &'static str {
        "index-document-text"
    }

    async fn execute(&self, ctx: &mut DocumentVersionTaskContext) -> TaskResult<()> {
        let state = ctx.state().clone();
        let quickwit_endpoint = state
            .config
            .quickwit_endpoint
            .clone()
            .ok_or_else(|| TaskError::fail("quickwit endpoint missing"))?;

        let tenant = state.tenants.get_by_id(ctx.tenant_id()).map_err(|err| {
            TaskError::retry(
                Duration::from_secs(30),
                format!("failed to load tenant: {err:?}"),
            )
        })?;

        let quickwit_index = tenant
            .quickwit_index
            .clone()
            .ok_or_else(|| TaskError::fail("tenant quickwit index not configured"))?;

        let asset = ctx
            .asset(TEXT_CONTENT_ASSET_TYPE)
            .await?
            .ok_or_else(|| TaskError::fail("missing OCR text asset"))?;

        let s3_key = asset.asset.s3_key.clone();
        let bytes = ctx.storage().get_object(&s3_key).await.map_err(|err| {
            TaskError::retry(
                Duration::from_secs(30),
                format!("failed to download ocr text: {err}"),
            )
        })?;

        let text = String::from_utf8(bytes)
            .map_err(|err| TaskError::fail(format!("ocr text not valid UTF-8: {err}")))?;

        if text.trim().is_empty() {
            return Err(TaskError::fail("ocr text empty"));
        }

        let document = ctx.document().await?.clone();
        let version = ctx.version().await?.clone();

        let record = build_quickwit_ingest_record(&document, &version, ctx.tenant_id(), &text);
        let client = Client::new();

        quickwit_ingest(&client, &quickwit_endpoint, &quickwit_index, &[record])
            .await
            .map_err(|err| TaskError::retry(Duration::from_secs(30), err.to_string()))?;

        Ok(())
    }
}
