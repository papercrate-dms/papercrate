CREATE OR REPLACE FUNCTION shared.current_refresh_token_hash() RETURNS text AS $$
    SELECT NULLIF(current_setting('papercrate.refresh_token_hash', true), '')
$$ LANGUAGE SQL STABLE;

ALTER POLICY tenant_user_session_policy ON tenant.user_sessions
    USING (
        tenant_id = shared.current_tenant_id()
        OR (
            shared.current_refresh_token_hash() IS NOT NULL
            AND token_hash = shared.current_refresh_token_hash()
        )
    );

ALTER POLICY tenant_user_session_policy ON tenant.user_sessions
    WITH CHECK (tenant_id = shared.current_tenant_id());

ALTER POLICY tenant_user_session_policy ON tenant.user_sessions
    RENAME TO tenant_refresh_token_policy;

ALTER INDEX tenant.idx_user_sessions_user_id RENAME TO idx_refresh_tokens_user_id;
ALTER INDEX tenant.idx_user_sessions_token_hash RENAME TO idx_refresh_tokens_token_hash;
ALTER INDEX tenant.user_sessions_tenant_id_idx RENAME TO refresh_tokens_tenant_id_idx;

ALTER TABLE tenant.user_sessions RENAME TO refresh_tokens;

DROP FUNCTION IF EXISTS shared.current_user_session_hash();
