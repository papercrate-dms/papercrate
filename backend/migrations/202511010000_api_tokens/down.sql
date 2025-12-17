DROP POLICY IF EXISTS tenant_api_token_policy ON tenant.api_tokens;
DROP FUNCTION IF EXISTS shared.current_api_token_prefix();

ALTER TABLE tenant.api_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.api_tokens NO FORCE ROW LEVEL SECURITY;

ALTER TABLE tenant.api_tokens
    DROP COLUMN IF EXISTS capabilities;

DROP TYPE IF EXISTS shared.api_token_capability;

ALTER TABLE tenant.api_tokens RENAME TO webdav_tokens;
ALTER INDEX tenant.api_tokens_token_prefix_key RENAME TO webdav_tokens_token_prefix_key;
ALTER INDEX tenant.api_tokens_user_tenant_idx RENAME TO webdav_tokens_user_tenant_idx;

CREATE OR REPLACE FUNCTION shared.current_webdav_token_prefix() RETURNS text AS $$
    SELECT NULLIF(current_setting('papercrate.webdav_token_prefix', true), '')
$$ LANGUAGE SQL STABLE;

ALTER TABLE tenant.webdav_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.webdav_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_webdav_token_policy ON tenant.webdav_tokens
    USING (
        tenant_id = shared.current_tenant_id()
        OR (
            shared.current_webdav_token_prefix() IS NOT NULL
            AND token_prefix = shared.current_webdav_token_prefix()
        )
    )
    WITH CHECK (tenant_id = shared.current_tenant_id());
