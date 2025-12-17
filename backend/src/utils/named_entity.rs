use diesel::QueryResult;

use crate::error::{AppError, AppResult};

/// Trim and validate a user-supplied entity name, returning an owned String.
///
/// The `on_empty` closure is only invoked when the trimmed name is empty, giving
/// callers control over the concrete error that should be surfaced.
pub fn normalize_name(raw: &str, on_empty: impl Fn() -> AppError) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(on_empty());
    }
    Ok(trimmed.to_string())
}

/// Ensure that no conflicting entity exists by executing the provided query
/// closure. If a record is returned, the `on_duplicate` closure is evaluated to
/// produce the appropriate error.
pub fn ensure_name_available<T>(
    query: impl FnOnce() -> QueryResult<Option<T>>,
    on_duplicate: impl Fn() -> AppError,
) -> AppResult<()> {
    if query()?.is_some() {
        return Err(on_duplicate());
    }
    Ok(())
}
