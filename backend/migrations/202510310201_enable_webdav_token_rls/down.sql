DROP POLICY IF EXISTS tenant_webdav_token_policy ON tenant.webdav_tokens;
ALTER TABLE tenant.webdav_tokens NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.webdav_tokens DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS shared.current_webdav_token_prefix();
