use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{
        rand_core::OsRng as PasswordHashOsRng, PasswordHash, PasswordHasher, PasswordVerifier,
        SaltString,
    },
    Argon2,
};

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool> {
    let parsed_hash = PasswordHash::new(password_hash).map_err(|err| anyhow!(err))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn hash_password(password: &str) -> Result<String> {
    let mut rng = PasswordHashOsRng;
    let salt = SaltString::generate(&mut rng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|err| anyhow!(err))?;
    Ok(hash.to_string())
}
