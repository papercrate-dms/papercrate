use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::task;
use uuid::Uuid;

use crate::models::{Document, DocumentVersion};
use crate::state::AppState;
use crate::storage::TenantStorage;
use crate::workers::common::{load_document_version, load_version_assets, LoadedAsset};
use crate::workers::{check_worker_document_limit, fetch_version_object, FetchVersionError};

use super::{TaskContext, TaskError, TaskResult};

const BLOCKING_RETRY_DELAY: Duration = Duration::from_secs(60);
const DEFAULT_RETRY_DELAY: Duration = Duration::from_secs(30);

pub struct DocumentVersionTaskContext {
    job_id: Uuid,
    job_type: &'static str,
    tenant_id: Uuid,
    document_id: Uuid,
    document_version_id: Uuid,
    force: bool,
    max_document_bytes: u64,
    state: Arc<AppState>,
    storage: TenantStorage,
    document: Option<Document>,
    version: Option<DocumentVersion>,
    assets: Option<HashMap<String, LoadedAsset>>, // keyed by asset_type
    object_bytes: Option<Vec<u8>>,
}

impl DocumentVersionTaskContext {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        job_id: Uuid,
        job_type: &'static str,
        tenant_id: Uuid,
        document_id: Uuid,
        document_version_id: Uuid,
        force: bool,
        max_document_bytes: u64,
        state: Arc<AppState>,
        storage: TenantStorage,
    ) -> Self {
        Self {
            job_id,
            job_type,
            tenant_id,
            document_id,
            document_version_id,
            force,
            max_document_bytes,
            state,
            storage,
            document: None,
            version: None,
            assets: None,
            object_bytes: None,
        }
    }

    pub fn tenant_id(&self) -> Uuid {
        self.tenant_id
    }

    pub fn document_id(&self) -> Uuid {
        self.document_id
    }

    pub fn version_id(&self) -> Uuid {
        self.document_version_id
    }

    pub fn force(&self) -> bool {
        self.force
    }

    pub fn storage(&self) -> &TenantStorage {
        &self.storage
    }

    pub fn invalidate_asset_cache(&mut self) {
        self.assets = None;
    }

    pub fn set_document_mime(&mut self, mime: Option<String>) {
        if let Some(document) = self.document.as_mut() {
            document.mime_type = mime;
        }
    }

    pub fn state(&self) -> &Arc<AppState> {
        &self.state
    }

    pub fn max_document_bytes(&self) -> u64 {
        self.max_document_bytes
    }

    pub async fn document(&mut self) -> TaskResult<&Document> {
        self.ensure_document_loaded().await?;
        Ok(self.document.as_ref().expect("document hydrated"))
    }

    pub async fn version(&mut self) -> TaskResult<&DocumentVersion> {
        self.ensure_document_loaded().await?;
        Ok(self.version.as_ref().expect("version hydrated"))
    }

    pub async fn assets(&mut self) -> TaskResult<&HashMap<String, LoadedAsset>> {
        if self.assets.is_none() {
            let tenant_id = self.tenant_id;
            let version_id = self.document_version_id;
            let state = self.state.clone();
            let result = task::spawn_blocking(move || {
                let mut conn = state
                    .db_for_tenant(tenant_id)
                    .map_err(|err| format!("failed to scope tenant connection: {err:?}"))?;
                load_version_assets(&mut conn, tenant_id, version_id, &[])
            })
            .await
            .map_err(|err| {
                TaskError::retry(
                    BLOCKING_RETRY_DELAY,
                    format!("asset load task panicked: {err}"),
                )
            })?
            .map_err(|err| TaskError::retry(DEFAULT_RETRY_DELAY, err))?;
            self.assets = Some(result);
        }
        Ok(self.assets.as_ref().expect("asset map hydrated"))
    }

    pub async fn asset(&mut self, asset_type: &str) -> TaskResult<Option<&LoadedAsset>> {
        let assets = self.assets().await?;
        Ok(assets.get(asset_type))
    }

    pub async fn buffered_object(&mut self) -> TaskResult<&[u8]> {
        if self.object_bytes.is_some() {
            return Ok(self.object_bytes.as_deref().expect("bytes present"));
        }
        let version = self.version().await?.clone();
        let bytes = fetch_version_object(
            &version,
            &self.storage,
            &version.s3_key,
            self.max_document_bytes,
        )
        .await
        .map_err(|err| match err {
            FetchVersionError::TooLarge { size, limit } => TaskError::fail(format!(
                "document size {size} bytes exceeds worker limit of {limit} bytes"
            )),
            FetchVersionError::Storage(err) => TaskError::retry(
                DEFAULT_RETRY_DELAY,
                format!("failed to fetch object: {err}"),
            ),
        })?;
        self.object_bytes = Some(bytes);
        Ok(self.object_bytes.as_deref().expect("bytes hydrated"))
    }

    pub async fn object_head(&mut self, max_bytes: usize) -> TaskResult<Vec<u8>> {
        let version = self.version().await?.clone();
        check_worker_document_limit(version.size_bytes, self.max_document_bytes).map_err(
            |(size, limit)| {
                TaskError::fail(format!(
                    "document size {size} bytes exceeds worker limit of {limit} bytes"
                ))
            },
        )?;

        let end = max_bytes.saturating_sub(1) as u64;
        self.storage
            .get_object_range(&version.s3_key, 0, Some(end))
            .await
            .map_err(|err| {
                TaskError::retry(
                    DEFAULT_RETRY_DELAY,
                    format!("failed to fetch ranged object: {err}"),
                )
            })
    }

    async fn ensure_document_loaded(&mut self) -> TaskResult<()> {
        if self.document.is_some() && self.version.is_some() {
            return Ok(());
        }

        let tenant_id = self.tenant_id;
        let document_id = self.document_id;
        let version_id = self.document_version_id;
        let state = self.state.clone();

        let loaded = task::spawn_blocking(move || {
            load_document_version(state.as_ref(), tenant_id, document_id, version_id)
        })
        .await
        .map_err(|err| {
            TaskError::retry(
                BLOCKING_RETRY_DELAY,
                format!("document load task panicked: {err}"),
            )
        })?
        .map_err(|err| TaskError::fail(format!("failed to load document context: {err}")))?;

        self.document = Some(loaded.document);
        self.version = Some(loaded.version);
        Ok(())
    }
}

impl TaskContext for DocumentVersionTaskContext {
    fn job_id(&self) -> Uuid {
        self.job_id
    }

    fn job_type(&self) -> &'static str {
        self.job_type
    }
}
