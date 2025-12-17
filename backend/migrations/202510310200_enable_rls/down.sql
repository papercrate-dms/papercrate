DROP POLICY IF EXISTS tenant_membership_select_policy ON tenant.user_memberships;
ALTER TABLE tenant.user_memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.user_memberships DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.webdav_tokens;
ALTER TABLE tenant.webdav_tokens NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.webdav_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.tags;
ALTER TABLE tenant.tags NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.tags DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_refresh_token_policy ON tenant.refresh_tokens;
ALTER TABLE tenant.refresh_tokens NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.refresh_tokens DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.folders;
ALTER TABLE tenant.folders NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.folders DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.documents;
ALTER TABLE tenant.documents NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.documents DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.document_versions;
ALTER TABLE tenant.document_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.document_versions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.document_tags;
ALTER TABLE tenant.document_tags NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.document_tags DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.document_correspondents;
ALTER TABLE tenant.document_correspondents NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.document_correspondents DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.document_assets;
ALTER TABLE tenant.document_assets NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.document_assets DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.document_asset_objects;
ALTER TABLE tenant.document_asset_objects NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.document_asset_objects DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant.correspondents;
ALTER TABLE tenant.correspondents NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.correspondents DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS shared.current_refresh_token_hash();
DROP FUNCTION IF EXISTS shared.current_user_id();
DROP FUNCTION IF EXISTS shared.current_tenant_id();
