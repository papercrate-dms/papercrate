use diesel::pg::PgConnection;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    state::AppState,
};

impl AppState {
    pub fn with_tenant_conn<F, T>(&self, tenant_id: Uuid, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut PgConnection) -> AppResult<T>,
    {
        let mut conn = self.db_for_tenant(tenant_id)?;
        f(&mut conn)
    }
}

pub fn validate_bulk_ids(ids: &mut Vec<Uuid>, label: &str) -> AppResult<()> {
    if ids.is_empty() {
        return Err(AppError::bad_request(format!("{label} must not be empty")));
    }
    ids.sort_unstable();
    ids.dedup();
    Ok(())
}
