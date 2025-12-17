ALTER TABLE tenant.webdav_tokens RENAME TO api_tokens;
ALTER INDEX tenant.webdav_tokens_token_prefix_key RENAME TO api_tokens_token_prefix_key;
ALTER INDEX tenant.webdav_tokens_user_tenant_idx RENAME TO api_tokens_user_tenant_idx;

DROP POLICY IF EXISTS tenant_webdav_token_policy ON tenant.api_tokens;
DROP FUNCTION IF EXISTS shared.current_webdav_token_prefix();

CREATE TYPE shared.api_token_capability AS ENUM ('api', 'webdav');

ALTER TABLE tenant.api_tokens
    ADD COLUMN capabilities shared.api_token_capability[] NOT NULL DEFAULT ARRAY['webdav']::shared.api_token_capability[];

ALTER TABLE tenant.api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.api_tokens FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION shared.current_api_token_prefix() RETURNS text AS $$
    SELECT NULLIF(current_setting('papercrate.api_token_prefix', true), '')
$$ LANGUAGE SQL STABLE;

CREATE POLICY tenant_api_token_policy ON tenant.api_tokens
    USING (
        tenant_id = shared.current_tenant_id()
        OR (
            shared.current_api_token_prefix() IS NOT NULL
            AND token_prefix = shared.current_api_token_prefix()
        )
    )
    WITH CHECK (tenant_id = shared.current_tenant_id());
