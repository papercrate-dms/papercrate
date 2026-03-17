use anyhow::{Context, Result};
use url::Url;

use serde::de::Deserializer;
use serde::Deserialize;
use serde_aux::field_attributes::deserialize_bool_from_anything;

use crate::db::DEFAULT_MAX_POOL_SIZE;

#[derive(Clone, Debug, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    #[serde(default)]
    pub migrations_database_url: Option<String>,
    #[serde(default = "default_database_max_pool_size")]
    pub database_max_pool_size: u32,
    #[serde(default = "default_server_host")]
    pub server_host: String,
    #[serde(default = "default_server_port")]
    pub server_port: u16,
    #[serde(default = "default_webdav_host")]
    pub webdav_host: String,
    #[serde(default = "default_webdav_port")]
    pub webdav_port: u16,
    #[serde(default)]
    pub webdav_path_prefix: Option<String>,
    pub jwt_secret: String,
    #[serde(default = "default_jwt_issuer")]
    pub jwt_issuer: String,
    #[serde(default = "default_jwt_audience")]
    pub jwt_audience: String,
    #[serde(default = "default_jwt_expiry_minutes")]
    pub jwt_expiry_minutes: i64,
    #[serde(default = "default_download_token_audience")]
    pub download_token_audience: String,
    #[serde(default = "default_download_token_expiry_minutes")]
    pub download_token_expiry_minutes: i64,
    #[serde(default = "default_refresh_token_expiry_days")]
    pub refresh_token_expiry_days: i64,
    #[serde(
        default = "default_refresh_cookie_secure",
        deserialize_with = "deserialize_bool_from_anything"
    )]
    pub refresh_cookie_secure: bool,
    #[serde(default)]
    pub refresh_cookie_domain: Option<String>,
    #[serde(default)]
    pub cors_allowed_origin: Option<String>,
    #[serde(default, deserialize_with = "deserialize_bool_from_anything")]
    pub proxy_downloads: bool,
    #[serde(default)]
    pub aws_endpoint_url: Option<String>,
    #[serde(default)]
    pub aws_access_key_id: Option<String>,
    #[serde(default)]
    pub aws_secret_access_key: Option<String>,
    #[serde(default = "default_aws_region")]
    pub aws_region: String,
    pub s3_bucket: String,
    #[serde(default)]
    pub quickwit_endpoint: Option<String>,
    #[serde(default)]
    pub quickwit_index: Option<String>,
    #[serde(default = "default_worker_max_document_bytes")]
    pub worker_max_document_bytes: u64,
    #[serde(default = "default_upload_body_limit_bytes")]
    pub upload_body_limit_bytes: u64,
    #[serde(default = "default_service_timezone")]
    pub service_timezone: String,
    #[serde(default = "default_issued_at_date_order")]
    pub issued_at_date_order: String,
    #[serde(default)]
    pub issued_at_filename_date_order: Option<String>,
    #[serde(default, deserialize_with = "deserialize_string_list")]
    pub issued_at_date_parser_locales: Vec<String>,
    #[serde(default, deserialize_with = "deserialize_string_list")]
    pub issued_at_ignore_dates: Vec<String>,
    #[serde(default)]
    pub webauthn_rp_id: Option<String>,
    #[serde(default)]
    pub webauthn_origin: Option<String>,
    #[serde(default = "default_webauthn_rp_name")]
    pub webauthn_rp_name: String,
}

impl AppConfig {
    pub fn load_and_log(component: &str) -> Result<Self> {
        dotenv::dotenv().ok();
        let config = Self::from_env()?;
        tracing::info!(
            component,
            database_url = %config.redacted_database_url(),
            migrations_database_url = %config.redacted_migrations_database_url(),
            pool_size = config.database_max_pool_size,
            quickwit_enabled = config.quickwit_endpoint.is_some(),
            passkeys_enabled = config.webauthn_origin.is_some(),
            s3_bucket = %config.s3_bucket,
            worker_max_document_bytes = config.worker_max_document_bytes,
            upload_body_limit_bytes = config.upload_body_limit_bytes,
            proxy_downloads = config.proxy_downloads,
            "loaded backend configuration"
        );
        Ok(config)
    }

    pub fn from_env() -> Result<Self> {
        let config: AppConfig = envy::from_env()
            .context("failed to parse application configuration from environment")?;
        Ok(config.normalize())
    }

    pub fn redacted_database_url(&self) -> String {
        redact_database_url(&self.database_url)
    }

    pub fn redacted_migrations_database_url(&self) -> String {
        redact_database_url(self.migrations_database_url())
    }

    pub fn migrations_database_url(&self) -> &str {
        if let Some(ref url) = self.migrations_database_url {
            url
        } else {
            &self.database_url
        }
    }
}

impl AppConfig {
    /// Returns the normalized WebDAV path prefix (e.g. "/webdav") or an empty
    /// string when no prefix is configured.
    pub fn webdav_prefix(&self) -> &str {
        self.webdav_path_prefix.as_deref().unwrap_or("")
    }

    fn normalize(mut self) -> Self {
        if self.webdav_host.is_empty() {
            self.webdav_host = self.server_host.clone();
        }

        // Normalise the WebDAV path prefix: ensure it starts with '/' and has
        // no trailing slash.  An empty / whitespace-only value disables the
        // prefix entirely.
        if let Some(ref mut prefix) = self.webdav_path_prefix {
            let trimmed = prefix.trim().trim_matches('/').to_string();
            if trimmed.is_empty() {
                self.webdav_path_prefix = None;
            } else {
                *prefix = format!("/{trimmed}");
            }
        }

        if self.webauthn_rp_id.is_none() {
            self.webauthn_rp_id = Some(self.server_host.clone());
        }

        if self.webauthn_origin.is_none() {
            let scheme = if self.server_host == "127.0.0.1" || self.server_host == "localhost" {
                "http"
            } else {
                "https"
            };
            self.webauthn_origin = Some(format!(
                "{scheme}://{}:{}",
                self.server_host, self.server_port
            ));
        }
        self
    }
}

fn default_database_max_pool_size() -> u32 {
    DEFAULT_MAX_POOL_SIZE
}

fn default_server_host() -> String {
    "127.0.0.1".to_string()
}

fn default_server_port() -> u16 {
    3000
}

fn default_webdav_host() -> String {
    String::new()
}

fn default_webdav_port() -> u16 {
    3001
}

fn default_jwt_issuer() -> String {
    "papercrate".to_string()
}

fn default_jwt_audience() -> String {
    "papercrate-clients".to_string()
}

fn default_jwt_expiry_minutes() -> i64 {
    60
}

fn default_download_token_audience() -> String {
    "papercrate-download".to_string()
}

fn default_download_token_expiry_minutes() -> i64 {
    60
}

fn default_refresh_token_expiry_days() -> i64 {
    30
}

fn default_refresh_cookie_secure() -> bool {
    false
}

fn default_aws_region() -> String {
    "us-east-1".to_string()
}

fn default_worker_max_document_bytes() -> u64 {
    200 * 1024 * 1024
}

fn default_upload_body_limit_bytes() -> u64 {
    128 * 1024 * 1024
}

fn default_service_timezone() -> String {
    "UTC".to_string()
}

fn default_issued_at_date_order() -> String {
    "DMY".to_string()
}

fn deserialize_string_list<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Helper {
        List(Vec<String>),
        Single(String),
    }

    let helper = Option::<Helper>::deserialize(deserializer)?;
    let mut values = Vec::new();

    if let Some(helper) = helper {
        match helper {
            Helper::List(list) => {
                for entry in list {
                    let trimmed = entry.trim();
                    if !trimmed.is_empty() {
                        values.push(trimmed.to_string());
                    }
                }
            }
            Helper::Single(value) => {
                for part in value.split(',') {
                    let trimmed = part.trim();
                    if !trimmed.is_empty() {
                        values.push(trimmed.to_string());
                    }
                }
            }
        }
    }

    Ok(values)
}

fn default_webauthn_rp_name() -> String {
    "Papercrate".to_string()
}

pub fn redact_database_url(raw: &str) -> String {
    match Url::parse(raw) {
        Ok(mut parsed) => {
            if parsed.password().is_some() {
                let _ = parsed.set_password(Some("*****"));
                parsed.to_string()
            } else {
                raw.to_string()
            }
        }
        Err(_) => "***".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::redact_database_url;

    #[test]
    fn redacts_password_in_database_url() {
        let redacted = redact_database_url("postgres://user:secret@localhost/db");
        assert!(redacted.contains("postgres://user:*****@"));
        assert!(!redacted.contains("secret"));
    }

    #[test]
    fn handles_url_without_password() {
        let redacted = redact_database_url("postgres://localhost/db");
        assert_eq!(redacted, "postgres://localhost/db");
    }

    #[test]
    fn falls_back_when_parse_fails() {
        let redacted = redact_database_url("not a url");
        assert_eq!(redacted, "***");
    }
}
