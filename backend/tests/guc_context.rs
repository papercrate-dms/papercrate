use anyhow::Result;
use diesel::prelude::*;
use diesel::sql_types::Text;
use papercrate::tenants::{
    ApiTokenPrefix, GucContext, ScopedTransaction, SessionHash, TenantId, UserId,
};
use uuid::Uuid;

/// Connect to the test database via TEST_DATABASE_URL.
fn test_conn() -> PgConnection {
    let url = std::env::var("TEST_DATABASE_URL").unwrap_or_else(|_| {
        "postgres://papercrate:papercrate_test@localhost:5433/papercrate_test".into()
    });
    PgConnection::establish(&url).expect("failed to connect to test database")
}

/// Read a Postgres GUC variable.
fn read_guc(conn: &mut PgConnection, name: &str) -> String {
    #[derive(QueryableByName)]
    struct GucRow {
        #[diesel(sql_type = Text)]
        val: String,
    }
    let query = format!("SELECT current_setting('{}', true) AS val", name);
    diesel::sql_query(query)
        .get_result::<GucRow>(conn)
        .expect("failed to read GUC")
        .val
}

// ---------------------------------------------------------------------------
// GucContext::apply_local — verify SET LOCAL works against real Postgres
// ---------------------------------------------------------------------------

#[test]
fn apply_local_sets_tenant_id() -> Result<()> {
    let mut conn = test_conn();
    let tenant_id = Uuid::new_v4();

    conn.transaction(|tx| {
        TenantId(tenant_id).apply_local(tx)?;
        let val = read_guc(tx, "papercrate.tenant_id");
        assert_eq!(val, tenant_id.to_string());
        Ok::<_, diesel::result::Error>(())
    })?;

    Ok(())
}

#[test]
fn apply_local_sets_user_id() -> Result<()> {
    let mut conn = test_conn();
    let user_id = Uuid::new_v4();

    conn.transaction(|tx| {
        UserId(user_id).apply_local(tx)?;
        let val = read_guc(tx, "papercrate.user_id");
        assert_eq!(val, user_id.to_string());
        Ok::<_, diesel::result::Error>(())
    })?;

    Ok(())
}

#[test]
fn apply_local_sets_session_hash() -> Result<()> {
    let mut conn = test_conn();
    let hash = "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12";

    conn.transaction(|tx| {
        SessionHash(hash).apply_local(tx)?;
        let val = read_guc(tx, "papercrate.user_session_hash");
        assert_eq!(val, hash);
        Ok::<_, diesel::result::Error>(())
    })?;

    Ok(())
}

#[test]
fn apply_local_sets_api_token_prefix() -> Result<()> {
    let mut conn = test_conn();
    let prefix = "pc_live_abc123";

    conn.transaction(|tx| {
        ApiTokenPrefix(prefix).apply_local(tx)?;
        let val = read_guc(tx, "papercrate.api_token_prefix");
        assert_eq!(val, prefix);
        Ok::<_, diesel::result::Error>(())
    })?;

    Ok(())
}

#[test]
fn set_local_resets_after_transaction() -> Result<()> {
    let mut conn = test_conn();
    let tenant_id = Uuid::new_v4();

    conn.transaction(|tx| {
        TenantId(tenant_id).apply_local(tx)?;
        assert_eq!(read_guc(tx, "papercrate.tenant_id"), tenant_id.to_string());
        Ok::<_, diesel::result::Error>(())
    })?;

    // After transaction, GUC should be reset (empty)
    let val = read_guc(&mut conn, "papercrate.tenant_id");
    assert_eq!(
        val, "",
        "SET LOCAL should auto-reset after transaction ends"
    );

    Ok(())
}

#[test]
fn scoped_sets_and_resets_guc() -> Result<()> {
    let mut conn = test_conn();
    let tenant_id = Uuid::new_v4();

    conn.scoped(TenantId(tenant_id), |tx| {
        assert_eq!(read_guc(tx, "papercrate.tenant_id"), tenant_id.to_string());
        Ok::<_, diesel::result::Error>(())
    })?;

    let val = read_guc(&mut conn, "papercrate.tenant_id");
    assert_eq!(val, "", "scoped() should reset GUC after completion");

    Ok(())
}

#[test]
fn scoped_resets_guc_on_rollback() -> Result<()> {
    let mut conn = test_conn();
    let tenant_id = Uuid::new_v4();

    let result: Result<(), diesel::result::Error> = conn.scoped(TenantId(tenant_id), |_tx| {
        Err(diesel::result::Error::RollbackTransaction)
    });
    assert!(result.is_err());

    let val = read_guc(&mut conn, "papercrate.tenant_id");
    assert_eq!(val, "", "SET LOCAL should reset on rollback too");

    Ok(())
}

#[test]
fn tuple_context_sets_multiple_gucs() -> Result<()> {
    let mut conn = test_conn();
    let tenant_id = Uuid::new_v4();
    let user_id = Uuid::new_v4();

    conn.scoped((TenantId(tenant_id), UserId(user_id)), |tx| {
        assert_eq!(read_guc(tx, "papercrate.tenant_id"), tenant_id.to_string());
        assert_eq!(read_guc(tx, "papercrate.user_id"), user_id.to_string());
        Ok::<_, diesel::result::Error>(())
    })?;

    Ok(())
}
