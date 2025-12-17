use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use s3::bucket::Bucket;

use crate::models::Tenant;

#[async_trait]
pub trait ObjectStorage: Send + Sync + 'static {
    async fn put_object(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: Option<String>,
        content_disposition: Option<String>,
    ) -> Result<()>;

    async fn presign_get_object(
        &self,
        key: &str,
        expires_in: Duration,
        response_content_disposition: Option<&str>,
    ) -> Result<String>;

    async fn get_object(&self, key: &str) -> Result<Vec<u8>>;

    async fn get_object_range(&self, key: &str, start: u64, end: Option<u64>) -> Result<Vec<u8>>;

    async fn delete_object(&self, key: &str) -> Result<()>;
}

pub struct S3Storage {
    bucket: Bucket,
}

impl S3Storage {
    pub fn new(bucket: Bucket) -> Self {
        Self { bucket }
    }

    fn default_content_type(content_type: Option<String>) -> String {
        content_type.unwrap_or_else(|| "application/octet-stream".to_string())
    }
}

#[async_trait]
impl ObjectStorage for S3Storage {
    async fn put_object(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: Option<String>,
        content_disposition: Option<String>,
    ) -> Result<()> {
        let mut builder = self
            .bucket
            .put_object_builder(key, &bytes)
            .with_content_type(Self::default_content_type(content_type));

        if let Some(disposition) = content_disposition {
            builder = builder
                .with_content_disposition(disposition)
                .context("invalid content disposition header")?;
        }

        builder
            .execute()
            .await
            .context("failed to upload object to S3")?;

        Ok(())
    }

    async fn presign_get_object(
        &self,
        key: &str,
        expires_in: Duration,
        response_content_disposition: Option<&str>,
    ) -> Result<String> {
        let expiry_secs =
            u32::try_from(expires_in.as_secs()).context("presign expiry exceeds u32 range")?;

        let mut queries = HashMap::new();
        if let Some(value) = response_content_disposition {
            queries.insert(
                "response-content-disposition".to_string(),
                value.to_string(),
            );
        }

        self.bucket
            .presign_get(key, expiry_secs, (!queries.is_empty()).then_some(queries))
            .await
            .context("failed to generate presigned download URL")
    }

    async fn get_object(&self, key: &str) -> Result<Vec<u8>> {
        let data = self
            .bucket
            .get_object(key)
            .await
            .context("failed to download object from S3")?;
        Ok(data.into_bytes().to_vec())
    }

    async fn get_object_range(&self, key: &str, start: u64, end: Option<u64>) -> Result<Vec<u8>> {
        let data = self
            .bucket
            .get_object_range(key, start, end)
            .await
            .context("failed to download ranged object from S3")?;
        Ok(data.into_bytes().to_vec())
    }

    async fn delete_object(&self, key: &str) -> Result<()> {
        self.bucket
            .delete_object(key)
            .await
            .context("failed to delete object from S3")?;
        Ok(())
    }
}
#[derive(Clone)]
pub struct TenantStorage {
    inner: Arc<dyn ObjectStorage>,
    root: String,
}

impl TenantStorage {
    pub fn new(inner: Arc<dyn ObjectStorage>, tenant: &Tenant) -> Result<Self> {
        let root = tenant
            .storage_root
            .as_ref()
            .ok_or_else(|| anyhow!("tenant {} missing storage_root", tenant.id))?
            .to_owned();

        Ok(Self { inner, root })
    }

    fn qualify(&self, key: &str) -> String {
        format!("{}{}", self.root, key)
    }

    pub fn root_prefix(&self) -> &str {
        &self.root
    }

    pub async fn put_object(
        &self,
        key: &str,
        bytes: Vec<u8>,
        content_type: Option<String>,
        content_disposition: Option<String>,
    ) -> Result<()> {
        let qualified = self.qualify(key);
        self.inner
            .put_object(&qualified, bytes, content_type, content_disposition)
            .await
    }

    pub async fn presign_get_object(
        &self,
        key: &str,
        expires_in: Duration,
        response_content_disposition: Option<&str>,
    ) -> Result<String> {
        let qualified = self.qualify(key);
        self.inner
            .presign_get_object(&qualified, expires_in, response_content_disposition)
            .await
    }

    pub async fn get_object(&self, key: &str) -> Result<Vec<u8>> {
        let qualified = self.qualify(key);
        self.inner.get_object(&qualified).await
    }

    pub async fn get_object_range(
        &self,
        key: &str,
        start: u64,
        end: Option<u64>,
    ) -> Result<Vec<u8>> {
        let qualified = self.qualify(key);
        self.inner.get_object_range(&qualified, start, end).await
    }

    pub async fn delete_object(&self, key: &str) -> Result<()> {
        let qualified = self.qualify(key);
        self.inner.delete_object(&qualified).await
    }
}
