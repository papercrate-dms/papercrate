use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use diesel::prelude::*;
use diesel::sql_types::Jsonb;
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use tracing::warn;
use uuid::Uuid;

use sha2::Sha256;

use crate::auth::capability_sets::{
    ensure_capability_set, owner_capabilities, readonly_capabilities, user_capabilities,
    webdav_capabilities,
};
use crate::error::AppError;
use crate::documents::search::{delete_quickwit_index, ensure_quickwit_index};
use crate::jobs::{JOB_DELETE_TENANT, JOB_PROVISION_TENANT};
use crate::models::{NewUserMembership, Tenant, TenantStatus};
use crate::schema::{
    api_tokens, correspondents, document_assets, document_correspondents, document_tags,
    document_versions, documents, folders, tags, tenants, user_memberships, user_sessions,
};
use crate::state::AppState;
use crate::tenants::TenantRepository;
use crate::workers::{
    job_execution_from_task_error,
    taskflow::{BoxedTask, Task, TaskContext, TaskError, TaskExecutor, TaskPlanner, TaskResult},
    JobExecution, JobHandler,
};

type HmacSha256 = Hmac<Sha256>;
const DELETE_PROOF_TTL_SECONDS: i64 = 300;
const DELETE_PROOF_VERSION: &str = "v1";

pub struct ProvisionTenantJob;

impl ProvisionTenantJob {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl JobHandler for ProvisionTenantJob {
    fn job_type(&self) -> &'static str {
        JOB_PROVISION_TENANT
    }

    async fn handle(
        &self,
        state: Arc<AppState>,
        job: crate::models::Job,
        _storage: crate::storage::TenantStorage,
    ) -> JobExecution {
        let tenant_id = match job.tenant_id {
            Some(id) => id,
            None => {
                return JobExecution::Failed {
                    error: "provision job is missing tenant context".to_string(),
                }
            }
        };

        let members = ProvisionPayload::from_job(&job).unwrap_or_default();
        let mut context = ProvisionContext::new(
            job.id,
            JOB_PROVISION_TENANT,
            tenant_id,
            state.clone(),
            members,
        );

        let planner = ProvisionPlanner;
        match TaskExecutor::run(&planner, &mut context).await {
            Ok(()) => JobExecution::Success,
            Err(err) => job_execution_from_task_error(err),
        }
    }
}

struct ProvisionContext {
    job_id: Uuid,
    job_type: &'static str,
    tenant_id: Uuid,
    state: Arc<AppState>,
    members: Vec<Uuid>,
}

impl ProvisionContext {
    fn new(
        job_id: Uuid,
        job_type: &'static str,
        tenant_id: Uuid,
        state: Arc<AppState>,
        members: Vec<Uuid>,
    ) -> Self {
        Self {
            job_id,
            job_type,
            tenant_id,
            state,
            members,
        }
    }
}

impl TaskContext for ProvisionContext {
    fn job_id(&self) -> Uuid {
        self.job_id
    }

    fn job_type(&self) -> &'static str {
        self.job_type
    }
}

struct ProvisionPlanner;

#[async_trait]
impl TaskPlanner<ProvisionContext> for ProvisionPlanner {
    async fn plan(
        &self,
        _ctx: &mut ProvisionContext,
    ) -> TaskResult<Vec<BoxedTask<ProvisionContext>>> {
        Ok(vec![Box::new(ProvisionTask)])
    }
}

struct ProvisionTask;

#[async_trait]
impl Task<ProvisionContext> for ProvisionTask {
    fn name(&self) -> &'static str {
        "provision-tenant"
    }

    async fn execute(&self, ctx: &mut ProvisionContext) -> TaskResult<()> {
        let mut conn = ctx
            .state
            .db_unscoped()
            .map_err(|err| TaskError::retry(Duration::from_secs(30), format!("{err:?}")))?;

        let tenant = TenantRepository::get_by_id(&mut conn, ctx.tenant_id).map_err(|err| {
            TaskError::fail(format!("tenant not found for provisioning: {err:?}"))
        })?;
        drop(conn);

        let mut conn = ctx
            .state
            .db_for_tenant(tenant.id)
            .map_err(|err| TaskError::retry(Duration::from_secs(30), format!("{err:?}")))?;

        if tenant.status == TenantStatus::Active {
            warn!(
                job_id = %ctx.job_id(),
                tenant_id = %tenant.id,
                "tenant already active; skipping provisioning"
            );
            return Ok(());
        }

        if tenant.status != TenantStatus::Creating {
            return Err(TaskError::fail(format!(
                "tenant status '{}' not eligible for provisioning",
                tenant.status.as_str()
            )));
        }

        let endpoint = ctx
            .state
            .config
            .quickwit_endpoint
            .as_ref()
            .map(|value| value.trim_end_matches('/').to_owned())
            .ok_or_else(|| {
                TaskError::retry(Duration::from_secs(30), "quickwit endpoint not configured")
            })?;

        let index_id = tenant
            .quickwit_index
            .as_deref()
            .map(str::to_owned)
            .unwrap_or_else(|| format!("documents-{}", tenant.id));

        let client = Client::new();
        ensure_quickwit_index(&client, &endpoint, &index_id)
            .await
            .map_err(|err| TaskError::retry(Duration::from_secs(30), err.to_string()))?;

        let members = ctx.members.clone();
        let job_id = ctx.job_id();
        let tenant_id = tenant.id;

        conn.scoped(|tx| -> Result<(), AppError> {
            let owner_capability_set_id =
                ensure_capability_set(tx, tenant_id, owner_capabilities())?.id;

            ensure_capability_set(tx, tenant_id, user_capabilities())?;
            ensure_capability_set(tx, tenant_id, readonly_capabilities())?;
            ensure_capability_set(tx, tenant_id, webdav_capabilities())?;

            for member in &members {
                let new_membership = NewUserMembership {
                    id: Uuid::new_v4(),
                    user_id: *member,
                    tenant_id,
                    capability_set_id: Some(owner_capability_set_id),
                };

                if let Err(err) = diesel::insert_into(user_memberships::table)
                    .values(&new_membership)
                    .on_conflict((user_memberships::user_id, user_memberships::tenant_id))
                    .do_nothing()
                    .execute(tx)
                {
                    warn!(
                        job_id = %job_id,
                        tenant_id = %tenant_id,
                        user_id = %member,
                        error = %err,
                        "failed to assign initial membership"
                    );
                }
            }

            diesel::update(tenants::table.find(tenant_id))
                .set((
                    tenants::status.eq(TenantStatus::Active),
                    tenants::quickwit_index.eq(Some(&index_id)),
                    tenants::updated_at.eq(Utc::now().naive_utc()),
                ))
                .execute(tx)?;

            Ok(())
        })
        .map_err(|err| {
            TaskError::retry(
                Duration::from_secs(30),
                format!("provisioning failed: {err}"),
            )
        })?;

        Ok(())
    }
}

async fn delete_tenant(
    state: &Arc<AppState>,
    storage: crate::storage::TenantStorage,
    tenant_id: Uuid,
    current_job_id: Uuid,
    payload: &DeleteTenantPayload,
) -> Result<(), String> {
    let remove_tenant = payload.remove_tenant;
    let tenant = {
        let mut conn = state
            .db_unscoped()
            .map_err(|err| format!("failed to get db connection: {err:?}"))?;
        TenantRepository::get_by_id(&mut conn, tenant_id)
            .map_err(|err| format!("tenant lookup failed: {err:?}"))?
    };

    if tenant.name != payload.tenant_name {
        return Err(format!(
            "tenant name mismatch: expected '{}', got '{}'",
            payload.tenant_name, tenant.name
        ));
    }

    if tenant.status != TenantStatus::Deleting {
        return Err(format!(
            "tenant status '{}' not eligible for deletion",
            tenant.status.as_str()
        ));
    }

    match (payload_action_applicable(remove_tenant), payload.action) {
        (DeleteAction::Delete, DeleteAction::Delete)
        | (DeleteAction::Reset, DeleteAction::Reset) => {}
        _ => {
            return Err("delete payload action mismatch".into());
        }
    }

    let issued_at = DateTime::parse_from_rfc3339(&payload.issued_at)
        .map_err(|_| "invalid issued_at timestamp".to_string())?
        .with_timezone(&Utc);
    if (Utc::now() - issued_at).num_seconds().abs() > DELETE_PROOF_TTL_SECONDS {
        return Err("delete confirmation expired".into());
    }

    let resolved_final_status = if remove_tenant {
        None
    } else {
        Some(payload.final_status.unwrap_or(FinalTenantStatus::Suspended))
    };
    let final_status_str = resolved_final_status.map(|s| s.as_str());

    let message = build_delete_proof_message(
        tenant_id,
        &tenant.name,
        payload.action,
        &payload.nonce,
        &payload.issued_at,
        final_status_str,
    );

    verify_delete_proof(&state.config.jwt_secret, &message, &payload.signature)?;

    let object_keys = {
        let mut conn = state
            .db_for_tenant(tenant_id)
            .map_err(|err| format!("failed to scope tenant connection: {err:?}"))?;
        conn.scoped(|tx| collect_object_keys(tx))
            .map_err(|err| format!("failed to collect storage keys: {err}"))?
    };

    delete_storage_objects(&storage, &object_keys)
        .await
        .map_err(|err| format!("failed to delete storage objects: {err}"))?;

    reset_quickwit_index(state, &tenant, remove_tenant)
        .await
        .map_err(|err| format!("quickwit cleanup failed: {err}"))?;

    {
        let mut conn = state
            .db_for_tenant(tenant_id)
            .map_err(|err| format!("failed to scope tenant connection: {err:?}"))?;
        conn.scoped(|tx| delete_tenant_rows(tx, tenant_id, remove_tenant))
            .map_err(|err| format!("tenant data cleanup failed: {err}"))?;
    }

    {
        let mut conn = state
            .db_unscoped()
            .map_err(|err| format!("failed to get db connection: {err:?}"))?;

        let detach_result = json!({
            "tenant": {
                "id": tenant.id,
                "name": tenant.name,
            },
            "action": payload.action.as_str(),
            "remove_tenant": remove_tenant,
            "final_status": final_status_str,
            "timestamp": Utc::now().to_rfc3339(),
        });

        diesel::sql_query(
            "UPDATE jobs \
             SET tenant_id = NULL, \
                 result = jsonb_set(COALESCE(result, '{}'::jsonb), '{detached_tenant}', $3::jsonb, true) \
             WHERE tenant_id = $1 AND id <> $2",
        )
        .bind::<diesel::sql_types::Uuid, _>(tenant_id)
        .bind::<diesel::sql_types::Uuid, _>(current_job_id)
        .bind::<Jsonb, _>(detach_result)
        .execute(&mut *conn)
        .map_err(|err| format!("failed to detach tenant jobs: {err}"))?;

        if remove_tenant {
            diesel::delete(tenants::table.find(tenant_id))
                .execute(&mut *conn)
                .map_err(|err| format!("failed to delete tenant row: {err}"))?;
        } else {
            let new_status = match resolved_final_status.unwrap_or(FinalTenantStatus::Suspended) {
                FinalTenantStatus::Active => TenantStatus::Active,
                FinalTenantStatus::Suspended => TenantStatus::Suspended,
            };
            diesel::update(tenants::table.find(tenant_id))
                .set((
                    tenants::status.eq(new_status),
                    tenants::updated_at.eq(Utc::now().naive_utc()),
                ))
                .execute(&mut *conn)
                .map_err(|err| format!("failed to update tenant status: {err}"))?;
        }
    }

    Ok(())
}

struct TenantObjectKeys {
    version_keys: Vec<String>,
    asset_keys: Vec<String>,
}

fn collect_object_keys(conn: &mut PgConnection) -> Result<TenantObjectKeys, diesel::result::Error> {
    let version_keys = document_versions::table
        .select(document_versions::s3_key)
        .load::<String>(conn)?;
    let asset_keys = document_assets::table
        .select(document_assets::s3_key)
        .load::<String>(conn)?;

    Ok(TenantObjectKeys {
        version_keys,
        asset_keys,
    })
}

async fn delete_storage_objects(
    storage: &crate::storage::TenantStorage,
    keys: &TenantObjectKeys,
) -> Result<(), String> {
    for key in keys.version_keys.iter().chain(keys.asset_keys.iter()) {
        storage
            .delete_object(key)
            .await
            .map_err(|err| format!("failed to delete object '{key}': {err}"))?;
    }
    Ok(())
}

async fn reset_quickwit_index(
    state: &Arc<AppState>,
    tenant: &Tenant,
    remove_index: bool,
) -> Result<(), String> {
    let endpoint = match state.config.quickwit_endpoint.as_ref() {
        Some(endpoint) => endpoint,
        None => return Ok(()),
    };

    let index_id = match tenant.quickwit_index.as_deref() {
        Some(index) => index,
        None => return Ok(()),
    };

    let client = Client::new();
    delete_quickwit_index(&client, endpoint, index_id)
        .await
        .map_err(|err| format!("quickwit delete failed: {err}"))?;

    if !remove_index {
        ensure_quickwit_index(&client, endpoint, index_id)
            .await
            .map_err(|err| format!("quickwit ensure failed: {err}"))?;
    }

    Ok(())
}

fn delete_tenant_rows(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    remove_memberships: bool,
) -> Result<(), diesel::result::Error> {
    conn.transaction(|conn| {
        diesel::delete(document_assets::table.filter(document_assets::tenant_id.eq(tenant_id)))
            .execute(conn)?;
        diesel::delete(
            document_correspondents::table.filter(document_correspondents::tenant_id.eq(tenant_id)),
        )
        .execute(conn)?;
        diesel::delete(document_tags::table.filter(document_tags::tenant_id.eq(tenant_id)))
            .execute(conn)?;
        diesel::delete(document_versions::table.filter(document_versions::tenant_id.eq(tenant_id)))
            .execute(conn)?;
        diesel::delete(documents::table.filter(documents::tenant_id.eq(tenant_id)))
            .execute(conn)?;
        diesel::delete(folders::table.filter(folders::tenant_id.eq(tenant_id))).execute(conn)?;
        diesel::delete(correspondents::table.filter(correspondents::tenant_id.eq(tenant_id)))
            .execute(conn)?;
        diesel::delete(tags::table.filter(tags::tenant_id.eq(tenant_id))).execute(conn)?;
        diesel::delete(user_sessions::table.filter(user_sessions::tenant_id.eq(tenant_id)))
            .execute(conn)?;
        diesel::delete(api_tokens::table.filter(api_tokens::tenant_id.eq(tenant_id)))
            .execute(conn)?;
        if remove_memberships {
            diesel::delete(
                user_memberships::table.filter(user_memberships::tenant_id.eq(tenant_id)),
            )
            .execute(conn)?;
        }
        Ok(())
    })
}

#[derive(Deserialize, Default)]
struct ProvisionPayload {
    #[serde(default)]
    members: Vec<Uuid>,
}

impl ProvisionPayload {
    fn from_job(job: &crate::models::Job) -> Option<Vec<Uuid>> {
        serde_json::from_value(job.payload.clone())
            .map(|payload: ProvisionPayload| payload.members)
            .ok()
    }
}
pub struct DeleteTenantJob;

impl DeleteTenantJob {
    pub fn new() -> Self {
        Self
    }
}

pub fn build_delete_proof_message(
    tenant_id: Uuid,
    tenant_name: &str,
    action: DeleteAction,
    nonce: &str,
    issued_at: &str,
    final_status: Option<&str>,
) -> String {
    let status = final_status.unwrap_or("none");
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        DELETE_PROOF_VERSION,
        tenant_id,
        tenant_name,
        action.as_str(),
        nonce,
        issued_at,
        status
    )
}

pub fn sign_delete_proof(secret: &str, message: &str) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|err| format!("failed to init hmac: {err}"))?;
    mac.update(message.as_bytes());
    let bytes = mac.finalize().into_bytes();
    Ok(hex::encode(bytes))
}

fn verify_delete_proof(secret: &str, message: &str, signature: &str) -> Result<(), String> {
    let signature_bytes = hex::decode(signature)
        .map_err(|_| "invalid delete proof signature encoding".to_string())?;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|err| format!("failed to init hmac: {err}"))?;
    mac.update(message.as_bytes());
    mac.verify_slice(&signature_bytes)
        .map_err(|_| "delete proof signature mismatch".to_string())
}

#[derive(Debug, Deserialize)]
struct DeleteTenantPayload {
    #[serde(default)]
    remove_tenant: bool,
    #[serde(default)]
    final_status: Option<FinalTenantStatus>,
    tenant_name: String,
    action: DeleteAction,
    nonce: String,
    issued_at: String,
    signature: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum FinalTenantStatus {
    Active,
    Suspended,
}

impl FinalTenantStatus {
    fn as_str(&self) -> &'static str {
        match self {
            FinalTenantStatus::Active => "active",
            FinalTenantStatus::Suspended => "suspended",
        }
    }
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeleteAction {
    Delete,
    Reset,
}

impl DeleteAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeleteAction::Delete => "delete",
            DeleteAction::Reset => "reset",
        }
    }
}

fn payload_action_applicable(remove_tenant: bool) -> DeleteAction {
    if remove_tenant {
        DeleteAction::Delete
    } else {
        DeleteAction::Reset
    }
}

#[async_trait]
impl JobHandler for DeleteTenantJob {
    fn job_type(&self) -> &'static str {
        JOB_DELETE_TENANT
    }

    async fn handle(
        &self,
        state: Arc<AppState>,
        job: crate::models::Job,
        storage: crate::storage::TenantStorage,
    ) -> JobExecution {
        let payload: DeleteTenantPayload = match serde_json::from_value(job.payload.clone()) {
            Ok(payload) => payload,
            Err(err) => {
                return JobExecution::Failed {
                    error: format!("invalid delete tenant payload: {err}"),
                }
            }
        };

        let tenant_id = match job.tenant_id {
            Some(id) => id,
            None => {
                return JobExecution::Failed {
                    error: "delete job is missing tenant context".to_string(),
                }
            }
        };

        match delete_tenant(&state, storage, tenant_id, job.id, &payload).await {
            Ok(()) => JobExecution::Success,
            Err(err) => JobExecution::Failed { error: err },
        }
    }
}
