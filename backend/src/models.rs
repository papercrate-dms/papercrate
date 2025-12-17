use chrono::NaiveDateTime;
use diesel::deserialize::FromSql;
use diesel::pg::{Pg, PgValue};
use diesel::prelude::*;
use diesel::serialize::{IsNull, Output, ToSql};
use diesel::{deserialize, serialize, AsExpression, FromSqlRow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::io::Write;
use std::str;
use uuid::Uuid;

use utoipa::ToSchema;

use crate::schema::sql_types::{
    ApiCapability as ApiCapabilitySql, MagicTokenKind as MagicTokenKindSql,
    TenantStatus as TenantStatusSql,
};
use crate::schema::*;

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = user_memberships)]
#[diesel(belongs_to(User, foreign_key = user_id))]
#[diesel(belongs_to(Tenant, foreign_key = tenant_id))]
pub struct UserMembership {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub capability_set_id: Option<Uuid>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = user_memberships)]
pub struct NewUserMembership {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub capability_set_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, AsExpression, FromSqlRow)]
#[diesel(sql_type = TenantStatusSql)]
pub enum TenantStatus {
    Creating,
    Active,
    Suspended,
    Deleting,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, AsExpression, FromSqlRow)]
#[diesel(sql_type = MagicTokenKindSql)]
pub enum MagicTokenKind {
    EmailLogin,
    DemoLogin,
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    AsExpression,
    FromSqlRow,
    Serialize,
    Deserialize,
    ToSchema,
)]
#[diesel(sql_type = ApiCapabilitySql)]
pub enum ApiCapability {
    #[serde(rename = "documents:read")]
    DocumentsRead,
    #[serde(rename = "documents:edit")]
    DocumentsEdit,
    #[serde(rename = "documents:write")]
    DocumentsWrite,
    #[serde(rename = "documents:upload")]
    DocumentsUpload,
    #[serde(rename = "folders:read")]
    FoldersRead,
    #[serde(rename = "folders:edit")]
    FoldersEdit,
    #[serde(rename = "folders:write")]
    FoldersWrite,
    #[serde(rename = "tags:read")]
    TagsRead,
    #[serde(rename = "tags:edit")]
    TagsEdit,
    #[serde(rename = "tags:write")]
    TagsWrite,
    #[serde(rename = "correspondents:read")]
    CorrespondentsRead,
    #[serde(rename = "correspondents:edit")]
    CorrespondentsEdit,
    #[serde(rename = "correspondents:write")]
    CorrespondentsWrite,
    #[serde(rename = "profile:read")]
    ProfileRead,
    #[serde(rename = "profile:write")]
    ProfileWrite,
    #[serde(rename = "webdav:read")]
    WebdavRead,
    #[serde(rename = "webdav:write")]
    WebdavWrite,
    #[serde(rename = "capability_sets:read")]
    CapabilitySetsRead,
    #[serde(rename = "capability_sets:write")]
    CapabilitySetsWrite,
    #[serde(rename = "tenants:write")]
    TenantsWrite,
    #[serde(rename = "tenants:reset")]
    TenantsReset,
    #[serde(rename = "tenants:delete")]
    TenantsDelete,
}

impl MagicTokenKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            MagicTokenKind::EmailLogin => "email_login",
            MagicTokenKind::DemoLogin => "demo_login",
        }
    }

    pub fn variants() -> &'static [&'static str] {
        &["email_login", "demo_login"]
    }
}

impl ApiCapability {
    pub fn as_str(&self) -> &'static str {
        match self {
            ApiCapability::DocumentsRead => "documents:read",
            ApiCapability::DocumentsEdit => "documents:edit",
            ApiCapability::DocumentsWrite => "documents:write",
            ApiCapability::DocumentsUpload => "documents:upload",
            ApiCapability::FoldersRead => "folders:read",
            ApiCapability::FoldersEdit => "folders:edit",
            ApiCapability::FoldersWrite => "folders:write",
            ApiCapability::TagsRead => "tags:read",
            ApiCapability::TagsEdit => "tags:edit",
            ApiCapability::TagsWrite => "tags:write",
            ApiCapability::CorrespondentsRead => "correspondents:read",
            ApiCapability::CorrespondentsEdit => "correspondents:edit",
            ApiCapability::CorrespondentsWrite => "correspondents:write",
            ApiCapability::ProfileRead => "profile:read",
            ApiCapability::ProfileWrite => "profile:write",
            ApiCapability::WebdavRead => "webdav:read",
            ApiCapability::WebdavWrite => "webdav:write",
            ApiCapability::CapabilitySetsRead => "capability_sets:read",
            ApiCapability::CapabilitySetsWrite => "capability_sets:write",
            ApiCapability::TenantsWrite => "tenants:write",
            ApiCapability::TenantsReset => "tenants:reset",
            ApiCapability::TenantsDelete => "tenants:delete",
        }
    }

    pub fn variants() -> &'static [&'static str] {
        &[
            "documents:read",
            "documents:edit",
            "documents:write",
            "documents:upload",
            "folders:read",
            "folders:edit",
            "folders:write",
            "tags:read",
            "tags:edit",
            "tags:write",
            "correspondents:read",
            "correspondents:edit",
            "correspondents:write",
            "profile:read",
            "profile:write",
            "webdav:read",
            "webdav:write",
            "capability_sets:read",
            "capability_sets:write",
            "tenants:write",
            "tenants:reset",
            "tenants:delete",
        ]
    }
}

impl fmt::Display for MagicTokenKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl fmt::Display for ApiCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl ToSql<MagicTokenKindSql, Pg> for MagicTokenKind {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        out.write_all(self.as_str().as_bytes())?;
        Ok(IsNull::No)
    }
}

impl ToSql<ApiCapabilitySql, Pg> for ApiCapability {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        out.write_all(self.as_str().as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<MagicTokenKindSql, Pg> for MagicTokenKind {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match std::str::from_utf8(bytes.as_bytes())? {
            "email_login" => Ok(MagicTokenKind::EmailLogin),
            "demo_login" => Ok(MagicTokenKind::DemoLogin),
            other => Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid magic_token_kind '{other}'"),
            ))),
        }
    }
}

impl FromSql<ApiCapabilitySql, Pg> for ApiCapability {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        match std::str::from_utf8(bytes.as_bytes())? {
            "documents:read" => Ok(ApiCapability::DocumentsRead),
            "documents:edit" => Ok(ApiCapability::DocumentsEdit),
            "documents:write" => Ok(ApiCapability::DocumentsWrite),
            "documents:upload" => Ok(ApiCapability::DocumentsUpload),
            "folders:read" => Ok(ApiCapability::FoldersRead),
            "folders:edit" => Ok(ApiCapability::FoldersEdit),
            "folders:write" => Ok(ApiCapability::FoldersWrite),
            "tags:read" => Ok(ApiCapability::TagsRead),
            "tags:edit" => Ok(ApiCapability::TagsEdit),
            "tags:write" => Ok(ApiCapability::TagsWrite),
            "correspondents:read" => Ok(ApiCapability::CorrespondentsRead),
            "correspondents:edit" => Ok(ApiCapability::CorrespondentsEdit),
            "correspondents:write" => Ok(ApiCapability::CorrespondentsWrite),
            "profile:read" => Ok(ApiCapability::ProfileRead),
            "profile:write" => Ok(ApiCapability::ProfileWrite),
            "webdav:read" => Ok(ApiCapability::WebdavRead),
            "webdav:write" => Ok(ApiCapability::WebdavWrite),
            "capability_sets:read" => Ok(ApiCapability::CapabilitySetsRead),
            "capability_sets:write" => Ok(ApiCapability::CapabilitySetsWrite),
            "tenants:write" => Ok(ApiCapability::TenantsWrite),
            "tenants:reset" => Ok(ApiCapability::TenantsReset),
            "tenants:delete" => Ok(ApiCapability::TenantsDelete),
            other => Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid api_capability '{other}'"),
            ))),
        }
    }
}

impl str::FromStr for MagicTokenKind {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "email_login" => Ok(MagicTokenKind::EmailLogin),
            "demo_login" => Ok(MagicTokenKind::DemoLogin),
            _ => Err("unsupported magic token kind"),
        }
    }
}

impl str::FromStr for ApiCapability {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "documents:read" => Ok(ApiCapability::DocumentsRead),
            "documents:edit" => Ok(ApiCapability::DocumentsEdit),
            "documents:write" => Ok(ApiCapability::DocumentsWrite),
            "documents:upload" => Ok(ApiCapability::DocumentsUpload),
            "folders:read" => Ok(ApiCapability::FoldersRead),
            "folders:edit" => Ok(ApiCapability::FoldersEdit),
            "folders:write" => Ok(ApiCapability::FoldersWrite),
            "tags:read" => Ok(ApiCapability::TagsRead),
            "tags:edit" => Ok(ApiCapability::TagsEdit),
            "tags:write" => Ok(ApiCapability::TagsWrite),
            "correspondents:read" => Ok(ApiCapability::CorrespondentsRead),
            "correspondents:edit" => Ok(ApiCapability::CorrespondentsEdit),
            "correspondents:write" => Ok(ApiCapability::CorrespondentsWrite),
            "profile:read" => Ok(ApiCapability::ProfileRead),
            "profile:write" => Ok(ApiCapability::ProfileWrite),
            "webdav:read" => Ok(ApiCapability::WebdavRead),
            "webdav:write" => Ok(ApiCapability::WebdavWrite),
            "capability_sets:read" => Ok(ApiCapability::CapabilitySetsRead),
            "capability_sets:write" => Ok(ApiCapability::CapabilitySetsWrite),
            "tenants:write" => Ok(ApiCapability::TenantsWrite),
            "tenants:reset" => Ok(ApiCapability::TenantsReset),
            "tenants:delete" => Ok(ApiCapability::TenantsDelete),
            _ => Err("unsupported api capability"),
        }
    }
}

impl TenantStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TenantStatus::Creating => "creating",
            TenantStatus::Active => "active",
            TenantStatus::Suspended => "suspended",
            TenantStatus::Deleting => "deleting",
            TenantStatus::Error => "error",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "creating" => Some(TenantStatus::Creating),
            "active" => Some(TenantStatus::Active),
            "suspended" => Some(TenantStatus::Suspended),
            "deleting" => Some(TenantStatus::Deleting),
            "error" => Some(TenantStatus::Error),
            _ => None,
        }
    }
}

impl fmt::Display for TenantStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl ToSql<TenantStatusSql, Pg> for TenantStatus {
    fn to_sql<'b>(&'b self, out: &mut Output<'b, '_, Pg>) -> serialize::Result {
        out.write_all(self.as_str().as_bytes())?;
        Ok(IsNull::No)
    }
}

impl FromSql<TenantStatusSql, Pg> for TenantStatus {
    fn from_sql(bytes: PgValue<'_>) -> deserialize::Result<Self> {
        let value = str::from_utf8(bytes.as_bytes())
            .map_err(|err| Box::<dyn std::error::Error + Send + Sync>::from(err))?;
        TenantStatus::from_str(value).ok_or_else(|| {
            Box::<dyn std::error::Error + Send + Sync>::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid tenant status '{value}'"),
            ))
        })
    }
}

#[derive(Debug, Clone, Queryable, Identifiable)]
#[diesel(table_name = tenants)]
#[diesel(primary_key(id))]
pub struct Tenant {
    pub id: Uuid,
    pub name: String,
    pub storage_root: Option<String>,
    pub quickwit_index: Option<String>,
    pub config: Value,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub status: TenantStatus,
    pub created_by: Option<Uuid>,
}

#[derive(Debug, Clone, Queryable, Identifiable)]
#[diesel(table_name = users)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = users)]
pub struct NewUser {
    pub id: Uuid,
    pub username: String,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations, Selectable)]
#[diesel(table_name = user_passkeys)]
#[diesel(belongs_to(User))]
pub struct UserPasskey {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub credential: serde_json::Value,
    pub sign_count: i64,
    pub transports: Vec<Option<String>>,
    pub aaguid: Option<Uuid>,
    pub nickname: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub last_used_at: Option<NaiveDateTime>,
    pub revoked_at: Option<NaiveDateTime>,
    pub revoked_by: Option<Uuid>,
    pub revoked_reason: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = user_passkeys)]
pub struct NewUserPasskey {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub credential: serde_json::Value,
    pub sign_count: i64,
    pub transports: Vec<Option<String>>,
    pub aaguid: Option<Uuid>,
    pub nickname: Option<String>,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = webauthn_challenges)]
#[diesel(belongs_to(User))]
pub struct WebauthnChallenge {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub purpose: String,
    pub challenge: Vec<u8>,
    pub state: Vec<u8>,
    pub created_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = webauthn_challenges)]
pub struct NewWebauthnChallenge {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub purpose: String,
    pub challenge: Vec<u8>,
    pub state: Vec<u8>,
    pub expires_at: NaiveDateTime,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = api_tokens)]
#[diesel(belongs_to(User))]
#[diesel(belongs_to(Tenant))]
pub struct ApiToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub token_prefix: String,
    pub token_hash: String,
    pub label: Option<String>,
    pub created_at: NaiveDateTime,
    pub last_used_at: Option<NaiveDateTime>,
    pub expires_at: Option<NaiveDateTime>,
    pub revoked_at: Option<NaiveDateTime>,
    pub capability_set_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = capability_sets)]
#[diesel(belongs_to(Tenant))]
pub struct CapabilitySet {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub slug: String,
    pub cap_version: i32,
    pub is_system: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = capability_sets)]
pub struct NewCapabilitySet {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub slug: String,
    pub cap_version: i32,
    pub is_system: bool,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = capability_set_capabilities)]
#[diesel(primary_key(capability_set_id, capability))]
#[diesel(belongs_to(CapabilitySet, foreign_key = capability_set_id))]
pub struct CapabilitySetCapability {
    pub capability_set_id: Uuid,
    pub capability: ApiCapability,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = capability_set_capabilities)]
pub struct NewCapabilitySetCapability {
    pub capability_set_id: Uuid,
    pub capability: ApiCapability,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = api_tokens)]
pub struct NewApiToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub tenant_id: Uuid,
    pub token_prefix: String,
    pub token_hash: String,
    pub label: Option<String>,
    pub expires_at: Option<NaiveDateTime>,
    pub capability_set_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable)]
#[diesel(table_name = folders)]
pub struct Folder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = folders)]
pub struct NewFolder {
    pub id: Uuid,
    pub name: String,
    pub parent_id: Option<Uuid>,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = documents)]
#[diesel(belongs_to(Folder, foreign_key = folder_id))]
pub struct Document {
    pub id: Uuid,
    pub filename: String,
    pub original_name: String,
    pub mime_type: Option<String>,
    pub folder_id: Option<Uuid>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub deleted_at: Option<NaiveDateTime>,
    pub metadata: serde_json::Value,
    pub issued_at: Option<NaiveDateTime>,
    pub title: String,
    pub current_version_id: Uuid,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = documents)]
pub struct NewDocument {
    pub id: Uuid,
    pub filename: String,
    pub original_name: String,
    pub mime_type: Option<String>,
    pub folder_id: Option<Uuid>,
    pub current_version_id: Uuid,
    pub metadata: serde_json::Value,
    pub issued_at: Option<NaiveDateTime>,
    pub title: String,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable, Insertable)]
#[diesel(table_name = magic_tokens)]
pub struct MagicToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub kind: MagicTokenKind,
    pub token_hash: String,
    pub metadata: serde_json::Value,
    pub expires_at: NaiveDateTime,
    pub max_uses: Option<i32>,
    pub used_count: i32,
    pub created_at: NaiveDateTime,
    pub created_by: Option<Uuid>,
    pub last_used_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = document_versions)]
#[diesel(belongs_to(Document))]
pub struct DocumentVersion {
    pub id: Uuid,
    pub document_id: Uuid,
    pub version_number: i32,
    pub s3_key: String,
    pub size_bytes: i64,
    pub checksum: String,
    pub created_at: NaiveDateTime,
    pub metadata: serde_json::Value,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = document_versions)]
pub struct NewDocumentVersion {
    pub id: Uuid,
    pub document_id: Uuid,
    pub version_number: i32,
    pub s3_key: String,
    pub size_bytes: i64,
    pub checksum: String,
    pub metadata: serde_json::Value,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = document_assets)]
#[diesel(belongs_to(DocumentVersion, foreign_key = document_version_id))]
pub struct DocumentAsset {
    pub id: Uuid,
    pub document_version_id: Uuid,
    pub asset_type: String,
    pub mime_type: String,
    pub metadata: serde_json::Value,
    pub created_at: NaiveDateTime,
    pub s3_key: String,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = document_assets)]
pub struct NewDocumentAsset {
    pub id: Uuid,
    pub document_version_id: Uuid,
    pub asset_type: String,
    pub mime_type: String,
    pub metadata: serde_json::Value,
    pub s3_key: String,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable)]
#[diesel(table_name = jobs)]
pub struct Job {
    pub id: Uuid,
    pub job_type: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub attempts: i32,
    pub run_after: NaiveDateTime,
    pub last_error: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub tenant_id: Option<Uuid>,
    pub result: Option<serde_json::Value>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = jobs)]
pub struct NewJob {
    pub id: Uuid,
    pub job_type: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub run_after: NaiveDateTime,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable)]
#[diesel(table_name = tags)]
pub struct Tag {
    pub id: Uuid,
    pub label: String,
    pub color: Option<String>,
    pub created_at: NaiveDateTime,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = tags)]
pub struct NewTag {
    pub id: Uuid,
    pub label: String,
    pub color: Option<String>,
    pub tenant_id: Uuid,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Associations)]
#[diesel(table_name = document_tags)]
#[diesel(belongs_to(Document))]
#[diesel(belongs_to(Tag))]
#[diesel(primary_key(document_id, tag_id))]
pub struct DocumentTag {
    pub document_id: Uuid,
    pub tag_id: Uuid,
    pub assigned_at: NaiveDateTime,
    pub assigned_by: Option<Uuid>,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = document_tags)]
pub struct NewDocumentTag {
    pub document_id: Uuid,
    pub tag_id: Uuid,
    pub assigned_by: Option<Uuid>,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable)]
#[diesel(table_name = correspondents)]
pub struct Correspondent {
    pub id: Uuid,
    pub name: String,
    pub metadata: serde_json::Value,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = correspondents)]
pub struct NewCorrespondent {
    pub id: Uuid,
    pub name: String,
    pub metadata: serde_json::Value,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Associations)]
#[diesel(table_name = document_correspondents)]
#[diesel(belongs_to(Document))]
#[diesel(belongs_to(Correspondent))]
#[diesel(primary_key(document_id, correspondent_id))]
pub struct DocumentCorrespondent {
    pub document_id: Uuid,
    pub correspondent_id: Uuid,
    pub assigned_at: NaiveDateTime,
    pub assigned_by: Option<Uuid>,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = document_correspondents)]
pub struct NewDocumentCorrespondent {
    pub document_id: Uuid,
    pub correspondent_id: Uuid,
    pub assigned_by: Option<Uuid>,
    pub tenant_id: Uuid,
}

#[derive(Debug, Clone, Queryable, Identifiable, Associations)]
#[diesel(table_name = user_sessions)]
#[diesel(belongs_to(User))]
pub struct UserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub issued_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
    pub revoked_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    pub tenant_id: Uuid,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = user_sessions)]
pub struct NewUserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub issued_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
    pub tenant_id: Uuid,
}
