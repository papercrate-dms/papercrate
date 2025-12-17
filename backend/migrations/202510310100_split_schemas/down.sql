-- Move tables and types back to the public schema
ALTER TABLE tenant.webdav_tokens SET SCHEMA public;
ALTER TABLE tenant.user_memberships SET SCHEMA public;
ALTER TABLE tenant.refresh_tokens SET SCHEMA public;
ALTER TABLE tenant.tags SET SCHEMA public;
ALTER TABLE tenant.document_correspondents SET SCHEMA public;
ALTER TABLE tenant.document_tags SET SCHEMA public;
ALTER TABLE tenant.document_asset_objects SET SCHEMA public;
ALTER TABLE tenant.document_assets SET SCHEMA public;
ALTER TABLE tenant.document_versions SET SCHEMA public;
ALTER TABLE tenant.documents SET SCHEMA public;
ALTER TABLE tenant.folders SET SCHEMA public;
ALTER TABLE tenant.correspondents SET SCHEMA public;

ALTER FUNCTION shared.touch_jobs_updated_at() SET SCHEMA public;

ALTER TABLE shared.magic_tokens SET SCHEMA public;
ALTER TABLE shared.jobs SET SCHEMA public;
ALTER TABLE shared.webauthn_challenges SET SCHEMA public;
ALTER TABLE shared.user_passkeys SET SCHEMA public;
ALTER TABLE shared.users SET SCHEMA public;
ALTER TABLE shared.tenants SET SCHEMA public;

ALTER TYPE shared.magic_token_kind SET SCHEMA public;
ALTER TYPE shared.tenant_status SET SCHEMA public;

DROP SCHEMA IF EXISTS tenant CASCADE;
DROP SCHEMA IF EXISTS shared CASCADE;
