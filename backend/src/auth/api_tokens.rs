use argon2::{
    password_hash::{rand_core::OsRng as PasswordHashOsRng, PasswordHasher, SaltString},
    Argon2,
};
use chrono::{NaiveDateTime, Utc};
use diesel::{pg::PgConnection, prelude::*};
use rand::{rngs::OsRng, TryRngCore};
use uuid::Uuid;

use crate::{
    auth::capability_sets::{load_capabilities_for_set, load_capability_set},
    error::AppError,
    models::{ApiCapability, ApiToken, CapabilitySet, NewApiToken},
    schema::api_tokens,
    state::PgPooledConnection,
    tenants::{ApiTokenPrefix, ScopedTransaction},
};

use crate::schema::api_tokens::dsl as api_tokens_dsl;

const TOKEN_PREFIX_LENGTH: usize = 12;
const TOKEN_SECRET_LENGTH: usize = 32;

/// Represents a newly issued API token and the raw secret that was generated for it.
pub struct IssuedApiToken {
    pub token: String,
    pub record: ApiToken,
}

/// Creates a new API token for the supplied user/tenant combination.
pub fn create_api_token(
    conn: &mut PgConnection,
    user_id: Uuid,
    tenant_id: Uuid,
    label: Option<String>,
    expires_at: Option<NaiveDateTime>,
    capability_set_id: Uuid,
) -> Result<IssuedApiToken, AppError> {
    let capability_set =
        validate_capability_set_belongs_to_tenant(conn, capability_set_id, tenant_id)?;

    let raw_secret = generate_secret()?;
    let token_prefix = raw_secret[..TOKEN_PREFIX_LENGTH].to_string();
    let token_hash = hash_secret(&raw_secret)?;
    let new_token = NewApiToken {
        id: Uuid::new_v4(),
        user_id,
        tenant_id,
        token_prefix,
        token_hash,
        label,
        expires_at,
        capability_set_id: capability_set.id,
    };

    let record = diesel::insert_into(api_tokens::table)
        .values(&new_token)
        .get_result::<ApiToken>(conn)?;

    Ok(IssuedApiToken {
        token: raw_secret,
        record,
    })
}

/// Lists API tokens belonging to a user within an optional tenant scope.
pub fn list_api_tokens(
    conn: &mut PgConnection,
    user_id: Uuid,
    tenant_id: Option<Uuid>,
) -> Result<Vec<ApiToken>, AppError> {
    let mut query = api_tokens::table
        .filter(api_tokens::user_id.eq(user_id))
        .into_boxed();

    if let Some(tenant_id) = tenant_id {
        query = query.filter(api_tokens::tenant_id.eq(tenant_id));
    }

    let tokens = query
        .order(api_tokens::created_at.asc())
        .load::<ApiToken>(conn)?;

    Ok(tokens)
}

/// Regenerates the secret value for an API token.
pub fn regenerate_api_token(
    conn: &mut PgConnection,
    token_id: Uuid,
    user_id: Uuid,
    tenant_id: Option<Uuid>,
) -> Result<IssuedApiToken, AppError> {
    let record = find_user_token(conn, token_id, user_id, tenant_id)?;

    if record.revoked_at.is_some() {
        return Err(AppError::bad_request(
            "cannot regenerate a revoked API token",
        ));
    }

    let raw_secret = generate_secret()?;
    let token_prefix = raw_secret[..TOKEN_PREFIX_LENGTH].to_string();
    let token_hash = hash_secret(&raw_secret)?;

    let updated = diesel::update(api_tokens::table.find(record.id))
        .set((
            api_tokens::token_prefix.eq(&token_prefix),
            api_tokens::token_hash.eq(&token_hash),
            api_tokens::last_used_at.eq::<Option<NaiveDateTime>>(None),
        ))
        .get_result::<ApiToken>(conn)?;

    Ok(IssuedApiToken {
        token: raw_secret,
        record: updated,
    })
}

/// Attempts to resolve an API token by its secret value while ensuring it provides the
/// requested capability.
pub fn find_active_token_by_secret(
    conn: &mut PgPooledConnection,
    tenant_id: Option<Uuid>,
    secret: &str,
    required_capability: Option<ApiCapability>,
) -> Result<Option<ApiToken>, AppError> {
    if secret.len() < TOKEN_PREFIX_LENGTH {
        return Ok(None);
    }

    let prefix = &secret[..TOKEN_PREFIX_LENGTH];
    let candidates = with_api_token_prefix(conn, prefix, |conn| {
        let mut query = api_tokens::table
            .filter(api_tokens::token_prefix.eq(prefix))
            .filter(api_tokens::revoked_at.is_null())
            .into_boxed();

        let now = Utc::now().naive_utc();
        query = query.filter(
            api_tokens::expires_at
                .is_null()
                .or(api_tokens::expires_at.gt(now)),
        );

        if let Some(tenant_id) = tenant_id {
            query = query.filter(api_tokens::tenant_id.eq(tenant_id));
        }

        query.load::<ApiToken>(conn).map_err(AppError::from)
    })?;

    for token in candidates {
        if let Some(required) = required_capability {
            let capabilities = load_capabilities_for_set(conn, token.capability_set_id)?;
            if !capabilities.contains(&required) {
                continue;
            }
        }

        if verify_token_secret(secret, &token.token_hash)? {
            return Ok(Some(token));
        }
    }

    Ok(None)
}

/// Revokes an API token belonging to the specified user.
pub fn revoke_api_token(
    conn: &mut PgConnection,
    token_id: Uuid,
    user_id: Uuid,
) -> Result<(), AppError> {
    let token = find_user_token(conn, token_id, user_id, None)?;

    diesel::update(api_tokens::table.find(token.id))
        .set(api_tokens::revoked_at.eq(Utc::now().naive_utc()))
        .execute(conn)?;

    Ok(())
}

/// Updates the last-used timestamp for a token.
pub fn touch_api_token(conn: &mut PgConnection, token_id: Uuid) -> Result<(), AppError> {
    diesel::update(api_tokens::table.filter(api_tokens::id.eq(token_id)))
        .set(api_tokens::last_used_at.eq(Utc::now().naive_utc()))
        .execute(conn)?;
    Ok(())
}

/// Verifies a secret against its stored hash representation.
pub fn verify_token_secret(secret: &str, token_hash: &str) -> Result<bool, AppError> {
    crate::auth::password::verify_password(secret, token_hash).map_err(|err| {
        tracing::error!(error = ?err, "failed to verify token");
        AppError::internal("failed to verify token")
    })
}

fn find_user_token(
    conn: &mut PgConnection,
    token_id: Uuid,
    user_id: Uuid,
    tenant_id: Option<Uuid>,
) -> Result<ApiToken, AppError> {
    let mut query = api_tokens_dsl::api_tokens
        .filter(api_tokens_dsl::id.eq(token_id))
        .filter(api_tokens_dsl::user_id.eq(user_id))
        .into_boxed();

    if let Some(tid) = tenant_id {
        query = query.filter(api_tokens_dsl::tenant_id.eq(tid));
    }

    query
        .first::<ApiToken>(conn)
        .optional()
        .map_err(AppError::from)?
        .ok_or_else(AppError::not_found)
}

fn validate_capability_set_belongs_to_tenant(
    conn: &mut PgConnection,
    capability_set_id: Uuid,
    tenant_id: Uuid,
) -> Result<CapabilitySet, AppError> {
    let capability_set = load_capability_set(conn, capability_set_id)?;
    if capability_set.tenant_id != tenant_id {
        return Err(AppError::bad_request(
            "capability set does not belong to the tenant",
        ));
    }

    Ok(capability_set)
}

fn with_api_token_prefix<T, F>(
    conn: &mut PgPooledConnection,
    prefix: &str,
    operation: F,
) -> Result<T, AppError>
where
    F: FnOnce(&mut PgConnection) -> Result<T, AppError>,
{
    conn.scoped(ApiTokenPrefix(prefix), operation)
}

fn generate_secret() -> Result<String, AppError> {
    let mut buffer = [0u8; TOKEN_SECRET_LENGTH];
    OsRng.try_fill_bytes(&mut buffer).map_err(|err| {
        tracing::error!(error = ?err, "failed to generate token");
        AppError::internal("failed to generate token")
    })?;
    Ok(hex::encode(buffer))
}

fn hash_secret(secret: &str) -> Result<String, AppError> {
    let mut salt_rng = PasswordHashOsRng;
    let salt = SaltString::generate(&mut salt_rng);
    let hash = Argon2::default()
        .hash_password(secret.as_bytes(), &salt)
        .map_err(|err| {
            tracing::error!(error = ?err, "failed to hash token");
            AppError::internal("failed to hash token")
        })?;
    Ok(hash.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::capability_sets::{
        compute_slug, normalize_capabilities, owner_capabilities, webdav_capabilities,
    };

    #[test]
    fn generated_secret_has_expected_length() {
        let secret = generate_secret().unwrap();
        assert_eq!(secret.len(), TOKEN_SECRET_LENGTH * 2);
    }

    #[test]
    fn hash_and_verify_secret_round_trip() {
        let secret = generate_secret().unwrap();
        let hash = hash_secret(&secret).unwrap();
        assert!(verify_token_secret(&secret, &hash).unwrap());
        assert!(!verify_token_secret("wrong", &hash).unwrap());
    }

    #[test]
    fn normalize_capabilities_deduplicates() {
        let mut caps = owner_capabilities().to_vec();
        caps.push(ApiCapability::DocumentsRead);
        let normalized = normalize_capabilities(caps).unwrap();
        assert_eq!(normalized.len(), owner_capabilities().len());
    }

    #[test]
    fn normalize_capabilities_rejects_empty() {
        assert!(normalize_capabilities(Vec::new()).is_err());
    }

    #[test]
    fn compute_slug_matches_system_sets() {
        let owner_slug = compute_slug(owner_capabilities());
        assert_eq!(owner_slug, "owner");

        let webdav_slug = compute_slug(webdav_capabilities());
        assert_eq!(webdav_slug, "webdav");
    }

    #[test]
    fn prefix_length_is_less_than_secret_length() {
        assert!(TOKEN_PREFIX_LENGTH < TOKEN_SECRET_LENGTH * 2);
    }
}
