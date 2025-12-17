use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::Error as AnyhowError;
use async_trait::async_trait;
use tokio::time::sleep;
use tracing::{error, info, warn};

use crate::{
    jobs::{mark_job_failed, mark_job_succeeded, reserve_job, retry_job_after, JobQueueError},
    models::Job,
    state::AppState,
    storage::TenantStorage,
};
use taskflow::TaskError;

pub mod analyze;
pub mod common;
pub mod index;
pub mod issued_at;
pub mod ocr;
pub mod purge;
pub mod taskflow;
pub mod tenants;
pub mod thumbnails;

use tenants::{DeleteTenantJob, ProvisionTenantJob};

#[derive(Debug)]
pub enum JobExecution {
    Success,
    Retry { delay: Duration, error: String },
    Failed { error: String },
}

#[async_trait]
pub trait JobHandler: Send + Sync {
    fn job_type(&self) -> &'static str;
    async fn handle(&self, state: Arc<AppState>, job: Job, storage: TenantStorage) -> JobExecution;
}

pub struct Worker {
    state: Arc<AppState>,
    handlers: HashMap<&'static str, Arc<dyn JobHandler>>,
    poll_interval: Duration,
}

impl Worker {
    pub fn new(
        state: Arc<AppState>,
        handlers: Vec<Arc<dyn JobHandler>>,
        poll_interval: Duration,
    ) -> Self {
        let map = handlers
            .into_iter()
            .map(|handler| (handler.job_type(), handler))
            .collect();
        Self {
            state,
            handlers: map,
            poll_interval,
        }
    }

    pub async fn run(&self) {
        info!("worker started");
        loop {
            match self.tick().await {
                Ok(true) => {}
                Ok(false) => sleep(self.poll_interval).await,
                Err(err) => {
                    error!(error = %err, "worker tick failed");
                    sleep(self.poll_interval).await;
                }
            }
        }
    }

    async fn tick(&self) -> Result<bool, JobQueueError> {
        let job_types: Vec<&str> = self.handlers.keys().copied().collect();
        if job_types.is_empty() {
            return Ok(false);
        }

        let mut conn = match self.state.db_unscoped() {
            Ok(conn) => conn,
            Err(err) => {
                error!(?err, "failed to obtain database connection in worker");
                return Ok(false);
            }
        };

        let job_opt = reserve_job(&mut conn, &job_types)?;
        drop(conn);

        if let Some(job) = job_opt {
            let tenant_id = match job.tenant_id {
                Some(id) => id,
                None => {
                    warn!(job_id = %job.id, job_type = %job.job_type, "job detached from tenant; marking failed");
                    if let Ok(mut conn) = self.state.db_unscoped() {
                        let _ =
                            mark_job_failed(&mut conn, job.id, "job detached from tenant context");
                    }
                    return Ok(true);
                }
            };

            if let Some(handler) = self.handlers.get(job.job_type.as_str()) {
                let execution = match self.state.storage_for_tenant(tenant_id) {
                    Ok(storage) => {
                        handler
                            .handle(self.state.clone(), job.clone(), storage)
                            .await
                    }
                    Err(err) => {
                        error!(job_id = %job.id, error = ?err, "failed to load tenant storage for job");
                        JobExecution::Failed {
                            error: format!("tenant storage unavailable: {err:?}"),
                        }
                    }
                };
                match execution {
                    JobExecution::Success => {
                        if let Ok(mut conn) = self.state.db_unscoped() {
                            mark_job_succeeded(&mut conn, job.id)?;
                            info!(job_id = %job.id, job_type = %job.job_type, "job completed successfully");
                        } else {
                            error!("failed to mark job succeeded due to pool error");
                        }
                    }
                    JobExecution::Retry { delay, error } => {
                        warn!(job_id = %job.id, job_type = %job.job_type, %error, "job will retry");
                        if let Ok(mut conn) = self.state.db_unscoped() {
                            retry_job_after(&mut conn, job.id, delay, &error)?;
                        } else {
                            error!("failed to requeue job for retry due to pool error");
                        }
                    }
                    JobExecution::Failed { error } => {
                        error!(job_id = %job.id, job_type = %job.job_type, %error, "job failed");
                        if let Ok(mut conn) = self.state.db_unscoped() {
                            mark_job_failed(&mut conn, job.id, &error)?;
                        } else {
                            error!("failed to mark job failed due to pool error");
                        }
                    }
                }
            } else {
                error!(job_type = %job.job_type, "no handler registered for job type");
                if let Ok(mut conn) = self.state.db_unscoped() {
                    mark_job_failed(&mut conn, job.id, "no handler registered")?;
                } else {
                    error!("failed to mark job failed for missing handler due to pool error");
                }
            }
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

pub fn default_handlers() -> Vec<Arc<dyn JobHandler>> {
    vec![
        Arc::new(analyze::AnalyzeDocumentJob::new()),
        Arc::new(purge::PurgeDocumentJob::new()),
        Arc::new(ProvisionTenantJob::new()),
        Arc::new(DeleteTenantJob::new()),
    ]
}

pub(crate) fn job_execution_from_task_error(error: TaskError) -> JobExecution {
    match error {
        TaskError::Fail { error } => JobExecution::Failed { error },
        TaskError::Retry { delay, error } => JobExecution::Retry { delay, error },
    }
}

pub(crate) fn check_worker_document_limit(
    size_bytes: i64,
    limit_bytes: u64,
) -> Result<(), (u64, u64)> {
    let size = size_bytes.max(0) as u64;
    if size > limit_bytes {
        Err((size, limit_bytes))
    } else {
        Ok(())
    }
}

pub(crate) enum FetchVersionError {
    TooLarge { size: u64, limit: u64 },
    Storage(AnyhowError),
}

pub(crate) async fn fetch_version_object(
    version: &crate::models::DocumentVersion,
    storage: &TenantStorage,
    s3_key: &str,
    limit_bytes: u64,
) -> Result<Vec<u8>, FetchVersionError> {
    check_worker_document_limit(version.size_bytes, limit_bytes)
        .map_err(|(size, limit)| FetchVersionError::TooLarge { size, limit })?;

    storage
        .get_object(s3_key)
        .await
        .map_err(FetchVersionError::Storage)
}
