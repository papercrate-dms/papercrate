use std::collections::HashMap;
use std::env;
use std::sync::Arc;
use std::time::Duration;

use crate::auth::capability_sets::{
    ensure_capability_set, owner_capabilities, readonly_capabilities, user_capabilities,
    webdav_capabilities,
};
use crate::auth::jwt::{AccessTokenContext, JwtService, PrincipalKind};
use crate::error::AppError;
use crate::config::AppConfig;
use crate::db::{self, PgPool};
use crate::migrations::MIGRATIONS;
use crate::models::{
    Job, NewUser, NewUserMembership, NewUserPasskey, NewUserSession, Tenant, TenantStatus, User,
    UserMembership,
};
use crate::routes;
use crate::schema::user_sessions::dsl as session_dsl;
use crate::state::AppState;
use crate::storage::ObjectStorage;
use anyhow::{anyhow, ensure, Context, Result};
use async_trait::async_trait;
use axum::body::Body;
use axum::http::{header, Method, Request};
use axum::Router;
use chrono::{Duration as ChronoDuration, Utc};
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::OptionalExtension;
use diesel::PgConnection;
use diesel_migrations::MigrationHarness;
use http_body_util::BodyExt;
use once_cell::sync::Lazy;
use rand::{rngs::OsRng, TryRngCore};
use serde::Serialize;
use serde_json::{self, json};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;
use tower::util::ServiceExt;
use uuid::Uuid;

const RESET_DATABASE_SQL: &str = "DROP SCHEMA IF EXISTS tenant CASCADE;\n\
     DROP SCHEMA IF EXISTS shared CASCADE;\n\
     DROP SCHEMA IF EXISTS public CASCADE;\n\
     CREATE SCHEMA public;\n\
     GRANT ALL ON SCHEMA public TO public;";

static DB_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const TEST_TENANT_NAME: &str = "test_tenant";

#[derive(Clone, Copy, Debug)]
pub enum TestUserRole {
    Owner,
    Member,
    WebDav,
}

#[derive(Clone)]
pub struct StoredObject {
    pub key: String,
    pub bytes: Vec<u8>,
    pub content_type: Option<String>,
    pub content_disposition: Option<String>,
}

#[derive(Default)]
pub struct FakeStorage {
    objects: Mutex<HashMap<String, StoredObject>>,
}

#[async_trait]
impl ObjectStorage for FakeStorage {
    async fn put_object(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: Option<String>,
        content_disposition: Option<String>,
    ) -> Result<()> {
        let stored = StoredObject {
            key: key.to_string(),
            bytes,
            content_type,
            content_disposition,
        };
        let mut guard = self.objects.lock().await;
        guard.insert(stored.key.clone(), stored);
        Ok(())
    }

    async fn presign_get_object(
        &self,
        key: &str,
        expires_in: Duration,
        _response_content_disposition: Option<&str>,
    ) -> Result<String> {
        let guard = self.objects.lock().await;
        ensure!(guard.contains_key(key), "object {key} missing");
        Ok(format!(
            "https://fake-storage/{key}?expires_in={}",
            expires_in.as_secs()
        ))
    }

    async fn get_object(&self, key: &str) -> Result<Vec<u8>> {
        let guard = self.objects.lock().await;
        guard
            .get(key)
            .map(|obj| obj.bytes.clone())
            .ok_or_else(|| anyhow!("object {key} missing"))
    }

    async fn get_object_range(
        &self,
        key: &str,
        start: u64,
        end: Option<u64>,
    ) -> Result<Vec<u8>> {
        let guard = self.objects.lock().await;
        let bytes = guard
            .get(key)
            .map(|obj| obj.bytes.clone())
            .ok_or_else(|| anyhow!("object {key} missing"))?;

        let start_idx = start as usize;
        let end_idx = end.map(|idx| idx.saturating_add(1) as usize).unwrap_or(bytes.len());
        if start_idx >= bytes.len() {
            return Ok(Vec::new());
        }
        Ok(bytes[start_idx..end_idx.min(bytes.len())].to_vec())
    }

    async fn delete_object(&self, key: &str) -> Result<()> {
        let mut guard = self.objects.lock().await;
        guard.remove(key);
        Ok(())
    }
}

impl FakeStorage {
    pub async fn get(&self, key: &str) -> Option<StoredObject> {
        let guard = self.objects.lock().await;
        guard.get(key).cloned()
    }

    pub async fn object_count(&self) -> usize {
        let guard = self.objects.lock().await;
        guard.len()
    }

    pub async fn object_count_with_prefix(&self, prefix: &str) -> usize {
        let guard = self.objects.lock().await;
        guard.keys().filter(|key| key.starts_with(prefix)).count()
    }

    pub async fn contains_key(&self, key: &str) -> bool {
        let guard = self.objects.lock().await;
        guard.contains_key(key)
    }

    pub async fn keys_with_prefix(&self, prefix: &str) -> Vec<String> {
        let guard = self.objects.lock().await;
        guard
            .keys()
            .filter(|key| key.starts_with(prefix))
            .cloned()
            .collect()
    }
}

pub struct TestApp {
    pub state: AppState,
    router: Router,
    storage: Arc<FakeStorage>,
}

impl TestApp {
    pub async fn new() -> Result<Self> {
        Self::with_config(|_| {}).await
    }

    pub async fn with_config<F>(configure: F) -> Result<Self>
    where
        F: FnOnce(&mut AppConfig),
    {
        let database_url = env::var("TEST_DATABASE_URL")
            .context("TEST_DATABASE_URL must be set for integration tests")?;

        let mut config = AppConfig {
            database_url: database_url.clone(),
            migrations_database_url: None,
            database_max_pool_size: db::DEFAULT_MAX_POOL_SIZE,
            server_host: "127.0.0.1".to_string(),
            server_port: 0,
            webdav_host: "127.0.0.1".to_string(),
            webdav_port: 0,
            jwt_secret: "test-secret".to_string(),
            jwt_issuer: "test-issuer".to_string(),
            jwt_audience: "test-audience".to_string(),
            jwt_expiry_minutes: 60,
            download_token_audience: "test-download".to_string(),
            download_token_expiry_minutes: 60,
            refresh_token_expiry_days: 30,
            refresh_cookie_secure: false,
            refresh_cookie_domain: None,
            cors_allowed_origin: None,
            proxy_downloads: false,
            aws_endpoint_url: None,
            aws_access_key_id: None,
            aws_secret_access_key: None,
            aws_region: "us-east-1".to_string(),
            s3_bucket: "test-bucket".to_string(),
            quickwit_endpoint: None,
            quickwit_index: None,
            worker_max_document_bytes: 200 * 1024 * 1024,
            upload_body_limit_bytes: 128 * 1024 * 1024,
            service_timezone: "UTC".to_string(),
            issued_at_date_order: "DMY".to_string(),
            issued_at_filename_date_order: None,
            issued_at_date_parser_locales: Vec::new(),
            issued_at_ignore_dates: Vec::new(),
            webauthn_rp_id: Some("localhost".to_string()),
            webauthn_origin: Some("http://localhost".to_string()),
            webauthn_rp_name: "Papercrate".to_string(),
            webdav_path_prefix: None,
        };

        configure(&mut config);

        let pool = db::init_pool_with_size(&config.database_url, config.database_max_pool_size)?;
        prepare_database(&pool).await?;

        let storage = Arc::new(FakeStorage::default());
        let storage_for_state: Arc<dyn ObjectStorage> = storage.clone();
        let jwt = JwtService::from_config(&config)?;
        let state = AppState::new(pool.clone(), config, storage_for_state, jwt);
        let router = routes::create_router(state.clone());

        let app = Self {
            state,
            router,
            storage,
        };

        app.ensure_default_tenant().await?;

        Ok(app)
    }

    pub async fn cleanup(&self) -> Result<()> {
        let pool = self.state.pool.clone();
        let _ = tokio::task::spawn_blocking(move || -> Result<()> {
            let mut conn = pool
                .get()
                .map_err(|err| anyhow!("failed to get cleanup connection: {err}"))?;
            truncate_all(&mut conn)?;
            Ok(())
        })
        .await
        .context("cleanup task panicked")?;

        self.ensure_default_tenant().await?;
        Ok(())
    }

    pub async fn tenant_id(&self) -> Result<Uuid> {
        self.ensure_default_tenant().await
    }

    pub fn storage(&self) -> Arc<FakeStorage> {
        self.storage.clone()
    }

    pub async fn storage_key_for(&self, key: &str) -> Result<String> {
        self.ensure_default_tenant().await?;
        let tenant = self
            .state
            .tenants
            .get_by_name(TEST_TENANT_NAME)
            .map_err(|err| anyhow!("default tenant not found: {:?}", err))?;
        let root = tenant
            .storage_root
            .clone()
            .ok_or_else(|| anyhow!("default tenant missing storage root"))?;
        Ok(format!("{}{}", root, key))
    }

    pub async fn insert_user(&self, username: &str, role: TestUserRole) -> Result<Uuid> {
        let username = username.to_string();
        let tenant_id = self.ensure_default_tenant().await?;
        let user_id = self
            .with_conn(move |conn| {
                let user = NewUser {
                    id: Uuid::new_v4(),
                    username,
                };
                diesel::insert_into(crate::schema::users::table)
                    .values(&user)
                    .execute(conn)
                    .context("failed to insert user")?;

                let capabilities = match role {
                    TestUserRole::Owner => owner_capabilities(),
                    TestUserRole::Member => user_capabilities(),
                    TestUserRole::WebDav => webdav_capabilities(),
                };

                let capability_set = ensure_capability_set(conn, tenant_id, capabilities)
                    .map_err(|err| anyhow!("failed to ensure capability set: {:?}", err))?;

                let membership = NewUserMembership {
                    id: Uuid::new_v4(),
                    user_id: user.id,
                    tenant_id,
                    capability_set_id: Some(capability_set.id),
                };

                diesel::insert_into(crate::schema::user_memberships::table)
                    .values(&membership)
                    .execute(conn)
                    .context("failed to insert user membership")?;
                Ok(user.id)
            })
            .await?;

        Ok(user_id)
    }

    pub async fn insert_passkey(&self, user_id: Uuid, nickname: Option<&str>) -> Result<Uuid> {
        let passkey_id = Uuid::new_v4();
        let nickname = nickname.map(|value| value.to_string());
        self.with_conn(move |conn| {
            let credential_id = passkey_id.as_bytes().to_vec();
            let public_key = passkey_id.as_bytes().iter().copied().collect::<Vec<u8>>();
            let passkey = NewUserPasskey {
                id: passkey_id,
                user_id,
                credential_id,
                public_key,
                credential: json!({ "dummy": passkey_id.to_string() }),
                sign_count: 0,
                transports: vec![Some("usb".to_string())],
                aaguid: None,
                nickname,
            };

            diesel::insert_into(crate::schema::user_passkeys::table)
                .values(&passkey)
                .execute(conn)
                .context("failed to insert passkey")?;

            Ok(passkey_id)
        })
        .await
    }

    async fn ensure_default_tenant(&self) -> Result<Uuid> {
        let name_value = TEST_TENANT_NAME.to_string();
        let quickwit_enabled = self.state.config.quickwit_endpoint.is_some();
        let tenant_id = self
            .with_conn(move |conn| {
                use crate::schema::tenants::dsl as tenants_dsl;

                let existing = tenants_dsl::tenants
                    .filter(tenants_dsl::name.eq(&name_value))
                    .first::<Tenant>(conn)
                    .optional()
                    .context("failed to load default tenant")?;

                let tenant_id = if let Some(current) = existing {
                    let desired_root = current
                        .storage_root
                        .clone()
                        .filter(|root| root.ends_with('/'))
                        .unwrap_or_else(|| format!("test-tenants/{}/", current.id));

                    if current.storage_root.as_deref() != Some(desired_root.as_str()) {
                        diesel::update(tenants_dsl::tenants.filter(tenants_dsl::id.eq(current.id)))
                            .set(tenants_dsl::storage_root.eq(Some(desired_root)))
                            .execute(conn)
                            .context("failed to update default tenant storage root")?;
                    }

                    current.id
                } else {
                    let new_id = Uuid::new_v4();
                    let root = format!("test-tenants/{}/", new_id);
                    let quickwit_value = if quickwit_enabled {
                        Some(format!("documents-{}", new_id))
                    } else {
                        None
                    };

                    diesel::insert_into(tenants_dsl::tenants)
                        .values((
                            tenants_dsl::id.eq(new_id),
                            tenants_dsl::name.eq(&name_value),
                            tenants_dsl::storage_root.eq(Some(root)),
                            tenants_dsl::quickwit_index.eq(quickwit_value),
                            tenants_dsl::status.eq(TenantStatus::Active),
                        ))
                        .execute(conn)
                        .context("failed to insert default tenant")?;

                    new_id
                };

                Ok(tenant_id)
            })
            .await?;

        let mut conn = self
            .state
            .db_for_tenant(tenant_id)
            .map_err(|err| anyhow!("failed to scope tenant connection: {err:?}"))?;

        conn.scoped(|tx| {
            ensure_capability_set(tx, tenant_id, owner_capabilities())?;
            ensure_capability_set(tx, tenant_id, user_capabilities())?;
            ensure_capability_set(tx, tenant_id, readonly_capabilities())?;
            ensure_capability_set(tx, tenant_id, webdav_capabilities())?;
            Ok::<_, AppError>(())
        })
        .map_err(|err| anyhow!("ensure capability sets: {err:?}"))?;

        Ok(tenant_id)
    }

    pub async fn login_token(&self, username: &str, _password: &str) -> Result<String> {
        let (access_token, _, _) = self.create_session(username).await?;
        Ok(access_token)
    }

    pub async fn create_session(&self, username: &str) -> Result<(String, String, Uuid)> {
        let username = username.to_string();
        let state = self.state.clone();
        self.with_conn(move |conn| {
            use crate::schema::capability_sets::dsl as capability_sets_dsl;
            use crate::schema::tenants::dsl as tenants_dsl;
            use crate::schema::user_memberships::dsl as memberships_dsl;
            use crate::schema::users::dsl as users_dsl;

            let user: User = users_dsl::users
                .filter(users_dsl::username.eq(&username))
                .first(conn)?;

            let membership: UserMembership = memberships_dsl::user_memberships
                .filter(memberships_dsl::user_id.eq(user.id))
                .first(conn)?;

            let tenant: Tenant = tenants_dsl::tenants
                .find(membership.tenant_id)
                .first(conn)?;

            let capability_set_id = membership
                .capability_set_id
                .ok_or_else(|| anyhow!("membership missing capability set"))?;

            let cap_version = capability_sets_dsl::capability_sets
                .find(capability_set_id)
                .select(capability_sets_dsl::cap_version)
                .first::<i32>(conn)?;

            let now = Utc::now();
            let session_id = Uuid::new_v4();
            let access_token = state
                .jwt
                .generate_token(AccessTokenContext {
                    user_id: user.id,
                    tenant_id: tenant.id,
                    username: user.username.clone(),
                    principal_kind: PrincipalKind::UserSession,
                    principal_id: session_id,
                    capability_set_id,
                    cap_version,
                })
                .map_err(|err| anyhow!(err))?;

            let session_value = generate_session_token();
            let session_hash = hash_session_token(&session_value);
            let refresh_expires_at =
                now + ChronoDuration::days(state.config.refresh_token_expiry_days);

            let new_session = NewUserSession {
                id: session_id,
                user_id: user.id,
                token_hash: session_hash,
                issued_at: now.naive_utc(),
                expires_at: refresh_expires_at.naive_utc(),
                tenant_id: tenant.id,
            };

            diesel::insert_into(session_dsl::user_sessions)
                .values(&new_session)
                .execute(conn)?;

            let cookie = format!("refresh_token={session_value}");
            Ok((access_token, cookie, tenant.id))
        })
        .await
    }

    pub async fn clear_jobs(&self) -> Result<()> {
        self.with_conn(|conn| {
            use crate::schema::jobs::dsl::jobs as jobs_table;
            diesel::delete(jobs_table)
                .execute(conn)
                .context("failed to clear jobs")?;
            Ok(())
        })
        .await
    }

    pub async fn jobs_by_type(&self, ty: &str) -> Result<Vec<Job>> {
        let ty = ty.to_string();
        self.with_conn(move |conn| {
            use crate::schema::jobs::dsl::{job_type as job_type_col, jobs as jobs_table};
            let rows = jobs_table
                .filter(job_type_col.eq(&ty))
                .load::<Job>(conn)
                .context("failed to load jobs")?;
            Ok(rows)
        })
        .await
    }

    pub async fn post_json<T: Serialize + ?Sized>(
        &self,
        path: &str,
        payload: &T,
        token: Option<&str>,
    ) -> Result<hyper::Response<Body>> {
        self.post_json_with_cookie(path, payload, token, None).await
    }

    pub async fn post_json_with_cookie<T: Serialize + ?Sized>(
        &self,
        path: &str,
        payload: &T,
        token: Option<&str>,
        cookie: Option<&str>,
    ) -> Result<hyper::Response<Body>> {
        let body = serde_json::to_vec(payload)?;
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri(path)
            .header("content-type", "application/json");
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        if let Some(cookie) = cookie {
            builder = builder.header(header::COOKIE, cookie);
        }
        let request = builder.body(Body::from(body))?;
        Ok(self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("infallible response"))
    }

    pub async fn patch_json<T: Serialize + ?Sized>(
        &self,
        path: &str,
        payload: &T,
        token: Option<&str>,
    ) -> Result<hyper::Response<Body>> {
        let body = serde_json::to_vec(payload)?;
        let mut builder = Request::builder()
            .method(Method::PATCH)
            .uri(path)
            .header("content-type", "application/json");
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        let request = builder.body(Body::from(body))?;
        Ok(self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("infallible response"))
    }

    pub async fn get(&self, path: &str, token: Option<&str>) -> Result<hyper::Response<Body>> {
        let mut builder = Request::builder().method(Method::GET).uri(path);
        if let Some(token) = token {
            builder = builder.header("authorization", format!("Bearer {token}"));
        }
        let request = builder.body(Body::empty())?;
        Ok(self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("infallible response"))
    }

    pub async fn delete(&self, path: &str, token: Option<&str>) -> Result<hyper::Response<Body>> {
        let builder = Request::builder().method(Method::DELETE).uri(path);
        let builder = if let Some(token) = token {
            builder.header("authorization", format!("Bearer {token}"))
        } else {
            builder
        };
        let request = builder.body(Body::empty())?;
        Ok(self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("infallible response"))
    }

    pub async fn upload_document(
        &self,
        path: &str,
        filename: &str,
        content_type: &str,
        data: &[u8],
        folder_id: Option<Uuid>,
        token: &str,
    ) -> Result<hyper::Response<Body>> {
        let extras = UploadExtras::empty();
        self.upload_document_with_extras(
            path,
            filename,
            content_type,
            data,
            folder_id,
            extras,
            token,
        )
        .await
    }

    pub async fn upload_document_with_options(
        &self,
        path: &str,
        filename: &str,
        content_type: &str,
        data: &[u8],
        folder_id: Option<Uuid>,
        title: Option<&str>,
        metadata_json: Option<&str>,
        token: &str,
    ) -> Result<hyper::Response<Body>> {
        let extras = UploadExtras {
            title,
            metadata_json,
            tag_ids_json: None,
            correspondents_json: None,
            issued_at: None,
            skip_existing: None,
        };
        self.upload_document_with_extras(
            path,
            filename,
            content_type,
            data,
            folder_id,
            extras,
            token,
        )
        .await
    }

    pub async fn upload_document_with_extras(
        &self,
        path: &str,
        filename: &str,
        content_type: &str,
        data: &[u8],
        folder_id: Option<Uuid>,
        extras: UploadExtras<'_>,
        token: &str,
    ) -> Result<hyper::Response<Body>> {
        let boundary = format!("boundary-{}", Uuid::new_v4());
        let mut body = Vec::new();
        body.extend(format!("--{boundary}\r\n").as_bytes());
        body.extend(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\n",
                filename
            )
            .as_bytes(),
        );
        body.extend(format!("Content-Type: {}\r\n\r\n", content_type).as_bytes());
        body.extend(data);
        body.extend(b"\r\n");

        if let Some(folder) = folder_id {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            body.extend(b"Content-Disposition: form-data; name=\"folder_id\"\r\n\r\n");
            body.extend(folder.to_string().as_bytes());
            body.extend(b"\r\n");
        }

        if let Some(title_value) = extras.title {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            body.extend(b"Content-Disposition: form-data; name=\"title\"\r\n\r\n");
            body.extend(title_value.as_bytes());
            body.extend(b"\r\n");
        }

        if let Some(metadata_value) = extras.metadata_json {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            body.extend(b"Content-Disposition: form-data; name=\"metadata\"\r\n\r\n");
            body.extend(metadata_value.as_bytes());
            body.extend(b"\r\n");
        }

        if let Some(tag_ids_value) = extras.tag_ids_json {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            body.extend(b"Content-Disposition: form-data; name=\"tag_ids\"\r\n\r\n");
            body.extend(tag_ids_value.as_bytes());
            body.extend(b"\r\n");
        }

        if let Some(correspondents_value) = extras.correspondents_json {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            body.extend(b"Content-Disposition: form-data; name=\"correspondents\"\r\n\r\n");
            body.extend(correspondents_value.as_bytes());
            body.extend(b"\r\n");
        }

        if let Some(issued_at_value) = extras.issued_at {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            body.extend(b"Content-Disposition: form-data; name=\"issued_at\"\r\n\r\n");
            body.extend(issued_at_value.as_bytes());
            body.extend(b"\r\n");
        }

        if let Some(skip_flag) = extras.skip_existing {
            body.extend(format!("--{boundary}\r\n").as_bytes());
            body.extend(b"Content-Disposition: form-data; name=\"skip_existing\"\r\n\r\n");
            body.extend(if skip_flag {
                b"true".as_ref()
            } else {
                b"false".as_ref()
            });
            body.extend(b"\r\n");
        }

        body.extend(format!("--{boundary}--\r\n").as_bytes());

        let builder = Request::builder()
            .method(Method::POST)
            .uri(path)
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .header("authorization", format!("Bearer {token}"));

        let request = builder.body(Body::from(body))?;
        Ok(self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("infallible response"))
    }

    pub async fn with_conn<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut PgConnection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let pool = self.state.pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool
                .get()
                .map_err(|err| anyhow!("failed to get database connection: {err}"))?;
            f(&mut conn)
        })
        .await
        .context("connection task panicked")?
    }
}

pub struct UploadExtras<'a> {
    pub title: Option<&'a str>,
    pub metadata_json: Option<&'a str>,
    pub tag_ids_json: Option<&'a str>,
    pub correspondents_json: Option<&'a str>,
    pub issued_at: Option<&'a str>,
    pub skip_existing: Option<bool>,
}

impl<'a> UploadExtras<'a> {
    pub fn empty() -> Self {
        Self {
            title: None,
            metadata_json: None,
            tag_ids_json: None,
            correspondents_json: None,
            issued_at: None,
            skip_existing: None,
        }
    }
}

pub async fn acquire_db_lock() -> tokio::sync::MutexGuard<'static, ()> {
    DB_LOCK.lock().await
}

pub async fn body_to_vec(body: Body) -> Result<Vec<u8>> {
    let collected = body
        .collect()
        .await
        .map_err(|err| anyhow!("failed to read response body: {err}"))?;
    Ok(collected.to_bytes().to_vec())
}

#[cfg(test)]
mod helper_tests {
    use super::*;

    #[tokio::test]
    async fn create_session_and_login_token_provide_access() -> Result<()> {
        let _lock = acquire_db_lock().await;
        let app = TestApp::new().await?;

        let username = "helper-login";
        let password = "irrelevant";
        app.insert_user(username, TestUserRole::Owner).await?;

        let (access, refresh, refresh_id) = app.create_session(username).await?;
        assert!(!access.is_empty(), "access token should not be empty");
        assert!(!refresh.is_empty(), "refresh token should not be empty");
        assert_ne!(
            refresh_id,
            Uuid::nil(),
            "refresh token id should be assigned"
        );

        let bearer = app.login_token(username, password).await?;
        assert!(!bearer.is_empty(), "login_token must yield bearer");

        app.cleanup().await?;
        Ok(())
    }

    #[tokio::test]
    async fn insert_passkey_and_upload_with_options_succeeds() -> Result<()> {
        let _lock = acquire_db_lock().await;
        let app = TestApp::new().await?;
        let username = "helper-passkey";
        let password = "unused";
        let user_id = app.insert_user(username, TestUserRole::Owner).await?;

        let passkey_id = app.insert_passkey(user_id, Some("Laptop")).await?;
        assert_ne!(passkey_id, Uuid::nil());

        let bearer = app.login_token(username, password).await?;
        let response = app
            .upload_document_with_options(
                "/api/documents",
                "helper.txt",
                "text/plain",
                b"helper-content",
                None,
                Some("Helper Note"),
                Some("{\"category\":\"note\"}"),
                &bearer,
            )
            .await?;
        assert!(response.status().is_success());

        app.cleanup().await?;
        Ok(())
    }
}

async fn prepare_database(pool: &PgPool) -> Result<()> {
    let pool = pool.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut conn = pool
            .get()
            .map_err(|err| anyhow!("failed to acquire connection: {err}"))?;
        conn.batch_execute(RESET_DATABASE_SQL)
            .map_err(|err| anyhow!("failed to reset schema: {err}"))?;
        conn.batch_execute("DROP TABLE IF EXISTS __diesel_schema_migrations;")
            .map_err(|err| anyhow!("failed to drop diesel schema table: {err}"))?;
        conn.run_pending_migrations(MIGRATIONS)
            .map_err(|err| anyhow!("failed to run migrations: {err}"))?;
        truncate_all(&mut conn)?;
        Ok(())
    })
    .await
    .context("migration task panicked")?
}

fn truncate_all(conn: &mut PgConnection) -> Result<()> {
    conn.batch_execute(
        "TRUNCATE TABLE \
            tenant.document_assets, \
            tenant.document_correspondents, \
            tenant.correspondents, \
            tenant.document_tags, \
            tenant.document_versions, \
            tenant.documents, \
            tenant.folders, \
            shared.jobs, \
            tenant.user_sessions, \
            tenant.tags, \
            tenant.api_tokens, \
            shared.webauthn_challenges, \
            shared.user_passkeys, \
            tenant.user_memberships, \
            shared.users, \
            shared.magic_tokens, \
            shared.tenants \
        RESTART IDENTITY CASCADE;",
    )
    .context("failed to truncate tables")?;
    Ok(())
}

fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .expect("failed to read random bytes");
    hex::encode(bytes)
}

fn hash_session_token(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}
