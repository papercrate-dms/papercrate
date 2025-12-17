use anyhow::{anyhow, bail, Result};
use axum::http::StatusCode;
use chrono::{Duration as ChronoDuration, Utc};
use diesel::dsl::{count_star, exists, select};
use diesel::prelude::*;
use papercrate::jobs::{
    enqueue_job, mark_job_failed, mark_job_succeeded, JOB_DELETE_TENANT, STATUS_FAILED,
    STATUS_SUCCEEDED,
};
use papercrate::models::TenantStatus;
use papercrate::schema::{documents, jobs, tenants, user_memberships};
use papercrate::test_support::{acquire_db_lock, body_to_vec, TestApp, TestUserRole};
use papercrate::workers::tenants::{
    build_delete_proof_message, sign_delete_proof, DeleteAction, DeleteTenantJob,
};
use papercrate::workers::{JobExecution, JobHandler};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

#[tokio::test]
async fn delete_tenant_job_keeps_tenant_when_requested() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "delete-keep";
    app.insert_user("tenant-keep", TestUserRole::Owner).await?;
    let token = app.login_token("tenant-keep", password).await?;

    upload_fixture(&app, &token, "keep.pdf", b"keep").await?;

    let tenant_id = default_tenant_id(&app)?;
    set_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;
    assert_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;

    let storage = tenant_storage(&app, tenant_id)?;
    let storage_prefix = storage.root_prefix().to_string();
    let before = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(before.doc_count, 1);
    assert!(before.membership_count > 0);
    assert!(!before.storage_keys.is_empty());
    assert_storage_keys_present(&app, &before.storage_keys).await?;

    let job = enqueue_delete_job(&app, tenant_id, false).await?;
    let job_id = job.id;
    let handler = DeleteTenantJob::new();
    let state = Arc::new(app.state.clone());
    let execution = handler.handle(state, job, storage).await;
    assert_job_success(&execution);
    record_job_outcome(&app, job_id, &execution).await?;
    assert_eq!(fetch_job_status(&app, job_id).await?, STATUS_SUCCEEDED);

    let after = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(after.doc_count, 0);
    assert!(after.membership_count > 0);
    assert_storage_keys_absent(&app, &before.storage_keys).await?;
    assert_eq!(storage_object_count(&app, &storage_prefix).await?, 0);
    assert_eq!(
        fetch_tenant_status(&app, tenant_id).await?,
        TenantStatus::Suspended
    );
    assert!(tenant_exists(&app, tenant_id).await?);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_tenant_job_can_reset_tenant_to_active() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "delete-reset";
    app.insert_user("tenant-reset", TestUserRole::Owner).await?;
    let token = app.login_token("tenant-reset", password).await?;
    upload_fixture(&app, &token, "reset.pdf", b"reset").await?;

    let tenant_id = default_tenant_id(&app)?;
    set_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;
    assert_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;

    let storage = tenant_storage(&app, tenant_id)?;
    let storage_prefix = storage.root_prefix().to_string();
    let before = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(before.doc_count, 1);
    assert!(before.membership_count > 0);
    assert!(!before.storage_keys.is_empty());
    assert_storage_keys_present(&app, &before.storage_keys).await?;

    let job = enqueue_delete_job_with_status(&app, tenant_id, false, Some("active")).await?;
    let job_id = job.id;
    let handler = DeleteTenantJob::new();
    let state = Arc::new(app.state.clone());
    let execution = handler.handle(state, job, storage).await;
    assert_job_success(&execution);
    record_job_outcome(&app, job_id, &execution).await?;
    assert_eq!(fetch_job_status(&app, job_id).await?, STATUS_SUCCEEDED);

    let after = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(after.doc_count, 0);
    assert!(after.membership_count > 0);
    assert_storage_keys_absent(&app, &before.storage_keys).await?;
    assert_eq!(storage_object_count(&app, &storage_prefix).await?, 0);
    assert_eq!(
        fetch_tenant_status(&app, tenant_id).await?,
        TenantStatus::Active
    );

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_tenant_job_removes_tenant_entirely() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "delete-remove";
    app.insert_user("tenant-remove", TestUserRole::Owner)
        .await?;
    let token = app.login_token("tenant-remove", password).await?;

    upload_fixture(&app, &token, "remove-1.pdf", b"remove-1").await?;
    upload_fixture(&app, &token, "remove-2.pdf", b"remove-2").await?;

    let tenant_id = default_tenant_id(&app)?;
    set_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;
    assert_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;

    let storage = tenant_storage(&app, tenant_id)?;
    let storage_prefix = storage.root_prefix().to_string();
    let before = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert!(before.doc_count >= 2);
    assert!(before.membership_count > 0);
    assert!(before.storage_keys.len() >= 2);
    assert_storage_keys_present(&app, &before.storage_keys).await?;

    let job = enqueue_delete_job(&app, tenant_id, true).await?;
    let job_id = job.id;
    let handler = DeleteTenantJob::new();
    let state = Arc::new(app.state.clone());
    let execution = handler.handle(state, job, storage).await;
    assert_job_success(&execution);
    record_job_outcome(&app, job_id, &execution).await?;
    assert_eq!(fetch_job_status(&app, job_id).await?, STATUS_SUCCEEDED);

    let after = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(after.doc_count, 0);
    assert_eq!(after.membership_count, 0);
    assert!(after.storage_keys.is_empty());
    assert_storage_keys_absent(&app, &before.storage_keys).await?;
    assert_eq!(storage_object_count(&app, &storage_prefix).await?, 0);
    assert!(!tenant_exists(&app, tenant_id).await?);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_tenant_job_rejects_invalid_signature() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "delete-invalid";
    app.insert_user("tenant-invalid", TestUserRole::Owner)
        .await?;
    let token = app.login_token("tenant-invalid", password).await?;

    upload_fixture(&app, &token, "invalid.pdf", b"invalid").await?;

    let tenant_id = default_tenant_id(&app)?;
    set_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;
    assert_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;

    let storage = tenant_storage(&app, tenant_id)?;
    let storage_prefix = storage.root_prefix().to_string();
    let before = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(before.doc_count, 1);
    assert!(before.membership_count > 0);
    assert!(!before.storage_keys.is_empty());
    assert_storage_keys_present(&app, &before.storage_keys).await?;

    let job = enqueue_delete_job_with_invalid_signature(&app, tenant_id, false).await?;
    let job_id = job.id;
    let handler = DeleteTenantJob::new();
    let state = Arc::new(app.state.clone());
    let execution = handler.handle(state, job, storage).await;
    match execution {
        JobExecution::Failed { ref error } => {
            assert!(error.contains("signature"), "unexpected error: {error}");
        }
        _ => bail!("delete job should fail when signature is invalid"),
    }
    record_job_outcome(&app, job_id, &execution).await?;
    assert_eq!(fetch_job_status(&app, job_id).await?, STATUS_FAILED);

    let after = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(after.doc_count, before.doc_count);
    assert_eq!(after.membership_count, before.membership_count);
    assert_storage_keys_present(&app, &before.storage_keys).await?;
    assert_eq!(
        storage_object_count(&app, &storage_prefix).await?,
        before.storage_keys.len()
    );
    assert_eq!(
        fetch_tenant_status(&app, tenant_id).await?,
        TenantStatus::Deleting
    );

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_tenant_job_rejects_invalid_final_status() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "delete-invalid-status";
    app.insert_user("tenant-invalid-status", TestUserRole::Owner)
        .await?;
    let token = app.login_token("tenant-invalid-status", password).await?;

    upload_fixture(&app, &token, "invalid-status.pdf", b"payload").await?;

    let tenant_id = default_tenant_id(&app)?;
    set_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;
    assert_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;

    let storage = tenant_storage(&app, tenant_id)?;
    let storage_prefix = storage.root_prefix().to_string();
    let before = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(before.doc_count, 1);
    assert!(before.membership_count > 0);

    let job = enqueue_delete_job_with_overrides(
        &app,
        tenant_id,
        false,
        None,
        PayloadOverrides {
            final_status: Some("weird"),
            ..PayloadOverrides::default()
        },
    )
    .await?;
    let job_id = job.id;
    let handler = DeleteTenantJob::new();
    let state = Arc::new(app.state.clone());
    let execution = handler.handle(state, job, storage).await;
    match execution {
        JobExecution::Failed { ref error } => {
            assert!(error.contains("payload"), "unexpected error: {error}");
        }
        _ => bail!("delete job should fail when final_status is invalid"),
    }
    record_job_outcome(&app, job_id, &execution).await?;
    assert_eq!(fetch_job_status(&app, job_id).await?, STATUS_FAILED);

    let after = tenant_snapshot(&app, tenant_id, &storage_prefix).await?;
    assert_eq!(after.doc_count, before.doc_count);
    assert_eq!(after.membership_count, before.membership_count);
    assert_storage_keys_present(&app, &before.storage_keys).await?;
    assert_eq!(
        fetch_tenant_status(&app, tenant_id).await?,
        TenantStatus::Deleting
    );

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_tenant_job_rejects_malformed_issued_at() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "delete-bad-issued-at";
    app.insert_user("tenant-issued", TestUserRole::Owner)
        .await?;
    let token = app.login_token("tenant-issued", password).await?;

    upload_fixture(&app, &token, "issued.pdf", b"issued").await?;

    let tenant_id = default_tenant_id(&app)?;
    set_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;
    assert_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;

    let storage = tenant_storage(&app, tenant_id)?;
    let job = enqueue_delete_job_with_overrides(
        &app,
        tenant_id,
        false,
        None,
        PayloadOverrides {
            issued_at: Some("definitely-not-time"),
            ..PayloadOverrides::default()
        },
    )
    .await?;
    let job_id = job.id;
    let handler = DeleteTenantJob::new();
    let state = Arc::new(app.state.clone());
    let execution = handler.handle(state, job, storage).await;
    match execution {
        JobExecution::Failed { ref error } => {
            assert!(error.contains("issued_at"), "unexpected error: {error}");
        }
        _ => bail!("delete job should fail when issued_at is malformed"),
    }
    record_job_outcome(&app, job_id, &execution).await?;
    assert_eq!(fetch_job_status(&app, job_id).await?, STATUS_FAILED);

    app.cleanup().await?;
    Ok(())
}

#[tokio::test]
async fn delete_tenant_job_rejects_stale_confirmation() -> Result<()> {
    let _lock = acquire_db_lock().await;
    let app = TestApp::new().await?;

    let password = "delete-stale";
    app.insert_user("tenant-stale", TestUserRole::Owner).await?;
    let token = app.login_token("tenant-stale", password).await?;

    upload_fixture(&app, &token, "stale.pdf", b"stale").await?;

    let tenant_id = default_tenant_id(&app)?;
    set_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;
    assert_tenant_status(&app, tenant_id, TenantStatus::Deleting).await?;

    let storage = tenant_storage(&app, tenant_id)?;
    let stale_time = (Utc::now() - ChronoDuration::minutes(10)).to_rfc3339();
    let job = enqueue_delete_job_with_overrides(
        &app,
        tenant_id,
        false,
        None,
        PayloadOverrides {
            issued_at: Some(&stale_time),
            ..PayloadOverrides::default()
        },
    )
    .await?;
    let job_id = job.id;
    let handler = DeleteTenantJob::new();
    let state = Arc::new(app.state.clone());
    let execution = handler.handle(state, job, storage).await;
    match execution {
        JobExecution::Failed { ref error } => {
            assert!(error.contains("expired"), "unexpected error: {error}");
        }
        _ => bail!("delete job should fail when confirmation is stale"),
    }
    record_job_outcome(&app, job_id, &execution).await?;
    assert_eq!(fetch_job_status(&app, job_id).await?, STATUS_FAILED);

    app.cleanup().await?;
    Ok(())
}

async fn upload_fixture(app: &TestApp, token: &str, filename: &str, contents: &[u8]) -> Result<()> {
    let response = app
        .upload_document(
            "/api/documents",
            filename,
            "application/pdf",
            contents,
            None,
            token,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::CREATED);
    body_to_vec(response.into_body()).await?;
    Ok(())
}

fn default_tenant_id(app: &TestApp) -> Result<Uuid> {
    Ok(app
        .state
        .tenants
        .get_by_name("test_tenant")
        .map_err(|err| anyhow!("tenant lookup failed: {err:?}"))?
        .id)
}

async fn set_tenant_status(app: &TestApp, tenant_id: Uuid, status: TenantStatus) -> Result<()> {
    app.with_conn(move |conn| {
        diesel::update(tenants::table.find(tenant_id))
            .set(tenants::status.eq(status))
            .execute(conn)?;
        Ok(())
    })
    .await
}

async fn assert_tenant_status(
    app: &TestApp,
    tenant_id: Uuid,
    expected: TenantStatus,
) -> Result<()> {
    let status = fetch_tenant_status(app, tenant_id).await?;
    assert_eq!(status, expected);
    Ok(())
}

async fn tenant_snapshot(
    app: &TestApp,
    tenant_id: Uuid,
    storage_prefix: &str,
) -> Result<TenantSnapshot> {
    let (doc_count, membership_count) = app
        .with_conn(move |conn| {
            let doc_count: i64 = documents::table
                .filter(documents::tenant_id.eq(tenant_id))
                .select(count_star())
                .get_result(conn)?;
            let membership_count: i64 = user_memberships::table
                .filter(user_memberships::tenant_id.eq(tenant_id))
                .select(count_star())
                .get_result(conn)?;
            Ok::<_, anyhow::Error>((doc_count, membership_count))
        })
        .await?;

    let storage_keys = app.storage().keys_with_prefix(storage_prefix).await;

    Ok(TenantSnapshot {
        doc_count,
        membership_count,
        storage_keys,
    })
}

async fn tenant_exists(app: &TestApp, tenant_id: Uuid) -> Result<bool> {
    app.with_conn(move |conn| {
        let exists_value: bool =
            select(exists(tenants::table.filter(tenants::id.eq(tenant_id)))).get_result(conn)?;
        Ok(exists_value)
    })
    .await
}

async fn fetch_tenant_status(app: &TestApp, tenant_id: Uuid) -> Result<TenantStatus> {
    app.with_conn(move |conn| {
        tenants::table
            .find(tenant_id)
            .select(tenants::status)
            .first(conn)
            .map_err(Into::into)
    })
    .await
}

async fn record_job_outcome(app: &TestApp, job_id: Uuid, execution: &JobExecution) -> Result<()> {
    match execution {
        JobExecution::Success => {
            app.with_conn(move |conn| {
                mark_job_succeeded(conn, job_id)
                    .map_err(|err| anyhow!("mark succeeded failed: {err}"))
            })
            .await?
        }
        JobExecution::Failed { error } => {
            let error = error.clone();
            app.with_conn(move |conn| {
                mark_job_failed(conn, job_id, &error)
                    .map_err(|err| anyhow!("mark failed failed: {err}"))
            })
            .await?
        }
        JobExecution::Retry { .. } => bail!("retry outcome not expected in tenant deletion tests"),
    }
    Ok(())
}

async fn fetch_job_status(app: &TestApp, job_id: Uuid) -> Result<String> {
    app.with_conn(move |conn| {
        jobs::table
            .find(job_id)
            .select(jobs::status)
            .first::<String>(conn)
            .map_err(Into::into)
    })
    .await
}

fn tenant_storage(app: &TestApp, tenant_id: Uuid) -> Result<papercrate::storage::TenantStorage> {
    app.state
        .storage_for_tenant(tenant_id)
        .map_err(|err| anyhow!("storage unavailable: {err:?}"))
}

async fn storage_object_count(app: &TestApp, prefix: &str) -> Result<usize> {
    Ok(app.storage().object_count_with_prefix(prefix).await)
}

async fn assert_storage_keys_present(app: &TestApp, keys: &[String]) -> Result<()> {
    let storage = app.storage();
    for key in keys {
        assert!(
            storage.contains_key(key).await,
            "expected storage object '{}' to exist",
            key
        );
    }
    Ok(())
}

async fn assert_storage_keys_absent(app: &TestApp, keys: &[String]) -> Result<()> {
    let storage = app.storage();
    for key in keys {
        assert!(
            !storage.contains_key(key).await,
            "expected storage object '{}' to be deleted",
            key
        );
    }
    Ok(())
}

async fn enqueue_delete_job(
    app: &TestApp,
    tenant_id: Uuid,
    remove_tenant: bool,
) -> Result<papercrate::models::Job> {
    enqueue_delete_job_with_status(app, tenant_id, remove_tenant, None).await
}

async fn enqueue_delete_job_with_status(
    app: &TestApp,
    tenant_id: Uuid,
    remove_tenant: bool,
    final_status: Option<&'static str>,
) -> Result<papercrate::models::Job> {
    enqueue_delete_job_with_overrides(
        app,
        tenant_id,
        remove_tenant,
        final_status,
        PayloadOverrides::default(),
    )
    .await
}

async fn enqueue_delete_job_with_invalid_signature(
    app: &TestApp,
    tenant_id: Uuid,
    remove_tenant: bool,
) -> Result<papercrate::models::Job> {
    let mut job = enqueue_delete_job_with_overrides(
        app,
        tenant_id,
        remove_tenant,
        None,
        PayloadOverrides::default(),
    )
    .await?;

    let job_id = job.id;
    let mut payload = job.payload.clone();
    payload["signature"] = json!("deadbeefdeadbeefdeadbeefdeadbeef");
    let payload_for_db = payload.clone();

    app.with_conn(move |conn| {
        diesel::update(jobs::table.find(job_id))
            .set(jobs::payload.eq(payload_for_db))
            .execute(conn)?;
        Ok(())
    })
    .await?;

    job.payload = payload;
    Ok(job)
}

async fn enqueue_delete_job_with_overrides(
    app: &TestApp,
    tenant_id: Uuid,
    remove_tenant: bool,
    final_status: Option<&str>,
    overrides: PayloadOverrides<'_>,
) -> Result<papercrate::models::Job> {
    let secret = app.state.config.jwt_secret.clone();
    let overrides_owned = PayloadOverridesOwned::from(overrides);
    let requested_final_status = final_status.map(|value| value.to_string());

    app.with_conn(move |conn| {
        let tenant_name: String = tenants::table
            .find(tenant_id)
            .select(tenants::name)
            .first(conn)
            .map_err(|err| anyhow!("tenant lookup failed: {err}"))?;

        let payload = build_signed_delete_payload(
            tenant_id,
            &tenant_name,
            remove_tenant,
            requested_final_status.as_deref(),
            &secret,
            overrides_owned.as_borrowed(),
        )?;

        enqueue_job(conn, tenant_id, JOB_DELETE_TENANT, payload, None)
            .map_err(|err| anyhow!("enqueue failed: {err}"))
    })
    .await
}

fn build_signed_delete_payload(
    tenant_id: Uuid,
    tenant_name: &str,
    remove_tenant: bool,
    requested_final_status: Option<&str>,
    secret: &str,
    overrides: PayloadOverrides<'_>,
) -> Result<Value> {
    let action = if remove_tenant {
        DeleteAction::Delete
    } else {
        DeleteAction::Reset
    };

    let nonce = overrides
        .nonce
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("test-delete-nonce-{}", Uuid::new_v4()));
    let issued_at = overrides
        .issued_at
        .map(|value| value.to_string())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let payload_final_status = if remove_tenant {
        None
    } else if let Some(value) = overrides.final_status {
        Some(value.to_string())
    } else {
        Some(requested_final_status.unwrap_or("suspended").to_string())
    };

    let message = build_delete_proof_message(
        tenant_id,
        tenant_name,
        action,
        &nonce,
        &issued_at,
        payload_final_status.as_deref(),
    );
    let signature = sign_delete_proof(secret, &message)
        .map_err(|err| anyhow!("failed to sign delete proof: {err}"))?;

    let mut payload = json!({
        "remove_tenant": remove_tenant,
        "tenant_name": tenant_name,
        "action": action.as_str(),
        "nonce": nonce,
        "issued_at": issued_at,
        "signature": signature,
    });
    if let Some(status) = payload_final_status {
        payload["final_status"] = json!(status);
    }

    Ok(payload)
}

struct TenantSnapshot {
    doc_count: i64,
    membership_count: i64,
    storage_keys: Vec<String>,
}

#[derive(Default)]
struct PayloadOverrides<'a> {
    final_status: Option<&'a str>,
    issued_at: Option<&'a str>,
    nonce: Option<&'a str>,
}

fn assert_job_success(execution: &JobExecution) {
    match execution {
        JobExecution::Success => {}
        JobExecution::Failed { error } => panic!("delete job failed unexpectedly: {error}"),
        JobExecution::Retry { error, .. } => {
            panic!("delete job asked for retry unexpectedly: {error}")
        }
    }
}

#[derive(Default, Clone)]
struct PayloadOverridesOwned {
    final_status: Option<String>,
    issued_at: Option<String>,
    nonce: Option<String>,
}

impl<'a> From<PayloadOverrides<'a>> for PayloadOverridesOwned {
    fn from(value: PayloadOverrides<'a>) -> Self {
        Self {
            final_status: value.final_status.map(|s| s.to_string()),
            issued_at: value.issued_at.map(|s| s.to_string()),
            nonce: value.nonce.map(|s| s.to_string()),
        }
    }
}

impl PayloadOverridesOwned {
    fn as_borrowed(&self) -> PayloadOverrides<'_> {
        PayloadOverrides {
            final_status: self.final_status.as_deref(),
            issued_at: self.issued_at.as_deref(),
            nonce: self.nonce.as_deref(),
        }
    }
}
