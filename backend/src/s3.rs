use anyhow::{anyhow, Context, Result};
use s3::{bucket::Bucket, creds::Credentials, region::Region};

use crate::config::AppConfig;

pub fn build_bucket(config: &AppConfig) -> Result<Bucket> {
    let region = if let Some(endpoint) = &config.aws_endpoint_url {
        Region::Custom {
            region: config.aws_region.clone(),
            endpoint: endpoint.clone(),
        }
    } else {
        config
            .aws_region
            .parse::<Region>()
            .context("invalid AWS region")?
    };

    let credentials = if let (Some(access_key), Some(secret_key)) = (
        config.aws_access_key_id.as_deref(),
        config.aws_secret_access_key.as_deref(),
    ) {
        Credentials::new(Some(access_key), Some(secret_key), None, None, None)
            .context("failed to create static AWS credentials")?
    } else {
        Credentials::default().context("failed to load AWS credentials")?
    };

    let bucket = Bucket::new(&config.s3_bucket, region, credentials)
        .map_err(|err| anyhow!("failed to create S3 bucket client: {err}"))?;
    let bucket = bucket.with_path_style();

    Ok(*bucket)
}
