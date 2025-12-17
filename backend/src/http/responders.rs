use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Helper trait to convert error-centric results into the application's error type.
pub trait IntoAppResult<T> {
    fn into_app_result(self) -> AppResult<T>;
}

impl<T, E> IntoAppResult<T> for Result<T, E>
where
    AppError: From<E>,
{
    fn into_app_result(self) -> AppResult<T> {
        self.map_err(AppError::from)
    }
}

/// Extension helpers for optional values to map them into `AppResult`.
pub trait OptionAppResultExt<T> {
    fn or_not_found(self) -> AppResult<T>;
    fn or_bad_request(self, message: impl Into<String>) -> AppResult<T>;
}

impl<T> OptionAppResultExt<T> for Option<T> {
    fn or_not_found(self) -> AppResult<T> {
        self.ok_or_else(AppError::not_found)
    }

    fn or_bad_request(self, message: impl Into<String>) -> AppResult<T> {
        self.ok_or_else(|| AppError::bad_request(message))
    }
}

/// Provides helpers for statements returning number of affected rows.
pub trait RowsAffectedExt: Sized {
    fn or_error(self, error: AppError) -> AppResult<usize>;
    fn or_not_found(self) -> AppResult<usize> {
        self.or_error(AppError::not_found())
    }
}

impl RowsAffectedExt for usize {
    fn or_error(self, error: AppError) -> AppResult<usize> {
        if self == 0 {
            Err(error)
        } else {
            Ok(self)
        }
    }
}

/// Wrapper providing a consistent JSON response with a status code.
pub struct JsonResponse<T> {
    status: StatusCode,
    payload: T,
}

impl<T> JsonResponse<T> {
    pub fn new(status: StatusCode, payload: T) -> Self {
        Self { status, payload }
    }

    pub fn ok(payload: T) -> Self {
        Self::new(StatusCode::OK, payload)
    }

    pub fn created(payload: T) -> Self {
        Self::new(StatusCode::CREATED, payload)
    }

    pub fn accepted(payload: T) -> Self {
        Self::new(StatusCode::ACCEPTED, payload)
    }

    pub fn into_inner(self) -> T {
        self.payload
    }

    pub fn as_inner(&self) -> &T {
        &self.payload
    }
}

impl<T> From<T> for JsonResponse<T> {
    fn from(value: T) -> Self {
        Self::ok(value)
    }
}

impl<T> IntoResponse for JsonResponse<T>
where
    T: Serialize,
{
    fn into_response(self) -> Response {
        (self.status, Json(self.payload)).into_response()
    }
}

/// Helper for returning empty responses with a status code.
pub fn empty(status: StatusCode) -> AppResult<StatusCode> {
    Ok(status)
}

/// Helper for returning `204 No Content`.
pub fn no_content() -> AppResult<StatusCode> {
    empty(StatusCode::NO_CONTENT)
}

/// Helper for returning JSON payloads with `200 OK`.
pub fn ok_json<T>(value: T) -> AppResult<JsonResponse<T>>
where
    T: Serialize,
{
    Ok(JsonResponse::ok(value))
}

/// Helper for returning JSON payloads with `201 Created`.
pub fn created_json<T>(value: T) -> AppResult<JsonResponse<T>>
where
    T: Serialize,
{
    Ok(JsonResponse::created(value))
}

/// Helper for returning JSON payloads with `202 Accepted`.
pub fn accepted_json<T>(value: T) -> AppResult<JsonResponse<T>>
where
    T: Serialize,
{
    Ok(JsonResponse::accepted(value))
}

/// Standard wrapper for paginated responses.
#[derive(Serialize)]
pub struct PaginatedResponse<T, M>
where
    T: Serialize,
    M: Serialize,
{
    pub data: T,
    pub meta: M,
}

pub fn paginated_json<T, M>(data: T, meta: M) -> AppResult<JsonResponse<PaginatedResponse<T, M>>>
where
    T: Serialize,
    M: Serialize,
{
    let payload = PaginatedResponse { data, meta };
    Ok(JsonResponse::ok(payload))
}
