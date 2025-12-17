use chrono::Utc;
use diesel::{pg::Pg, prelude::*, Connection};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::AppError,
    models::{ApiCapability, CapabilitySet, NewCapabilitySet, NewCapabilitySetCapability},
    schema::{
        capability_set_capabilities, capability_set_capabilities::dsl as csc_dsl, capability_sets,
        capability_sets::dsl as cs_dsl,
    },
};

const OWNER_CAPABILITIES: [ApiCapability; 22] = [
    ApiCapability::CorrespondentsEdit,
    ApiCapability::CorrespondentsRead,
    ApiCapability::CorrespondentsWrite,
    ApiCapability::DocumentsEdit,
    ApiCapability::DocumentsRead,
    ApiCapability::DocumentsUpload,
    ApiCapability::DocumentsWrite,
    ApiCapability::FoldersEdit,
    ApiCapability::FoldersRead,
    ApiCapability::FoldersWrite,
    ApiCapability::ProfileRead,
    ApiCapability::ProfileWrite,
    ApiCapability::TagsEdit,
    ApiCapability::TagsRead,
    ApiCapability::TagsWrite,
    ApiCapability::WebdavRead,
    ApiCapability::WebdavWrite,
    ApiCapability::CapabilitySetsRead,
    ApiCapability::CapabilitySetsWrite,
    ApiCapability::TenantsWrite,
    ApiCapability::TenantsReset,
    ApiCapability::TenantsDelete,
];

const USER_CAPABILITIES: [ApiCapability; 16] = [
    ApiCapability::CorrespondentsEdit,
    ApiCapability::CorrespondentsRead,
    ApiCapability::CorrespondentsWrite,
    ApiCapability::DocumentsEdit,
    ApiCapability::DocumentsRead,
    ApiCapability::DocumentsUpload,
    ApiCapability::DocumentsWrite,
    ApiCapability::FoldersEdit,
    ApiCapability::FoldersRead,
    ApiCapability::FoldersWrite,
    ApiCapability::ProfileRead,
    ApiCapability::ProfileWrite,
    ApiCapability::TagsEdit,
    ApiCapability::TagsRead,
    ApiCapability::TagsWrite,
    ApiCapability::WebdavRead,
];

const READONLY_CAPABILITIES: [ApiCapability; 5] = [
    ApiCapability::CorrespondentsRead,
    ApiCapability::DocumentsRead,
    ApiCapability::FoldersRead,
    ApiCapability::TagsRead,
    ApiCapability::WebdavRead,
];

const WEBDAV_CAPABILITIES: [ApiCapability; 1] = [ApiCapability::WebdavRead];

pub fn owner_capabilities() -> &'static [ApiCapability] {
    &OWNER_CAPABILITIES
}

pub fn user_capabilities() -> &'static [ApiCapability] {
    &USER_CAPABILITIES
}

pub fn readonly_capabilities() -> &'static [ApiCapability] {
    &READONLY_CAPABILITIES
}

pub fn webdav_capabilities() -> &'static [ApiCapability] {
    &WEBDAV_CAPABILITIES
}

pub fn is_system_slug(slug: &str) -> bool {
    matches!(slug, "owner" | "user" | "readonly" | "webdav")
}

pub fn create_capability_set<C>(
    conn: &mut C,
    tenant_id: Uuid,
    slug: &str,
    capabilities: Vec<ApiCapability>,
) -> Result<CapabilitySet, AppError>
where
    C: Connection<Backend = Pg> + diesel::connection::LoadConnection,
{
    let normalized = normalize_capabilities(capabilities)?;

    conn.transaction::<CapabilitySet, AppError, _>(|conn| {
        if cs_dsl::capability_sets
            .filter(cs_dsl::tenant_id.eq(tenant_id))
            .filter(cs_dsl::slug.eq(slug))
            .first::<CapabilitySet>(conn)
            .optional()
            .map_err(AppError::from)?
            .is_some()
        {
            return Err(AppError::conflict("capability set slug already exists"));
        }

        let set = NewCapabilitySet {
            id: Uuid::new_v4(),
            tenant_id,
            slug: slug.to_owned(),
            cap_version: 1,
            is_system: false,
        };

        diesel::insert_into(capability_sets::table)
            .values(&set)
            .execute(conn)
            .map_err(AppError::from)?;

        persist_capabilities(conn, set.id, &normalized)?;

        capability_sets::table
            .find(set.id)
            .first::<CapabilitySet>(conn)
            .map_err(AppError::from)
    })
}

pub fn normalize_capabilities(
    mut capabilities: Vec<ApiCapability>,
) -> Result<Vec<ApiCapability>, AppError> {
    if capabilities.is_empty() {
        return Err(AppError::bad_request("at least one capability is required"));
    }

    capabilities.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    capabilities.dedup();
    Ok(capabilities)
}

pub fn load_capabilities_for_set<C>(
    conn: &mut C,
    capability_set_id: Uuid,
) -> Result<Vec<ApiCapability>, AppError>
where
    C: Connection<Backend = Pg> + diesel::connection::LoadConnection,
{
    let mut capabilities: Vec<ApiCapability> = csc_dsl::capability_set_capabilities
        .filter(csc_dsl::capability_set_id.eq(capability_set_id))
        .select(csc_dsl::capability)
        .load(conn)
        .map_err(AppError::from)?;

    capabilities.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    Ok(capabilities)
}

pub fn ensure_capability_set<C>(
    conn: &mut C,
    tenant_id: Uuid,
    capabilities: &[ApiCapability],
) -> Result<CapabilitySet, AppError>
where
    C: Connection<Backend = Pg> + diesel::connection::LoadConnection,
{
    if capabilities.is_empty() {
        return Err(AppError::bad_request("at least one capability is required"));
    }

    let slug = compute_slug(capabilities);
    conn.transaction::<CapabilitySet, AppError, _>(|conn| {
        if let Some(existing) = cs_dsl::capability_sets
            .filter(cs_dsl::tenant_id.eq(tenant_id))
            .filter(cs_dsl::slug.eq(&slug))
            .first::<CapabilitySet>(conn)
            .optional()
            .map_err(AppError::from)?
        {
            ensure_capability_membership(conn, &existing, capabilities)?;
            return Ok(existing);
        }

        let set = NewCapabilitySet {
            id: Uuid::new_v4(),
            tenant_id,
            slug: slug.clone(),
            cap_version: 1,
            is_system: matches!(slug.as_str(), "owner" | "user" | "readonly" | "webdav"),
        };

        diesel::insert_into(capability_sets::table)
            .values(&set)
            .execute(conn)
            .map_err(AppError::from)?;

        persist_capabilities(conn, set.id, capabilities)?;

        Ok(capability_sets::table
            .find(set.id)
            .first::<CapabilitySet>(conn)
            .map_err(AppError::from)?)
    })
}

pub fn refresh_capability_set<C>(
    conn: &mut C,
    set: &CapabilitySet,
    capabilities: &[ApiCapability],
) -> Result<CapabilitySet, AppError>
where
    C: Connection<Backend = Pg> + diesel::connection::LoadConnection,
{
    conn.transaction::<CapabilitySet, AppError, _>(|conn| {
        diesel::delete(
            csc_dsl::capability_set_capabilities.filter(csc_dsl::capability_set_id.eq(set.id)),
        )
        .execute(conn)
        .map_err(AppError::from)?;

        persist_capabilities(conn, set.id, capabilities)?;

        diesel::update(capability_sets::table.find(set.id))
            .set((
                cs_dsl::cap_version.eq(set.cap_version + 1),
                cs_dsl::updated_at.eq(Utc::now().naive_utc()),
            ))
            .execute(conn)
            .map_err(AppError::from)?;

        capability_sets::table
            .find(set.id)
            .first::<CapabilitySet>(conn)
            .map_err(AppError::from)
    })
}

pub fn load_capability_set<C>(conn: &mut C, id: Uuid) -> Result<CapabilitySet, AppError>
where
    C: Connection<Backend = Pg> + diesel::connection::LoadConnection,
{
    capability_sets::table
        .find(id)
        .first::<CapabilitySet>(conn)
        .map_err(AppError::from)
}

pub fn compute_slug(capabilities: &[ApiCapability]) -> String {
    if capabilities == owner_capabilities() {
        return "owner".to_string();
    }

    if capabilities == user_capabilities() {
        return "user".to_string();
    }

    if capabilities == readonly_capabilities() {
        return "readonly".to_string();
    }

    if capabilities == webdav_capabilities() {
        return "webdav".to_string();
    }

    let joined = capabilities
        .iter()
        .map(|cap| cap.as_str())
        .collect::<Vec<_>>()
        .join(",");

    let digest = Sha256::digest(joined.as_bytes());
    let hex = hex::encode(digest);
    format!("caps-{}", &hex[..12])
}

fn ensure_capability_membership<C>(
    conn: &mut C,
    set: &CapabilitySet,
    desired: &[ApiCapability],
) -> Result<(), AppError>
where
    C: Connection<Backend = Pg> + diesel::connection::LoadConnection,
{
    let current = load_capabilities_for_set(conn, set.id)?;
    if current == desired {
        return Ok(());
    }

    let _ = refresh_capability_set(conn, set, desired)?;
    Ok(())
}

fn persist_capabilities<C>(
    conn: &mut C,
    set_id: Uuid,
    capabilities: &[ApiCapability],
) -> Result<(), AppError>
where
    C: Connection<Backend = Pg> + diesel::connection::LoadConnection,
{
    if capabilities.is_empty() {
        return Err(AppError::bad_request("at least one capability is required"));
    }

    let records: Vec<NewCapabilitySetCapability> = capabilities
        .iter()
        .map(|cap| NewCapabilitySetCapability {
            capability_set_id: set_id,
            capability: *cap,
        })
        .collect();

    diesel::insert_into(capability_set_capabilities::table)
        .values(&records)
        .execute(conn)
        .map_err(AppError::from)?;

    Ok(())
}
