ALTER TABLE tenant.refresh_tokens RENAME TO user_sessions;

ALTER INDEX tenant.idx_refresh_tokens_user_id RENAME TO idx_user_sessions_user_id;
ALTER INDEX tenant.idx_refresh_tokens_token_hash RENAME TO idx_user_sessions_token_hash;
ALTER INDEX tenant.refresh_tokens_tenant_id_idx RENAME TO user_sessions_tenant_id_idx;

ALTER POLICY tenant_refresh_token_policy ON tenant.user_sessions
    RENAME TO tenant_user_session_policy;

CREATE OR REPLACE FUNCTION shared.current_user_session_hash() RETURNS text AS $$
    SELECT NULLIF(current_setting('papercrate.user_session_hash', true), '')
$$ LANGUAGE SQL STABLE;

ALTER POLICY tenant_user_session_policy ON tenant.user_sessions
    USING (
        tenant_id = shared.current_tenant_id()
        OR (
            shared.current_user_session_hash() IS NOT NULL
            AND token_hash = shared.current_user_session_hash()
        )
    );

ALTER POLICY tenant_user_session_policy ON tenant.user_sessions
    WITH CHECK (tenant_id = shared.current_tenant_id());

DROP FUNCTION IF EXISTS shared.current_refresh_token_hash();
