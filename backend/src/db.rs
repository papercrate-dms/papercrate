use std::time::Duration;

use diesel::pg::PgConnection;
use diesel::r2d2::{ConnectionManager, CustomizeConnection, Pool};
use diesel::RunQueryDsl;

pub type PgPool = Pool<ConnectionManager<PgConnection>>;

pub const DEFAULT_MAX_POOL_SIZE: u32 = 2;

#[derive(Debug)]
struct SchemaCustomizer;

impl CustomizeConnection<PgConnection, diesel::r2d2::Error> for SchemaCustomizer {
    fn on_acquire(&self, conn: &mut PgConnection) -> Result<(), diesel::r2d2::Error> {
        diesel::sql_query(
            "SELECT set_config('search_path', (
                SELECT string_agg(schema_name, ', ')
                FROM (
                    SELECT 'tenant' AS schema_name WHERE EXISTS (
                        SELECT 1 FROM pg_namespace WHERE nspname = 'tenant'
                    )
                    UNION ALL
                    SELECT 'shared' AS schema_name WHERE EXISTS (
                        SELECT 1 FROM pg_namespace WHERE nspname = 'shared'
                    )
                    UNION ALL
                    SELECT 'public' AS schema_name
                ) AS schemas
            ), false)",
        )
        .execute(conn)
        .map(|_| ())
        .map_err(diesel::r2d2::Error::QueryError)
    }
}

pub fn init_pool(database_url: &str) -> anyhow::Result<PgPool> {
    init_pool_with_size(database_url, DEFAULT_MAX_POOL_SIZE)
}

pub fn init_pool_with_size(database_url: &str, max_size: u32) -> anyhow::Result<PgPool> {
    let manager = ConnectionManager::<PgConnection>::new(database_url);
    let pool_size = max_size.max(1);
    let pool = Pool::builder()
        .max_size(pool_size)
        .connection_timeout(Duration::from_secs(10))
        .connection_customizer(Box::new(SchemaCustomizer))
        .build(manager)?;
    Ok(pool)
}
