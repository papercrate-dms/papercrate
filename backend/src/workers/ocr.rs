use std::{
    fmt, fs,
    io::{ErrorKind, Write},
    process::Command,
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use chrono::Utc;
use diesel::{pg::upsert::excluded, prelude::*};
use pdfium_render::prelude::*;
use serde_json::json;
use tempfile::NamedTempFile;
use tokio::task;
use tracing::{info, warn};
use uuid::Uuid;

use crate::{
    documents::asset::delete_asset,
    error::AppResult,
    models::{Document, DocumentAsset, DocumentVersion, NewDocumentAsset},
    schema::document_assets,
    state::AppState,
    utils::storage_paths::document_asset_key,
};

use super::taskflow::{
    document::DocumentVersionTaskContext, Task, TaskContext, TaskError, TaskResult,
};

pub const TEXT_CONTENT_ASSET_TYPE: &str = "text-content";
const MIN_TEXT_LENGTH: usize = 50;

pub struct GenerateOcrTask {
    force: bool,
    state: Arc<AppState>,
}

impl GenerateOcrTask {
    pub fn new(force: bool, state: Arc<AppState>) -> Self {
        Self { force, state }
    }
}

#[async_trait]
impl Task<DocumentVersionTaskContext> for GenerateOcrTask {
    fn name(&self) -> &'static str {
        "generate-ocr-text"
    }

    async fn execute(&self, ctx: &mut DocumentVersionTaskContext) -> TaskResult<()> {
        let context = build_ocr_context(ctx, self.force).await?;

        if context.skip {
            info!(job_id = %ctx.job_id(), "ocr already present; skipping");
            return Ok(());
        }

        let bytes = ctx.buffered_object().await?.to_vec();
        let meta = PdfDocumentMeta {
            mime_type: context.document.mime_type.clone(),
            original_name: context.document.original_name.clone(),
        };

        let generation = task::spawn_blocking(move || generate_ocr_text(&meta, &bytes))
            .await
            .map_err(|err| {
                TaskError::retry(
                    Duration::from_secs(60),
                    format!("ocr text task panicked: {err}"),
                )
            })?;

        let Some(generation) = generation else {
            warn!(job_id = %ctx.job_id(), "no text extracted from document; failing job");
            return Err(TaskError::fail("no text extracted and OCR unavailable"));
        };

        remove_existing_ocr_asset(ctx, &context).await;

        let asset_id = Uuid::new_v4();
        let s3_key = document_asset_key(
            context.document.id,
            context.version.version_number,
            TEXT_CONTENT_ASSET_TYPE,
            asset_id,
        );

        ctx.storage()
            .put_object(
                &s3_key,
                generation.text.into_bytes(),
                Some("text/plain; charset=utf-8".into()),
                None,
            )
            .await
            .map_err(|err| TaskError::retry(Duration::from_secs(30), err.to_string()))?;

        let state = self.state.clone();
        task::spawn_blocking(move || {
            persist_ocr_metadata(state, &context, asset_id, &s3_key, generation.source)
        })
        .await
        .map_err(|err| {
            TaskError::retry(
                Duration::from_secs(60),
                format!("ocr metadata task panicked: {err}"),
            )
        })?
        .map_err(|err| TaskError::retry(Duration::from_secs(30), err))?;

        ctx.invalidate_asset_cache();

        Ok(())
    }
}

struct OcrContext {
    document: Document,
    version: DocumentVersion,
    existing_asset: Option<DocumentAsset>,
    skip: bool,
}

async fn build_ocr_context(
    ctx: &mut DocumentVersionTaskContext,
    force: bool,
) -> TaskResult<OcrContext> {
    let document = ctx.document().await?.clone();
    let version = ctx.version().await?.clone();
    let asset = ctx.asset(TEXT_CONTENT_ASSET_TYPE).await?;

    let existing_asset = asset.map(|asset| asset.asset.clone());

    if !document_is_pdf(&document) {
        return Ok(OcrContext {
            document,
            version,
            existing_asset,
            skip: true,
        });
    }

    let skip = existing_asset.is_some() && !force;

    Ok(OcrContext {
        document,
        version,
        existing_asset,
        skip,
    })
}

async fn remove_existing_ocr_asset(ctx: &DocumentVersionTaskContext, context: &OcrContext) {
    if let Some(existing_asset) = &context.existing_asset {
        if let Err(err) = ctx.storage().delete_object(&existing_asset.s3_key).await {
            warn!(
                job_id = %ctx.job_id(),
                error = %err,
                s3_key = %existing_asset.s3_key,
                "failed to delete existing ocr asset object"
            );
        }

        let tenant_id = context.document.tenant_id;
        let asset_id = existing_asset.id;
        let state = ctx.state().clone();
        match task::spawn_blocking(move || -> AppResult<()> {
            let mut conn = state.db_for_tenant(tenant_id)?;
            delete_asset(&mut *conn, tenant_id, asset_id)
        })
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                warn!(
                    job_id = %ctx.job_id(),
                    error = ?err,
                    asset_id = %asset_id,
                    "failed to remove ocr asset metadata after deletion"
                );
            }
            Err(join_err) => {
                warn!(
                    job_id = %ctx.job_id(),
                    error = %join_err,
                    asset_id = %asset_id,
                    "failed to remove ocr asset metadata: task panicked"
                );
            }
        }
    }
}

fn persist_ocr_metadata(
    state: Arc<AppState>,
    context: &OcrContext,
    asset_id: Uuid,
    s3_key: &str,
    source: OcrSource,
) -> Result<(), String> {
    let tenant_id = context.document.tenant_id;
    let mut conn = state
        .db_for_tenant(tenant_id)
        .map_err(|err| format!("{err:?}"))?;

    let document_version_id = context.version.id;
    let existing_asset = context.existing_asset.as_ref().map(|asset| asset.id);

    if let Some(existing_asset) = existing_asset {
        diesel::delete(
            document_assets::table
                .filter(document_assets::id.eq(existing_asset))
                .filter(document_assets::tenant_id.eq(tenant_id)),
        )
        .execute(&mut *conn)
        .map_err(|err| format!("{err:?}"))?;
    }

    let metadata = json!({
        "source": source.to_string(),
        "generated_at": Utc::now().to_rfc3339(),
    });

    let new_asset = NewDocumentAsset {
        id: asset_id,
        document_version_id,
        asset_type: TEXT_CONTENT_ASSET_TYPE.to_string(),
        mime_type: "text/plain".to_string(),
        metadata,
        s3_key: s3_key.to_string(),
        tenant_id,
    };

    diesel::insert_into(document_assets::table)
        .values(&new_asset)
        .on_conflict((
            document_assets::document_version_id,
            document_assets::asset_type,
        ))
        .do_update()
        .set((
            document_assets::mime_type.eq(excluded(document_assets::mime_type)),
            document_assets::metadata.eq(excluded(document_assets::metadata)),
            document_assets::s3_key.eq(excluded(document_assets::s3_key)),
            document_assets::id.eq(excluded(document_assets::id)),
        ))
        .execute(&mut *conn)
        .map_err(|err| format!("{err:?}"))?;

    Ok(())
}

fn generate_ocr_text(meta: &PdfDocumentMeta, bytes: &[u8]) -> Option<OcrGeneration> {
    if !document_meta_is_pdf(meta) {
        return None;
    }

    if let Ok(text) = extract_pdf_text(bytes) {
        if text.trim().chars().count() >= MIN_TEXT_LENGTH {
            return Some(OcrGeneration {
                text,
                source: OcrSource::PdfText,
            });
        }
    }

    match run_ocr(bytes) {
        Ok(Some(text)) => Some(OcrGeneration {
            text,
            source: OcrSource::Ocr,
        }),
        Ok(None) => None,
        Err(OcrError::BinaryMissing) => {
            warn!("ocrmypdf binary not found; OCR unavailable");
            None
        }
        Err(err) => {
            warn!(error = %err, "ocr command failed");
            None
        }
    }
}

struct PdfDocumentMeta {
    mime_type: Option<String>,
    original_name: String,
}

struct OcrGeneration {
    text: String,
    source: OcrSource,
}

#[derive(Clone, Copy)]
enum OcrSource {
    PdfText,
    Ocr,
}

impl fmt::Display for OcrSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OcrSource::PdfText => write!(f, "pdf-text"),
            OcrSource::Ocr => write!(f, "ocr"),
        }
    }
}

#[derive(Debug)]
enum OcrError {
    BinaryMissing,
    Failed(String),
}

impl fmt::Display for OcrError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OcrError::BinaryMissing => write!(f, "ocrmypdf binary not found"),
            OcrError::Failed(msg) => write!(f, "ocr failed: {msg}"),
        }
    }
}

fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let pdfium = Pdfium::default();
    let document = pdfium
        .load_pdf_from_byte_slice(bytes, None)
        .map_err(|err| format!("load pdf: {err}"))?;

    let mut combined = String::new();
    let pages = document.pages();
    for page_index in 0..pages.len() {
        let page = pages
            .get(page_index)
            .map_err(|err| format!("load page {page_index}: {err}"))?;
        if let Ok(page_text) = page.text() {
            for segment in page_text.segments().iter() {
                combined.push_str(&segment.text());
                combined.push('\n');
            }
        };
    }

    Ok(combined)
}

fn run_ocr(bytes: &[u8]) -> Result<Option<String>, OcrError> {
    let mut input = NamedTempFile::new().map_err(|err| OcrError::Failed(err.to_string()))?;
    input
        .write_all(bytes)
        .map_err(|err| OcrError::Failed(err.to_string()))?;
    input
        .flush()
        .map_err(|err| OcrError::Failed(err.to_string()))?;

    let output_pdf = NamedTempFile::new().map_err(|err| OcrError::Failed(err.to_string()))?;
    let sidecar = NamedTempFile::new().map_err(|err| OcrError::Failed(err.to_string()))?;

    let status = Command::new("ocrmypdf")
        .arg("--sidecar")
        .arg(sidecar.path())
        .arg("--skip-text")
        .arg(input.path())
        .arg(output_pdf.path())
        .output();

    match status {
        Ok(output) => {
            if !output.status.success() {
                return Err(OcrError::Failed(format!(
                    "ocrmypdf failed: exit={} stderr={}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                )));
            }

            let text = fs::read_to_string(sidecar.path())
                .map_err(|err| OcrError::Failed(err.to_string()))?;
            if text.trim().chars().count() >= MIN_TEXT_LENGTH {
                Ok(Some(text))
            } else {
                Ok(None)
            }
        }
        Err(err) => {
            if err.kind() == ErrorKind::NotFound {
                Err(OcrError::BinaryMissing)
            } else {
                Err(OcrError::Failed(err.to_string()))
            }
        }
    }
}

fn document_meta_is_pdf(meta: &PdfDocumentMeta) -> bool {
    if let Some(mime_type) = &meta.mime_type {
        if mime_type.eq_ignore_ascii_case("application/pdf") {
            return true;
        }
    }

    meta.original_name
        .rsplit('.')
        .next()
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn document_is_pdf(document: &Document) -> bool {
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
