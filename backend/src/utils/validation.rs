use crate::error::{AppError, AppResult};

/// Ensure an entity exists, returning a bad request error when it does not.
pub fn ensure_exists(exists: bool, entity: &str) -> AppResult<()> {
    if exists {
        Ok(())
    } else {
        Err(AppError::bad_request(format!("{entity} does not exist")))
    }
}
