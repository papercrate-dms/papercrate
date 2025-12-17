use diesel::result::Error as DieselError;

use crate::error::{AppError, AppResult};

pub trait DbResultExt<T> {
    fn db_context(self, context: &'static str) -> AppResult<T>;
}

impl<T> DbResultExt<T> for Result<T, DieselError> {
    fn db_context(self, context: &'static str) -> AppResult<T> {
        self.map_err(|err| match err {
            DieselError::NotFound => AppError::not_found(),
            other => {
                tracing::error!(error = ?other, "{context}");
                AppError::internal(context)
            }
        })
    }
}

pub trait StorageResultExt<T> {
    fn storage_context(self, context: &'static str) -> AppResult<T>;
}

impl<T> StorageResultExt<T> for Result<T, anyhow::Error> {
    fn storage_context(self, context: &'static str) -> AppResult<T> {
        self.map_err(|err| {
            tracing::error!(error = ?err, "{context}");
            AppError::internal(context)
        })
    }
}
