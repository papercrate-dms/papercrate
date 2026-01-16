use std::{collections::HashSet, sync::Arc, time::Duration};

use async_trait::async_trait;
use diesel::prelude::*;
use infer;
use serde::Deserialize;
use tokio::task;
use uuid::Uuid;

use crate::{
    auth::ensure_active_tenant, jobs::JOB_ANALYZE_DOCUMENT, models::Document, state::AppState,
    storage::TenantStorage,
};

use super::{
    index::IndexDocumentTask,
    issued_at::DetermineIssuedAtTask,
    job_execution_from_task_error,
    ocr::{GenerateOcrTask, TEXT_CONTENT_ASSET_TYPE},
    taskflow::{
        document::DocumentVersionTaskContext, BoxedTask, Task, TaskError, TaskExecutor,
        TaskPlanner, TaskResult,
    },
    thumbnails::GenerateThumbnailsTask,
    JobExecution, JobHandler,
};

#[derive(Debug, Deserialize)]
struct AnalyzePayload {
    document_id: Uuid,
    document_version_id: Uuid,
    #[serde(default)]
    force: bool,
}

pub struct AnalyzeDocumentJob;

impl AnalyzeDocumentJob {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl JobHandler for AnalyzeDocumentJob {
    fn job_type(&self) -> &'static str {
        JOB_ANALYZE_DOCUMENT
    }

    async fn handle(
        &self,
        state: Arc<AppState>,
        job: crate::models::Job,
        storage: TenantStorage,
    ) -> JobExecution {
        let tenant_id = match job.tenant_id {
            Some(id) => id,
            None => {
                return JobExecution::Failed {
                    error: "job is no longer associated with a tenant".to_string(),
                }
            }
        };

        if let Err(err) = ensure_active_tenant(&state, tenant_id) {
            return JobExecution::Failed {
                error: err.to_string(),
            };
        }

        let payload: AnalyzePayload = match serde_json::from_value(job.payload.clone()) {
            Ok(payload) => payload,
            Err(err) => {
                return JobExecution::Failed {
                    error: format!("invalid analyze payload: {err}"),
                }
            }
        };

        let mut context = DocumentVersionTaskContext::new(
            job.id,
            JOB_ANALYZE_DOCUMENT,
            tenant_id,
            payload.document_id,
            payload.document_version_id,
            payload.force,
            state.config.worker_max_document_bytes,
            state.clone(),
            storage,
        );

        let planner = AnalyzePlanner::new(payload.force, state.clone());
        match TaskExecutor::run(&planner, &mut context).await {
            Ok(()) => JobExecution::Success,
            Err(err) => job_execution_from_task_error(err),
        }
    }
}

struct AnalyzePlanner {
    force: bool,
    state: Arc<AppState>,
}

const MIME_SNIFF_BYTES: usize = 8192;

impl AnalyzePlanner {
    fn new(force: bool, state: Arc<AppState>) -> Self {
        Self { force, state }
    }
}

#[async_trait]
impl TaskPlanner<DocumentVersionTaskContext> for AnalyzePlanner {
    async fn plan(
        &self,
        ctx: &mut DocumentVersionTaskContext,
    ) -> TaskResult<Vec<BoxedTask<DocumentVersionTaskContext>>> {
        let document = ctx.document().await?.clone();
        let mut tasks: Vec<BoxedTask<DocumentVersionTaskContext>> = Vec::new();

        tasks.push(Box::new(EnsureMimeTask));

        let (thumbnail_supported, _) = determine_thumbnail_support(&document);
        if thumbnail_supported {
            tasks.push(Box::new(GenerateThumbnailsTask::new(self.force)));
        }

        let existing_ocr = ctx.asset(TEXT_CONTENT_ASSET_TYPE).await?.is_some();
        let mut should_index = existing_ocr;

        if document_supports_ocr(&document) {
            if self.force || !existing_ocr {
                tasks.push(Box::new(GenerateOcrTask::new(
                    self.force,
                    self.state.clone(),
                )));
                should_index = true;
            }
        }

        tasks.push(Box::new(DetermineIssuedAtTask::new()));

        if should_index {
            tasks.push(Box::new(IndexDocumentTask::new()));
        }

        Ok(tasks)
    }
}

struct EnsureMimeTask;

#[async_trait]
impl Task<DocumentVersionTaskContext> for EnsureMimeTask {
    fn name(&self) -> &'static str {
        "ensure-mime-type"
    }

    async fn execute(&self, ctx: &mut DocumentVersionTaskContext) -> TaskResult<()> {
        let document = ctx.document().await?.clone();
        let current = document.mime_type.clone();

        let guessed = guess_mime_type(ctx, &document).await?;
        let desired = match guessed {
            Some(mime) if current.as_deref() != Some(mime.as_str()) => Some(mime),
            _ => None,
        };

        if let Some(new_mime) = desired {
            update_document_mime(ctx, document.id, new_mime).await?;
        }

        Ok(())
    }
}

async fn guess_mime_type(
    ctx: &mut DocumentVersionTaskContext,
    document: &Document,
) -> TaskResult<Option<String>> {
    let bytes = ctx.object_head(MIME_SNIFF_BYTES).await?;
    Ok(sniff_mime(&bytes, &document.original_name))
}

fn sniff_mime(bytes: &[u8], original_name: &str) -> Option<String> {
    if let Some(kind) = infer::get(bytes) {
        return Some(kind.mime_type().to_string());
    }

    mime_guess::from_path(original_name)
        .first_raw()
        .map(|value| value.to_string())
}

async fn update_document_mime(
    ctx: &mut DocumentVersionTaskContext,
    document_id: Uuid,
    mime_type: String,
) -> TaskResult<()> {
    let tenant_id = ctx.tenant_id();
    let state = ctx.state().clone();
    let mime_type_clone = mime_type.clone();

    task::spawn_blocking(move || -> Result<(), String> {
        let mut conn = state
            .db_for_tenant(tenant_id)
            .map_err(|err| format!("{err:?}"))?;

        diesel::update(
            crate::schema::documents::table.filter(crate::schema::documents::id.eq(document_id)),
        )
        .set(crate::schema::documents::mime_type.eq(Some(mime_type_clone)))
        .execute(&mut *conn)
        .map_err(|err| format!("{err:?}"))
        .map(|_| ())
    })
    .await
    .map_err(|err| {
        TaskError::retry(
            Duration::from_secs(60),
            format!("mime update task panicked: {err}"),
        )
    })?
    .map_err(|err| TaskError::retry(Duration::from_secs(30), err))?;

    ctx.set_document_mime(Some(mime_type));
    Ok(())
}

pub(crate) fn determine_thumbnail_support(document: &Document) -> (bool, Option<String>) {
    let supported_mimes: HashSet<&'static str> = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/tiff",
        "image/bmp",
        "image/webp",
        "application/pdf",
        "video/mp4",
        "video/quicktime",
        "video/webm",
        "video/x-msvideo",
        "video/x-ms-wmv",
        "video/x-matroska",
    ]
    .into_iter()
    .collect();

    if let Some(ref mime_type) = document.mime_type {
        if supported_mimes.contains(mime_type.as_str()) {
            return (true, None);
        }
    }

    if let Some(ext) = document
        .original_name
        .rsplit('.')
        .next()
        .map(|ext| ext.to_ascii_lowercase())
    {
        let supported_exts = [
            "jpg", "jpeg", "png", "gif", "tif", "tiff", "bmp", "webp", "pdf", "mp4", "m4v", "mov",
            "webm", "mkv", "avi", "wmv",
        ];
        if supported_exts.contains(&ext.as_str()) {
            return (true, None);
        }
    }

    (
        false,
        Some("content type not supported for thumbnails".into()),
    )
}

fn document_supports_ocr(document: &Document) -> bool {
    document
        .mime_type
        .as_deref()
        .map(|mime| mime.eq_ignore_ascii_case("application/pdf"))
        .unwrap_or_else(|| {
            document
                .original_name
                .rsplit('.')
                .next()
                .map(|ext| ext.eq_ignore_ascii_case("pdf"))
                .unwrap_or(false)
        })
}

#[cfg(test)]
mod tests {
    use super::sniff_mime;

    #[test]
    fn sniff_mime_prefers_magic_bytes() {
        const PNG_HEADER: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        let mime = sniff_mime(&PNG_HEADER, "file.txt");
        assert_eq!(mime.as_deref(), Some("image/png"));
    }

    #[test]
    fn sniff_mime_falls_back_to_extension() {
        let mime = sniff_mime(b"not enough to detect", "video.mp4");
        assert_eq!(mime.as_deref(), Some("video/mp4"));
    }
}
