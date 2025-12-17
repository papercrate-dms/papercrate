CREATE OR REPLACE FUNCTION shared.current_tenant_id() RETURNS uuid AS $$
    SELECT CASE
        WHEN setting IS NULL OR setting = '' THEN NULL
        ELSE setting::uuid
    END
    FROM (SELECT current_setting('papercrate.tenant_id', true) AS setting) s;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION shared.current_user_id() RETURNS uuid AS $$
    SELECT CASE
        WHEN setting IS NULL OR setting = '' THEN NULL
        ELSE setting::uuid
    END
    FROM (SELECT current_setting('papercrate.user_id', true) AS setting) s;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION shared.current_refresh_token_hash() RETURNS text AS $$
    SELECT NULLIF(current_setting('papercrate.refresh_token_hash', true), '')
$$ LANGUAGE SQL STABLE;

-- Helper to create tenant isolation policy
CREATE OR REPLACE FUNCTION shared.ensure_tenant_policy(table_reg regclass) RETURNS void AS $$
BEGIN
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_reg);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', table_reg);
    EXECUTE format(
        'CREATE POLICY tenant_isolation_policy ON %s USING (tenant_id = shared.current_tenant_id()) WITH CHECK (tenant_id = shared.current_tenant_id())',
        table_reg
    );
END;
$$ LANGUAGE plpgsql;

SELECT shared.ensure_tenant_policy('tenant.correspondents');
SELECT shared.ensure_tenant_policy('tenant.document_asset_objects');
SELECT shared.ensure_tenant_policy('tenant.document_assets');
SELECT shared.ensure_tenant_policy('tenant.document_correspondents');
SELECT shared.ensure_tenant_policy('tenant.document_tags');
SELECT shared.ensure_tenant_policy('tenant.document_versions');
SELECT shared.ensure_tenant_policy('tenant.documents');
SELECT shared.ensure_tenant_policy('tenant.folders');
SELECT shared.ensure_tenant_policy('tenant.tags');
SELECT shared.ensure_tenant_policy('tenant.webdav_tokens');

-- user_memberships has a special read policy to allow tenant discovery during login
ALTER TABLE tenant.user_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.user_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_membership_select_policy ON tenant.user_memberships
    USING (
        tenant_id = shared.current_tenant_id()
        OR (
            shared.current_user_id() IS NOT NULL
            AND user_id = shared.current_user_id()
        )
    )
    WITH CHECK (tenant_id = shared.current_tenant_id());

ALTER TABLE tenant.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_refresh_token_policy ON tenant.refresh_tokens
    USING (
        tenant_id = shared.current_tenant_id()
        OR (
            shared.current_refresh_token_hash() IS NOT NULL
            AND token_hash = shared.current_refresh_token_hash()
        )
    )
    WITH CHECK (tenant_id = shared.current_tenant_id());

DROP FUNCTION shared.ensure_tenant_policy(regclass);
