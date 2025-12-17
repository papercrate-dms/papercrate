use diesel::dsl::exists;
use diesel::prelude::*;
use uuid::Uuid;

use crate::error::AppResult;
use crate::schema::folders;
use crate::utils::validation::ensure_exists;

pub fn ensure_folder_exists_on_conn(
    conn: &mut PgConnection,
    tenant_id: Uuid,
    folder_id: Uuid,
) -> AppResult<()> {
    let exists: bool = diesel::select(exists(
        folders::table
            .filter(folders::id.eq(folder_id))
            .filter(folders::tenant_id.eq(tenant_id)),
    ))
    .get_result(conn)?;
    ensure_exists(exists, "folder")
}
