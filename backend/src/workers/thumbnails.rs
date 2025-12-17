use std::{convert::TryInto, io::Cursor, panic, process::Stdio, sync::Arc, time::Duration};

use async_trait::async_trait;
use chrono::Utc;
use diesel::{pg::upsert::excluded, prelude::*};
use image::{GenericImageView, ImageFormat, ImageReader};
use pdfium_render::prelude::*;
use serde::Deserialize;
use serde_json::{Map, Value};
use tokio::{process::Command, task, time::timeout};
use tracing::{info, warn};
use uuid::Uuid;

use crate::{
    documents::asset::delete_asset,
    error::AppResult,
    models::{Document, DocumentAsset, DocumentVersion, NewDocumentAsset},
    schema::{document_assets, document_versions},
    state::AppState,
    utils::storage_paths::document_asset_key,
    workers::check_worker_document_limit,
};

use super::{
    analyze::determine_thumbnail_support,
    taskflow::{document::DocumentVersionTaskContext, Task, TaskContext, TaskError, TaskResult},
};

pub const THUMBNAIL_WIDTH: u32 = 512;
pub const THUMBNAIL_HEIGHT: u32 = 512;
const RENDER_WIDTH: u32 = THUMBNAIL_WIDTH * 4;
const RENDER_HEIGHT: u32 = THUMBNAIL_HEIGHT * 4;
const VIDEO_PRESIGN_TTL: Duration = Duration::from_secs(300);
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(30);
pub const THUMBNAIL_ASSET_TYPE: &str = "thumbnail";

pub struct GenerateThumbnailsTask {
    force: bool,
}

impl GenerateThumbnailsTask {
    pub fn new(force: bool) -> Self {
        Self { force }
    }
}

#[async_trait]
impl Task<DocumentVersionTaskContext> for GenerateThumbnailsTask {
    fn name(&self) -> &'static str {
        "generate-thumbnails"
    }

    async fn execute(&self, ctx: &mut DocumentVersionTaskContext) -> TaskResult<()> {
        let context = build_thumbnail_context(ctx, self.force).await?;

        if context.skip {
            info!(job_id = %ctx.job_id(), "thumbnails already exist; skipping");
            return Ok(());
        }

        let generation = if document_is_video(&context.document) {
            generate_video_thumbnail(ctx, &context).await?
        } else {
            let bytes = ctx.buffered_object().await?;
            generate_thumbnails(&context.document, bytes).map_err(TaskError::fail)?
        };

        if let Some(page_count) = generation.page_count {
            let state = ctx.state().clone();
            let tenant_id = context.tenant_id;
            let document_id = context.document.id;
            let version_id = context.version.id;
            task::spawn_blocking(move || {
                persist_document_page_count(state, tenant_id, document_id, version_id, page_count)
            })
            .await
            .map_err(|err| {
                TaskError::retry(
                    Duration::from_secs(60),
                    format!("page count task panicked: {err}"),
                )
            })?
            .map_err(|err| TaskError::retry(Duration::from_secs(30), err))?;
        }

        remove_existing_thumbnail_assets(ctx, &context).await;

        let thumbnail_asset_id = Uuid::new_v4();

        let thumbnail_persistence = upload_generated_asset(
            ctx,
            &context,
            THUMBNAIL_ASSET_TYPE,
            thumbnail_asset_id,
            &generation.thumbnail,
        )
        .await?;

        let asset_persistences = vec![thumbnail_persistence];

        let state = ctx.state().clone();
        let tenant_id = context.document.tenant_id;
        let version_id = context.version.id;
        task::spawn_blocking(move || {
            persist_assets_metadata(state, tenant_id, version_id, &asset_persistences)
        })
        .await
        .map_err(|err| {
            TaskError::retry(
                Duration::from_secs(60),
                format!("thumbnail metadata task panicked: {err}"),
            )
        })?
        .map_err(|err| TaskError::retry(Duration::from_secs(30), err))?;

        ctx.invalidate_asset_cache();
        Ok(())
    }
}

async fn build_thumbnail_context(
    ctx: &mut DocumentVersionTaskContext,
    force: bool,
) -> TaskResult<ThumbnailContext> {
    let document = ctx.document().await?.clone();
    let version = ctx.version().await?.clone();
    let tenant_id = ctx.tenant_id();

    let (supported, _) = determine_thumbnail_support(&document);
    if !supported {
        return Ok(ThumbnailContext {
            document,
            version,
            existing_thumbnail: None,
            skip: true,
            tenant_id,
        });
    }

    let assets = ctx.assets().await?;
    let existing_thumbnail = assets
        .get(THUMBNAIL_ASSET_TYPE)
        .map(|entry| entry.asset.clone());

    let skip = existing_thumbnail.is_some() && !force;

    Ok(ThumbnailContext {
        document,
        version,
        existing_thumbnail,
        skip,
        tenant_id,
    })
}

async fn remove_existing_thumbnail_assets(
    ctx: &DocumentVersionTaskContext,
    context: &ThumbnailContext,
) {
    if let Some(existing_thumbnail) = &context.existing_thumbnail {
        delete_asset_object(ctx, existing_thumbnail).await;
    }
}

async fn delete_asset_object(ctx: &DocumentVersionTaskContext, asset: &DocumentAsset) {
    if let Err(err) = ctx.storage().delete_object(&asset.s3_key).await {
        warn!(
            job_id = %ctx.job_id(),
            error = %err,
            s3_key = %asset.s3_key,
            "failed to delete existing asset object"
        );
    }

    let tenant_id = ctx.tenant_id();
    let asset_id = asset.id;
    let state = ctx.state().clone();
    match task::spawn_blocking(move || -> AppResult<()> {
        let mut conn = state.db_for_tenant(tenant_id)?;
        delete_asset(&mut conn, tenant_id, asset_id)
    })
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            warn!(
                job_id = %ctx.job_id(),
                asset_id = %asset_id,
                error = ?err,
                "failed to delete asset metadata"
            );
        }
        Err(join_err) => {
            warn!(
                job_id = %ctx.job_id(),
                asset_id = %asset_id,
                error = %join_err,
                "failed to delete asset metadata task panicked"
            );
        }
    }
}

async fn upload_generated_asset(
    ctx: &DocumentVersionTaskContext,
    context: &ThumbnailContext,
    asset_type: &str,
    asset_id: Uuid,
    asset: &GeneratedAsset,
) -> TaskResult<AssetPersistence> {
    let image = &asset.image;

    let s3_key = document_asset_key(
        context.document.id,
        context.version.version_number,
        asset_type,
        asset_id,
    );

    ctx.storage()
        .put_object(
            &s3_key,
            image.image_bytes.clone(),
            Some("image/webp".into()),
            None,
        )
        .await
        .map_err(|err| TaskError::retry(Duration::from_secs(30), err.to_string()))?;

    Ok(AssetPersistence {
        asset_type: asset_type.to_string(),
        asset_id,
        s3_key,
        width: image.width,
        height: image.height,
    })
}

struct ThumbnailContext {
    document: Document,
    version: DocumentVersion,
    existing_thumbnail: Option<DocumentAsset>,
    skip: bool,
    tenant_id: Uuid,
}

struct GeneratedImage {
    image_bytes: Vec<u8>,
    width: Option<i32>,
    height: Option<i32>,
}

struct GeneratedAsset {
    image: GeneratedImage,
}

struct GeneratedAssets {
    thumbnail: GeneratedAsset,
    page_count: Option<u32>,
}

struct AssetPersistence {
    asset_type: String,
    asset_id: Uuid,
    s3_key: String,
    width: Option<i32>,
    height: Option<i32>,
}

fn generate_thumbnails(document: &Document, bytes: &[u8]) -> Result<GeneratedAssets, String> {
    if document_is_pdf(document) {
        let pdf_assets = generate_pdf_assets(bytes)?;
        Ok(GeneratedAssets {
            thumbnail: pdf_assets.thumbnail,
            page_count: Some(pdf_assets.page_count),
        })
    } else {
        let thumbnail = generate_image_assets(bytes)?;
        Ok(GeneratedAssets {
            thumbnail,
            page_count: None,
        })
    }
}

async fn generate_video_thumbnail(
    ctx: &DocumentVersionTaskContext,
    context: &ThumbnailContext,
) -> TaskResult<GeneratedAssets> {
    if let Err((size, limit)) =
        check_worker_document_limit(context.version.size_bytes, ctx.max_document_bytes())
    {
        return Err(TaskError::fail(format!(
            "document size {size} bytes exceeds worker limit of {limit} bytes"
        )));
    }

    let presigned_url = ctx
        .storage()
        .presign_get_object(&context.version.s3_key, VIDEO_PRESIGN_TTL, None)
        .await
        .map_err(|err| {
            TaskError::retry(
                Duration::from_secs(30),
                format!("failed to presign video for thumbnail: {err}"),
            )
        })?;

    let probe = probe_video_metadata(&presigned_url)
        .await
        .map_err(TaskError::fail)?;
    let timestamp = pick_thumbnail_timestamp(probe.duration);

    let frame_bytes = extract_video_frame(&presigned_url, timestamp)
        .await
        .map_err(TaskError::fail)?;

    let thumbnail = generate_image_assets(&frame_bytes).map_err(TaskError::fail)?;

    Ok(GeneratedAssets {
        thumbnail,
        page_count: None,
    })
}

fn generate_image_assets(bytes: &[u8]) -> Result<GeneratedAsset, String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|err| err.to_string())?;
    let image = reader.decode().map_err(|err| err.to_string())?;

    let render_image = if image.width() > RENDER_WIDTH || image.height() > RENDER_HEIGHT {
        image.thumbnail(RENDER_WIDTH, RENDER_HEIGHT)
    } else {
        image.clone()
    };

    let thumbnail_image =
        if render_image.width() > THUMBNAIL_WIDTH || render_image.height() > THUMBNAIL_HEIGHT {
            render_image.thumbnail(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
        } else {
            render_image.clone()
        };

    let thumbnail = encode_dynamic_image(thumbnail_image)?;

    Ok(GeneratedAsset { image: thumbnail })
}

struct PdfGeneratedAssets {
    thumbnail: GeneratedAsset,
    page_count: u32,
}

fn generate_pdf_assets(bytes: &[u8]) -> Result<PdfGeneratedAssets, String> {
    let pdfium = panic::catch_unwind(|| Pdfium::default())
        .map_err(|_| "failed to initialize PDFium".to_string())?;

    let document = pdfium
        .load_pdf_from_byte_slice(bytes, None)
        .map_err(|err| format!("load pdf: {err}"))?;

    let pages = document.pages();
    let total_pages = pages.len() as usize;
    if total_pages == 0 {
        return Err("pdf has no pages".to_string());
    }

    let render_config = PdfRenderConfig::new()
        .set_target_width(RENDER_WIDTH as i32)
        .set_maximum_height(RENDER_HEIGHT as i32)
        .render_form_data(true)
        .rotate_if_landscape(PdfPageRenderRotation::None, true);

    let first_page = pages.get(0).map_err(|err| format!("load page 0: {err}"))?;

    let bitmap = first_page
        .render_with_config(&render_config)
        .map_err(|err| format!("render pdf page 0: {err}"))?;

    let render_buffer = bitmap.as_image().to_rgb8();
    let render_image = image::DynamicImage::ImageRgb8(render_buffer);

    let thumbnail_image =
        if render_image.width() > THUMBNAIL_WIDTH || render_image.height() > THUMBNAIL_HEIGHT {
            render_image.thumbnail(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT)
        } else {
            render_image.clone()
        };

    let page_count: u32 = total_pages
        .try_into()
        .map_err(|_| "page count exceeds supported range".to_string())?;

    Ok(PdfGeneratedAssets {
        thumbnail: GeneratedAsset {
            image: encode_dynamic_image(thumbnail_image)?,
        },
        page_count,
    })
}

#[derive(Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

struct VideoProbe {
    duration: Option<f64>,
}

async fn probe_video_metadata(url: &str) -> Result<VideoProbe, String> {
    let mut cmd = Command::new("ffprobe");
    cmd.arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("json")
        .arg(url)
        .stdout(Stdio::piped());

    let output = timeout(FFMPEG_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "ffprobe timed out".to_string())?
        .map_err(|err| format!("ffprobe failed to start: {err}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("failed to parse ffprobe output: {err}"))?;

    let duration = parsed
        .format
        .and_then(|format| format.duration)
        .and_then(|dur| dur.parse::<f64>().ok());

    Ok(VideoProbe { duration })
}

fn pick_thumbnail_timestamp(duration: Option<f64>) -> f64 {
    if let Some(duration) = duration {
        if duration.is_finite() && duration > 0.0 {
            let target = duration * 0.2;
            let end = (duration - 1.0).max(0.0);
            return target.max(2.0).min(end).max(0.0);
        }
    }
    2.0
}

async fn extract_video_frame(url: &str, timestamp_secs: f64) -> Result<Vec<u8>, String> {
    let timestamp_arg = format!("{timestamp_secs:.3}");

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-ss")
        .arg(timestamp_arg)
        .arg("-i")
        .arg(url)
        .arg("-frames:v")
        .arg("1")
        .arg("-f")
        .arg("image2pipe")
        .arg("-vcodec")
        .arg("png")
        .arg("-")
        .stdout(Stdio::piped());

    let output = timeout(FFMPEG_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "ffmpeg timed out".to_string())?
        .map_err(|err| format!("ffmpeg failed to start: {err}"))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    if output.stdout.is_empty() {
        return Err("ffmpeg produced no frame data".to_string());
    }

    Ok(output.stdout)
}

fn encode_dynamic_image(image: image::DynamicImage) -> Result<GeneratedImage, String> {
    let (width, height) = image.dimensions();
    let mut cursor = Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, ImageFormat::WebP)
        .map_err(|err| err.to_string())?;
    Ok(GeneratedImage {
        image_bytes: cursor.into_inner(),
        width: Some(width as i32),
        height: Some(height as i32),
    })
}

fn persist_assets_metadata(
    state: Arc<AppState>,
    tenant_id: Uuid,
    version_id: Uuid,
    assets: &[AssetPersistence],
) -> Result<(), String> {
    let mut conn = state
        .db_for_tenant(tenant_id)
        .map_err(|err| format!("{err:?}"))?;

    for asset in assets {
        let mut metadata_map = Map::new();
        if let Some(width) = asset.width {
            metadata_map.insert("width".to_string(), Value::from(width));
        }
        if let Some(height) = asset.height {
            metadata_map.insert("height".to_string(), Value::from(height));
        }
        metadata_map.insert(
            "generated_at".to_string(),
            Value::from(Utc::now().to_rfc3339()),
        );

        let new_asset = NewDocumentAsset {
            id: asset.asset_id,
            document_version_id: version_id,
            asset_type: asset.asset_type.clone(),
            mime_type: "image/webp".to_string(),
            metadata: Value::Object(metadata_map),
            s3_key: asset.s3_key.clone(),
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
            ))
            .execute(&mut conn)
            .map_err(|err| format!("{err:?}"))?;
    }

    Ok(())
}

fn persist_document_page_count(
    state: Arc<AppState>,
    tenant_id: Uuid,
    document_id: Uuid,
    document_version_id: Uuid,
    page_count: u32,
) -> Result<(), String> {
    let mut conn = state
        .db_for_tenant(tenant_id)
        .map_err(|err| format!("{err:?}"))?;

    let existing_metadata: Value = document_versions::table
        .filter(document_versions::id.eq(document_version_id))
        .filter(document_versions::document_id.eq(document_id))
        .filter(document_versions::tenant_id.eq(tenant_id))
        .select(document_versions::metadata)
        .first(&mut conn)
        .map_err(|err| format!("{err:?}"))?;

    let updated = match existing_metadata {
        Value::Object(mut map) => {
            map.insert("page_count".to_string(), Value::from(page_count));
            Value::Object(map)
        }
        _ => {
            let mut map = Map::new();
            map.insert("page_count".to_string(), Value::from(page_count));
            Value::Object(map)
        }
    };

    diesel::update(
        document_versions::table
            .filter(document_versions::id.eq(document_version_id))
            .filter(document_versions::document_id.eq(document_id))
            .filter(document_versions::tenant_id.eq(tenant_id)),
    )
    .set(document_versions::metadata.eq(updated))
    .execute(&mut conn)
    .map_err(|err| format!("{err:?}"))?;

    Ok(())
}

fn document_is_video(document: &Document) -> bool {
    const VIDEO_MIME_TYPES: [&str; 6] = [
        "video/mp4",
        "video/quicktime",
        "video/webm",
        "video/x-msvideo",
        "video/x-ms-wmv",
        "video/x-matroska",
    ];
    if let Some(mime) = document.mime_type.as_deref() {
        if VIDEO_MIME_TYPES
            .iter()
            .any(|candidate| mime.eq_ignore_ascii_case(candidate))
        {
            return true;
        }
    }

    false
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
