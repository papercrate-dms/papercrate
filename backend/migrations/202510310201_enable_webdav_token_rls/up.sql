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
