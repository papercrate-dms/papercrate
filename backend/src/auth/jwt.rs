use anyhow::Result;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::config::AppConfig;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalKind {
    UserSession,
    ApiToken,
}

#[derive(Debug, Clone)]
pub struct AccessTokenContext {
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub username: String,
    pub principal_kind: PrincipalKind,
    pub principal_id: Uuid,
    pub capability_set_id: Uuid,
    pub cap_version: i32,
}

#[derive(Clone)]
pub struct JwtService {
    encoding: EncodingKey,
    decoding: DecodingKey,
    issuer: String,
    audience: String,
    expiry: Duration,
    download_audience: String,
    download_expiry: Duration,
    selector_audience: String,
    selector_expiry: Duration,
    signup_audience: String,
    signup_expiry: Duration,
}

impl JwtService {
    pub fn from_config(config: &AppConfig) -> Result<Self> {
        let access_expiry = Duration::minutes(config.jwt_expiry_minutes);

        Ok(Self {
            encoding: EncodingKey::from_secret(config.jwt_secret.as_bytes()),
            decoding: DecodingKey::from_secret(config.jwt_secret.as_bytes()),
            issuer: config.jwt_issuer.clone(),
            audience: config.jwt_audience.clone(),
            expiry: access_expiry,
            download_audience: config.download_token_audience.clone(),
            download_expiry: Duration::minutes(config.download_token_expiry_minutes),
            selector_audience: format!("{}:tenant-selector", config.jwt_audience),
            selector_expiry: access_expiry,
            signup_audience: format!("{}:signup", config.jwt_audience),
            signup_expiry: Duration::minutes(15),
        })
    }

    pub fn generate_token(&self, context: AccessTokenContext) -> Result<String> {
        let now = Utc::now();
        let exp = now + self.expiry;
        let claims = Claims {
            sub: context.user_id,
            tenant_id: context.tenant_id,
            username: context.username,
            principal_kind: context.principal_kind,
            principal_id: context.principal_id,
            capability_set_id: context.capability_set_id,
            cap_version: context.cap_version,
            iss: self.issuer.clone(),
            aud: self.audience.clone(),
            iat: now.timestamp() as usize,
            exp: exp.timestamp() as usize,
        };

        Ok(encode(&Header::default(), &claims, &self.encoding)?)
    }

    pub fn verify_token(&self, token: &str) -> Result<Claims> {
        let mut validation = Validation::default();
        validation.set_audience(&[self.audience.clone()]);
        validation.set_issuer(&[self.issuer.clone()]);
        let data = decode::<Claims>(token, &self.decoding, &validation)?;
        Ok(data.claims)
    }

    pub fn generate_download_token(
        &self,
        document_id: Uuid,
        version_id: Uuid,
        user_id: Uuid,
        tenant_id: Uuid,
    ) -> Result<String> {
        let now = Utc::now();
        let exp = now + self.download_expiry;
        let claims = DownloadClaims {
            subject: DownloadSubject::Document {
                doc_id: document_id,
                version_id,
            },
            user_id,
            tenant_id,
            iss: self.issuer.clone(),
            aud: self.download_audience.clone(),
            iat: now.timestamp() as usize,
            exp: exp.timestamp() as usize,
        };

        Ok(encode(&Header::default(), &claims, &self.encoding)?)
    }

    pub fn generate_asset_download_token(
        &self,
        asset_id: Uuid,
        user_id: Uuid,
        tenant_id: Uuid,
    ) -> Result<String> {
        let now = Utc::now();
        let exp = now + self.download_expiry;
        let claims = DownloadClaims {
            subject: DownloadSubject::Asset { asset_id },
            user_id,
            tenant_id,
            iss: self.issuer.clone(),
            aud: self.download_audience.clone(),
            iat: now.timestamp() as usize,
            exp: exp.timestamp() as usize,
        };

        Ok(encode(&Header::default(), &claims, &self.encoding)?)
    }

    pub fn verify_download_token(&self, token: &str) -> Result<DownloadClaims> {
        let mut validation = Validation::default();
        validation.set_audience(&[self.download_audience.clone()]);
        validation.set_issuer(&[self.issuer.clone()]);
        let data = decode::<DownloadClaims>(token, &self.decoding, &validation)?;
        Ok(data.claims)
    }

    pub fn generate_tenant_selector_token(&self, user_id: Uuid) -> Result<String> {
        let now = Utc::now();
        let exp = now + self.selector_expiry;
        let claims = TenantSelectionClaims {
            sub: user_id,
            iss: self.issuer.clone(),
            aud: self.selector_audience.clone(),
            iat: now.timestamp() as usize,
            exp: exp.timestamp() as usize,
        };

        Ok(encode(&Header::default(), &claims, &self.encoding)?)
    }

    pub fn verify_tenant_selector_token(&self, token: &str) -> Result<TenantSelectionClaims> {
        let mut validation = Validation::default();
        validation.set_audience(&[self.selector_audience.clone()]);
        validation.set_issuer(&[self.issuer.clone()]);
        let data = decode::<TenantSelectionClaims>(token, &self.decoding, &validation)?;
        Ok(data.claims)
    }

    pub fn generate_signup_token(
        &self,
        user_id: Uuid,
        challenge_id: Uuid,
        username: String,
    ) -> Result<String> {
        let now = Utc::now();
        let exp = now + self.signup_expiry;
        let claims = SignupClaims {
            sub: user_id,
            challenge_id,
            username,
            iss: self.issuer.clone(),
            aud: self.signup_audience.clone(),
            iat: now.timestamp() as usize,
            exp: exp.timestamp() as usize,
        };

        Ok(encode(&Header::default(), &claims, &self.encoding)?)
    }

    pub fn verify_signup_token(&self, token: &str) -> Result<SignupClaims> {
        let mut validation = Validation::default();
        validation.set_audience(&[self.signup_audience.clone()]);
        validation.set_issuer(&[self.issuer.clone()]);
        let data = decode::<SignupClaims>(token, &self.decoding, &validation)?;
        Ok(data.claims)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub tenant_id: Uuid,
    pub username: String,
    pub principal_kind: PrincipalKind,
    pub principal_id: Uuid,
    pub capability_set_id: Uuid,
    pub cap_version: i32,
    pub iss: String,
    pub aud: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum DownloadSubject {
    Document { doc_id: Uuid, version_id: Uuid },
    Asset { asset_id: Uuid },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadClaims {
    #[serde(flatten)]
    pub subject: DownloadSubject,
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub iss: String,
    pub aud: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantSelectionClaims {
    pub sub: Uuid,
    pub iss: String,
    pub aud: String,
    pub iat: usize,
    pub exp: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignupClaims {
    pub sub: Uuid,
    pub challenge_id: Uuid,
    pub username: String,
    pub iss: String,
    pub aud: String,
    pub iat: usize,
    pub exp: usize,
}
