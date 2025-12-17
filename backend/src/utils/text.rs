use crate::error::{AppError, AppResult};

/// Normalizes an identifier-like user input by trimming, enforcing length, and validating characters.
pub fn normalize_identifier<F>(
    value: &str,
    max_len: usize,
    empty_message: &str,
    length_message: &str,
    invalid_message: Option<&str>,
    mut validator: F,
) -> AppResult<String>
where
    F: FnMut(char) -> bool,
{
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request(empty_message));
    }

    if trimmed.len() > max_len {
        return Err(AppError::bad_request(length_message));
    }

    if let Some(msg) = invalid_message {
        if !trimmed.chars().all(|ch| validator(ch)) {
            return Err(AppError::bad_request(msg));
        }
    }

    Ok(trimmed.to_string())
}
