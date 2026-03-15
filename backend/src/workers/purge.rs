use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use diesel::prelude::*;
use diesel::result::Error as DieselError;
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::ensure_active_tenant;
use crate::jobs::JOB_PURGE_DOCUMENT;
use crate::models::{Document, DocumentVersion};
use crate::schema::{document_assets, document_versions};
use crate::state::AppState;
use crate::storage::TenantStorage;

use super::{
    job_execution_from_task_error,
    taskflow::{BoxedTask, Task, TaskContext, TaskError, TaskExecutor, TaskPlanner, TaskResult},
    JobExecution, JobHandler,
};

#[derive(Debug, Deserialize)]
struct PurgeDocumentPayload {
    document_id: Uuid,
}

#[derive(Debug)]
struct PurgeContext {
    document_id: Uuid,
    version_keys: Vec<String>,
    asset_keys: Vec<String>,
}

pub struct PurgeDocumentJob;

impl PurgeDocumentJob {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl JobHandler for PurgeDocumentJob {
    fn job_type(&self) -> &'static str {
        JOB_PURGE_DOCUMENT
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

        let payload: PurgeDocumentPayload = match serde_json::from_value(job.payload.clone()) {
            Ok(payload) => payload,
            Err(err) => {
                return JobExecution::Failed {
                    error: format!("invalid purge payload: {err}"),
                };
            }
        };

        let mut context = PurgeTaskContext::new(
            job.id,
            JOB_PURGE_DOCUMENT,
            tenant_id,
            payload.document_id,
            state.clone(),
            storage,
        );

        let planner = PurgePlanner;
        match TaskExecutor::run(&planner, &mut context).await {
            Ok(()) => JobExecution::Success,
            Err(err) => job_execution_from_task_error(err),
        }
    }
}

struct PurgeTaskContext {
    job_id: Uuid,
    job_type: &'static str,
    tenant_id: Uuid,
    document_id: Uuid,
    state: Arc<AppState>,
    storage: TenantStorage,
}

impl PurgeTaskContext {
    fn new(
        job_id: Uuid,
        job_type: &'static str,
        tenant_id: Uuid,
        document_id: Uuid,
        state: Arc<AppState>,
        storage: TenantStorage,
    ) -> Self {
        Self {
            job_id,
            job_type,
            tenant_id,
            document_id,
            state,
            storage,
        }
    }
}

impl TaskContext for PurgeTaskContext {
    fn job_id(&self) -> Uuid {
        self.job_id
    }

    fn job_type(&self) -> &'static str {
        self.job_type
    }
}

struct PurgePlanner;

#[async_trait]
impl TaskPlanner<PurgeTaskContext> for PurgePlanner {
    async fn plan(
        &self,
        _ctx: &mut PurgeTaskContext,
    ) -> TaskResult<Vec<BoxedTask<PurgeTaskContext>>> {
        Ok(vec![Box::new(PurgeTask)])
    }
}

struct PurgeTask;

#[async_trait]
impl Task<PurgeTaskContext> for PurgeTask {
    fn name(&self) -> &'static str {
        "purge-document"
    }

    async fn execute(&self, ctx: &mut PurgeTaskContext) -> TaskResult<()> {
        let tenant_id = ctx.tenant_id;
        let document_id = ctx.document_id;
        let state = ctx.state.clone();

        let preparation = tokio::task::spawn_blocking(move || {
            prepare_purge_context(state, tenant_id, document_id)
        })
        .await
        .map_err(|err| {
            TaskError::retry(
                Duration::from_secs(60),
                format!("purge preparation panicked: {err}"),
            )
        })?;

        let Some(context) =
            preparation.map_err(|err| TaskError::retry(Duration::from_secs(30), err))?
        else {
            return Ok(());
        };

        delete_storage_objects(&ctx.storage, &context)
            .await
            .map_err(|err| TaskError::retry(Duration::from_secs(30), err))?;

        let state = ctx.state.clone();
        tokio::task::spawn_blocking(move || finalize_purge(state, tenant_id, context.document_id))
            .await
            .map_err(|err| {
                TaskError::retry(
                    Duration::from_secs(60),
                    format!("purge finalize panicked: {err}"),
                )
            })?
            .map_err(|err| TaskError::retry(Duration::from_secs(30), err))?;

        Ok(())
    }
}

fn prepare_purge_context(
    state: Arc<AppState>,
    tenant_id: Uuid,
    document_id: Uuid,
) -> Result<Option<PurgeContext>, String> {
    let mut conn = state
        .db_for_tenant(tenant_id)
        .map_err(|err| format!("failed to scope tenant connection: {err:?}"))?;

    conn.scoped(|tx| {
        use crate::schema::documents::dsl as doc_dsl;

        let doc_opt = doc_dsl::documents
            .filter(doc_dsl::tenant_id.eq(tenant_id))
            .find(document_id)
            .for_update()
            .first::<Document>(tx)
            .optional()?;

        let Some(document) = doc_opt else {
            return Ok(None);
        };

        if document.deleted_at.is_none() {
            return Ok(None);
        }

        let versions: Vec<DocumentVersion> = document_versions::table
            .filter(document_versions::document_id.eq(document_id))
            .filter(document_versions::tenant_id.eq(tenant_id))
            .load(tx)?;

        let version_keys: Vec<String> = versions
            .iter()
            .map(|version| version.s3_key.clone())
            .collect();
        let version_ids: Vec<Uuid> = versions.iter().map(|version| version.id).collect();

        let asset_keys = if version_ids.is_empty() {
            Vec::new()
        } else {
            document_assets::table
                .filter(document_assets::document_version_id.eq_any(&version_ids))
                .filter(document_assets::tenant_id.eq(tenant_id))
                .select(document_assets::s3_key)
                .load(tx)?
        };

        Ok(Some(PurgeContext {
            document_id,
            version_keys,
            asset_keys,
        }))
    })
    .map_err(|err: DieselError| format!("failed to prepare purge: {err}"))
}

async fn delete_storage_objects(
    storage: &TenantStorage,
    context: &PurgeContext,
) -> Result<(), String> {
    let mut keys = HashSet::new();
    keys.extend(context.version_keys.iter().cloned());
    keys.extend(context.asset_keys.iter().cloned());

    for key in keys {
        if let Err(err) = storage.delete_object(&key).await {
            return Err(format!("failed to delete object {}: {err:?}", key));
        }
    }

    Ok(())
}

fn finalize_purge(state: Arc<AppState>, tenant_id: Uuid, document_id: Uuid) -> Result<(), String> {
    let mut conn = state
        .db_for_tenant(tenant_id)
        .map_err(|err| format!("failed to scope tenant connection: {err:?}"))?;

    conn.scoped(|tx| {
        use crate::schema::documents::dsl as doc_dsl;

        let doc_opt = doc_dsl::documents
            .filter(doc_dsl::tenant_id.eq(tenant_id))
            .find(document_id)
            .for_update()
            .first::<Document>(tx)
            .optional()?;

        let Some(document) = doc_opt else {
            return Ok(());
        };

        if document.deleted_at.is_none() {
            return Ok(());
        }

        diesel::delete(doc_dsl::documents.filter(doc_dsl::id.eq(document_id))).execute(tx)?;
        Ok(())
    })
    .map_err(|err: DieselError| format!("failed to finalize purge: {err}"))
}
