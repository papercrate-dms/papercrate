use std::sync::Arc;

use anyhow::{Context, Result};
use chrono::{Duration as ChronoDuration, NaiveDateTime, Utc};
use diesel::{dsl::count_star, prelude::*};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use webauthn_rs::prelude::{Credential, *};

use crate::{
    config::AppConfig,
    error::{AppError, AppResult},
    models::{NewUserPasskey, NewWebauthnChallenge, User, UserPasskey, WebauthnChallenge},
    schema::{user_passkeys::dsl as passkey_dsl, webauthn_challenges::dsl as challenge_dsl},
};

const PURPOSE_REGISTRATION: &str = "registration";
const PURPOSE_AUTHENTICATION: &str = "authentication";
const DEFAULT_CHALLENGE_TTL_MINUTES: i64 = 10;

#[derive(Clone)]
pub struct PasskeyService {
    webauthn: Arc<Webauthn>,
    challenge_ttl: ChronoDuration,
}

pub struct PreparedPasskey {
    pub id: Uuid,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub credential: serde_json::Value,
    pub sign_count: i64,
    pub transports: Vec<Option<String>>,
    pub aaguid: Option<Uuid>,
}

impl PreparedPasskey {
    pub fn into_new_user_passkey(self, user_id: Uuid, nickname: Option<String>) -> NewUserPasskey {
        NewUserPasskey {
            id: self.id,
            user_id,
            credential_id: self.credential_id,
            public_key: self.public_key,
            credential: self.credential,
            sign_count: self.sign_count,
            transports: self.transports,
            aaguid: self.aaguid,
            nickname,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationChallengeResponse {
    pub challenge_id: Uuid,
    #[serde(flatten)]
    #[schema(value_type = Object)]
    pub challenge: CreationChallengeResponse,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticationChallengeResponse {
    pub challenge_id: Uuid,
    #[serde(flatten)]
    #[schema(value_type = Object)]
    pub challenge: RequestChallengeResponse,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PasskeySummary {
    pub id: Uuid,
    pub nickname: Option<String>,
    pub created_at: NaiveDateTime,
    pub last_used_at: Option<NaiveDateTime>,
    pub transports: Vec<String>,
    pub revoked_at: Option<NaiveDateTime>,
    pub revoked_reason: Option<String>,
}

impl PasskeyService {
    pub fn try_new(config: &AppConfig) -> Result<Option<Self>> {
        let rp_id = match config.webauthn_rp_id.as_deref().map(str::trim) {
            Some(rp_id) if !rp_id.is_empty() => rp_id,
            _ => return Ok(None),
        };
        let rp_origin = match config.webauthn_origin.as_ref().map(|s| s.trim()) {
            Some(origin) if !origin.is_empty() => origin,
            _ => return Ok(None),
        };

        let origin = Url::parse(rp_origin).context("invalid webauthn_origin")?;

        let builder = WebauthnBuilder::new(rp_id, &origin)
            .context("failed to initialise WebAuthn builder")?
            .rp_name(&config.webauthn_rp_name)
            .allow_subdomains(false)
            .allow_any_port(false);

        let webauthn = builder
            .build()
            .context("failed to build WebAuthn instance")?;

        Ok(Some(Self {
            webauthn: Arc::new(webauthn),
            challenge_ttl: ChronoDuration::minutes(DEFAULT_CHALLENGE_TTL_MINUTES),
        }))
    }

    fn prune_expired(&self, conn: &mut PgConnection) {
        let now = Utc::now().naive_utc();
        let _ = diesel::delete(
            challenge_dsl::webauthn_challenges.filter(challenge_dsl::expires_at.le(now)),
        )
        .execute(conn);
    }

    fn begin_registration(
        &self,
        conn: &mut PgConnection,
        user_id: Uuid,
        username: &str,
        challenge_user_id: Option<Uuid>,
        exclude: Option<Vec<CredentialID>>,
    ) -> AppResult<RegistrationChallengeResponse> {
        self.prune_expired(conn);

        let (challenge, state) = self
            .webauthn
            .start_passkey_registration(user_id, username, username, exclude)
            .map_err(|err| {
                tracing::error!(error = %err, "failed to start passkey registration");
                AppError::internal("failed to start passkey registration")
            })?;

        let challenge_id = Uuid::new_v4();
        let expires_at = (Utc::now() + self.challenge_ttl).naive_utc();
        let challenge_bytes: Vec<u8> = challenge.public_key.challenge.clone().into();
        let state_bytes = serde_json::to_vec(&state)
            .context("failed to encode passkey registration state")
            .map_err(AppError::internal)?;

        let record = NewWebauthnChallenge {
            id: challenge_id,
            user_id: challenge_user_id,
            purpose: PURPOSE_REGISTRATION.to_string(),
            challenge: challenge_bytes,
            state: state_bytes,
            expires_at,
        };

        diesel::insert_into(challenge_dsl::webauthn_challenges)
            .values(&record)
            .execute(conn)?;

        Ok(RegistrationChallengeResponse {
            challenge_id,
            challenge,
        })
    }

    pub fn start_registration(
        &self,
        conn: &mut PgConnection,
        user: &User,
    ) -> AppResult<RegistrationChallengeResponse> {
        let existing: Vec<UserPasskey> = passkey_dsl::user_passkeys
            .filter(passkey_dsl::user_id.eq(user.id))
            .filter(passkey_dsl::revoked_at.is_null())
            .load(conn)?;

        let exclude = if existing.is_empty() {
            None
        } else {
            Some(
                existing
                    .iter()
                    .map(|pk| CredentialID::from(pk.credential_id.clone()))
                    .collect(),
            )
        };

        self.begin_registration(conn, user.id, &user.username, Some(user.id), exclude)
    }

    pub fn start_signup_registration(
        &self,
        conn: &mut PgConnection,
        user_id: Uuid,
        username: &str,
    ) -> AppResult<RegistrationChallengeResponse> {
        self.begin_registration(conn, user_id, username, None, None)
    }

    fn complete_registration(
        &self,
        conn: &mut PgConnection,
        challenge_id: Uuid,
        credential: &RegisterPublicKeyCredential,
        expected_user: Option<Uuid>,
    ) -> AppResult<PreparedPasskey> {
        let record: WebauthnChallenge = challenge_dsl::webauthn_challenges
            .find(challenge_id)
            .first(conn)
            .map_err(|err| {
                if matches!(err, diesel::result::Error::NotFound) {
                    AppError::bad_request("challenge not found")
                } else {
                    AppError::from(err)
                }
            })?;

        if record.purpose != PURPOSE_REGISTRATION {
            return Err(AppError::bad_request("challenge is not for registration"));
        }

        if let Some(expected) = expected_user {
            if record.user_id != Some(expected) {
                return Err(AppError::unauthorized());
            }
        } else if record.user_id.is_some() {
            return Err(AppError::bad_request(
                "unexpected user context for signup registration",
            ));
        }

        if record.expires_at < Utc::now().naive_utc() {
            diesel::delete(challenge_dsl::webauthn_challenges.find(challenge_id)).execute(conn)?;
            return Err(AppError::bad_request("challenge expired"));
        }

        let state: PasskeyRegistration = serde_json::from_slice(&record.state)
            .context("failed to decode registration state")
            .map_err(AppError::internal)?;

        let passkey = self
            .webauthn
            .finish_passkey_registration(credential, &state)
            .map_err(|err| {
                tracing::warn!(error = %err, "passkey registration validation failed");
                AppError::bad_request("invalid passkey attestation")
            })?;

        let credential_struct: Credential = passkey.clone().into();
        let credential_id_vec: Vec<u8> = credential_struct.cred_id.clone().into();

        let duplicate = passkey_dsl::user_passkeys
            .filter(passkey_dsl::credential_id.eq(&credential_id_vec))
            .first::<UserPasskey>(conn)
            .optional()?;
        if duplicate.is_some() {
            diesel::delete(challenge_dsl::webauthn_challenges.find(challenge_id)).execute(conn)?;
            return Err(AppError::conflict("credential already registered"));
        }

        let public_key_bytes = serde_cbor_2::to_vec(&credential_struct.cred)
            .context("failed to encode credential public key")
            .map_err(AppError::internal)?;

        let transports: Vec<Option<String>> = credential_struct
            .transports
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|transport| Some(transport.as_ref().to_string()))
            .collect();

        let aaguid = match credential_struct.attestation.metadata {
            AttestationMetadata::Packed { aaguid } | AttestationMetadata::Tpm { aaguid, .. } => {
                Some(aaguid)
            }
            _ => None,
        };

        let credential_json = serde_json::to_value(&passkey)
            .context("failed to serialise passkey")
            .map_err(AppError::internal)?;

        diesel::delete(challenge_dsl::webauthn_challenges.find(challenge_id)).execute(conn)?;

        Ok(PreparedPasskey {
            id: Uuid::new_v4(),
            credential_id: credential_id_vec,
            public_key: public_key_bytes,
            credential: credential_json,
            sign_count: credential_struct.counter as i64,
            transports,
            aaguid,
        })
    }

    pub fn finish_registration(
        &self,
        conn: &mut PgConnection,
        user: &User,
        challenge_id: Uuid,
        credential: RegisterPublicKeyCredential,
        nickname: Option<String>,
    ) -> AppResult<UserPasskey> {
        let prepared =
            self.complete_registration(conn, challenge_id, &credential, Some(user.id))?;

        let new_passkey = prepared.into_new_user_passkey(user.id, nickname);

        diesel::insert_into(passkey_dsl::user_passkeys)
            .values(&new_passkey)
            .execute(conn)?;

        let created: UserPasskey = passkey_dsl::user_passkeys
            .find(new_passkey.id)
            .select(UserPasskey::as_select())
            .first(conn)?;

        Ok(created)
    }

    pub fn start_authentication(
        &self,
        conn: &mut PgConnection,
        user: &User,
    ) -> AppResult<AuthenticationChallengeResponse> {
        self.prune_expired(conn);

        let stored: Vec<UserPasskey> = passkey_dsl::user_passkeys
            .filter(passkey_dsl::user_id.eq(user.id))
            .filter(passkey_dsl::revoked_at.is_null())
            .select(UserPasskey::as_select())
            .load(conn)?;

        if stored.is_empty() {
            return Err(AppError::bad_request("no passkeys registered"));
        }

        let mut passkeys = Vec::with_capacity(stored.len());
        for pk in &stored {
            let passkey: Passkey = serde_json::from_value(pk.credential.clone())
                .context("failed to parse stored passkey")
                .map_err(AppError::internal)?;
            passkeys.push(passkey);
        }

        let (challenge, state) = self
            .webauthn
            .start_passkey_authentication(&passkeys)
            .map_err(|err| {
                tracing::error!(error = %err, "failed to start passkey authentication");
                AppError::internal("failed to start passkey authentication")
            })?;

        let challenge_id = Uuid::new_v4();
        let expires_at = (Utc::now() + self.challenge_ttl).naive_utc();
        let challenge_bytes: Vec<u8> = challenge.public_key.challenge.clone().into();
        let state_bytes = serde_json::to_vec(&state)
            .context("failed to encode authentication state")
            .map_err(AppError::internal)?;

        let record = NewWebauthnChallenge {
            id: challenge_id,
            user_id: Some(user.id),
            purpose: PURPOSE_AUTHENTICATION.to_string(),
            challenge: challenge_bytes,
            state: state_bytes,
            expires_at,
        };

        diesel::insert_into(challenge_dsl::webauthn_challenges)
            .values(&record)
            .execute(conn)?;

        Ok(AuthenticationChallengeResponse {
            challenge_id,
            challenge,
        })
    }

    pub fn list_for_user(
        &self,
        conn: &mut PgConnection,
        user_id: Uuid,
    ) -> AppResult<Vec<PasskeySummary>> {
        let passkeys: Vec<UserPasskey> = passkey_dsl::user_passkeys
            .filter(passkey_dsl::user_id.eq(user_id))
            .order(passkey_dsl::created_at.asc())
            .select(UserPasskey::as_select())
            .load(conn)?;

        Ok(passkeys.into_iter().map(PasskeySummary::from).collect())
    }

    pub fn active_passkey_count(&self, conn: &mut PgConnection, user_id: Uuid) -> AppResult<i64> {
        let count: i64 = passkey_dsl::user_passkeys
            .filter(passkey_dsl::user_id.eq(user_id))
            .filter(passkey_dsl::revoked_at.is_null())
            .select(count_star())
            .first(conn)?;
        Ok(count)
    }

    pub fn consume_signup_challenge(
        &self,
        conn: &mut PgConnection,
        challenge_id: Uuid,
        credential: &RegisterPublicKeyCredential,
    ) -> AppResult<PreparedPasskey> {
        self.complete_registration(conn, challenge_id, credential, None)
    }

    pub fn revoke_passkey(
        &self,
        conn: &mut PgConnection,
        user_id: Uuid,
        passkey_id: Uuid,
        reason: Option<String>,
    ) -> AppResult<()> {
        let now = Utc::now().naive_utc();
        let updated = diesel::update(
            passkey_dsl::user_passkeys
                .filter(passkey_dsl::id.eq(passkey_id))
                .filter(passkey_dsl::user_id.eq(user_id))
                .filter(passkey_dsl::revoked_at.is_null()),
        )
        .set((
            passkey_dsl::revoked_at.eq(Some(now)),
            passkey_dsl::revoked_reason.eq(reason),
            passkey_dsl::updated_at.eq(now),
        ))
        .execute(conn)?;

        if updated == 0 {
            return Err(AppError::not_found());
        }

        Ok(())
    }

    pub fn finish_authentication(
        &self,
        conn: &mut PgConnection,
        challenge_id: Uuid,
        credential: PublicKeyCredential,
    ) -> AppResult<(User, UserPasskey, AuthenticationResult)> {
        let record: WebauthnChallenge = challenge_dsl::webauthn_challenges
            .find(challenge_id)
            .first(conn)
            .map_err(|err| {
                if matches!(err, diesel::result::Error::NotFound) {
                    AppError::bad_request("challenge not found")
                } else {
                    AppError::from(err)
                }
            })?;

        if record.purpose != PURPOSE_AUTHENTICATION {
            return Err(AppError::bad_request("challenge is not for authentication"));
        }

        let user_id = record
            .user_id
            .ok_or_else(|| AppError::bad_request("challenge missing user context"))?;

        if record.expires_at < Utc::now().naive_utc() {
            diesel::delete(challenge_dsl::webauthn_challenges.find(challenge_id)).execute(conn)?;
            return Err(AppError::bad_request("challenge expired"));
        }

        let state: PasskeyAuthentication = serde_json::from_slice(&record.state)
            .context("failed to decode authentication state")
            .map_err(AppError::internal)?;

        let auth_result = self
            .webauthn
            .finish_passkey_authentication(&credential, &state)
            .map_err(|err| {
                tracing::warn!(error = %err, "passkey authentication failed");
                AppError::unauthorized()
            })?;

        let credential_id_vec: Vec<u8> = auth_result.cred_id().clone().into();

        let mut passkey: UserPasskey = passkey_dsl::user_passkeys
            .filter(passkey_dsl::user_id.eq(user_id))
            .filter(passkey_dsl::credential_id.eq(&credential_id_vec))
            .filter(passkey_dsl::revoked_at.is_null())
            .select(UserPasskey::as_select())
            .first(conn)
            .map_err(|err| {
                if matches!(err, diesel::result::Error::NotFound) {
                    AppError::unauthorized()
                } else {
                    AppError::from(err)
                }
            })?;

        let mut passkey_model: Passkey = serde_json::from_value(passkey.credential.clone())
            .context("failed to parse stored passkey")
            .map_err(AppError::internal)?;

        if auth_result.needs_update() {
            let _ = passkey_model.update_credential(&auth_result);
        }

        let credential_struct: Credential = passkey_model.clone().into();
        let public_key_bytes = serde_cbor_2::to_vec(&credential_struct.cred)
            .context("failed to encode credential public key")
            .map_err(AppError::internal)?;

        let transports: Vec<Option<String>> = credential_struct
            .transports
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|transport| Some(transport.as_ref().to_string()))
            .collect();

        let credential_json = serde_json::to_value(&passkey_model)
            .context("failed to serialise passkey")
            .map_err(AppError::internal)?;

        let now = Utc::now().naive_utc();
        diesel::update(passkey_dsl::user_passkeys.find(passkey.id))
            .set((
                passkey_dsl::sign_count.eq(auth_result.counter() as i64),
                passkey_dsl::transports.eq(&transports),
                passkey_dsl::credential.eq(credential_json.clone()),
                passkey_dsl::public_key.eq(public_key_bytes),
                passkey_dsl::last_used_at.eq(Some(now)),
                passkey_dsl::updated_at.eq(now),
            ))
            .execute(conn)?;

        passkey.sign_count = auth_result.counter() as i64;
        passkey.transports = transports;
        passkey.credential = credential_json;
        passkey.last_used_at = Some(now);
        passkey.updated_at = now;

        diesel::delete(challenge_dsl::webauthn_challenges.find(challenge_id)).execute(conn)?;

        let user = crate::schema::users::table
            .find(user_id)
            .first::<User>(conn)?;

        Ok((user, passkey, auth_result))
    }
}

impl From<UserPasskey> for PasskeySummary {
    fn from(passkey: UserPasskey) -> Self {
        let transports = passkey
            .transports
            .into_iter()
            .filter_map(|value| value)
            .collect();

        Self {
            id: passkey.id,
            nickname: passkey.nickname,
            created_at: passkey.created_at,
            last_used_at: passkey.last_used_at,
            transports,
            revoked_at: passkey.revoked_at,
            revoked_reason: passkey.revoked_reason,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyRegistrationFinishPayload {
    pub challenge_id: Uuid,
    #[schema(value_type = Object)]
    pub credential: RegisterPublicKeyCredential,
    #[serde(default)]
    pub nickname: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyLoginStartPayload {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PasskeyLoginFinishPayload {
    pub challenge_id: Uuid,
    #[schema(value_type = Object)]
    pub credential: PublicKeyCredential,
}
