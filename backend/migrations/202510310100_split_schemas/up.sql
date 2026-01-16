CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS tenant;

-- Move global types and tables into the shared schema
ALTER TYPE tenant_status SET SCHEMA shared;
ALTER TYPE magic_token_kind SET SCHEMA shared;

ALTER TABLE tenants SET SCHEMA shared;
ALTER TABLE users SET SCHEMA shared;
ALTER TABLE user_passkeys SET SCHEMA shared;
ALTER TABLE webauthn_challenges SET SCHEMA shared;
ALTER TABLE jobs SET SCHEMA shared;
ALTER TABLE magic_tokens SET SCHEMA shared;

ALTER FUNCTION touch_jobs_updated_at() SET SCHEMA shared;

-- Move tenant-scoped tables into the tenant schema
ALTER TABLE correspondents SET SCHEMA tenant;
ALTER TABLE folders SET SCHEMA tenant;
ALTER TABLE documents SET SCHEMA tenant;
ALTER TABLE document_versions SET SCHEMA tenant;
ALTER TABLE document_assets SET SCHEMA tenant;
ALTER TABLE document_asset_objects SET SCHEMA tenant;
ALTER TABLE document_tags SET SCHEMA tenant;
ALTER TABLE document_correspondents SET SCHEMA tenant;
ALTER TABLE tags SET SCHEMA tenant;
ALTER TABLE refresh_tokens SET SCHEMA tenant;
ALTER TABLE user_memberships SET SCHEMA tenant;
ALTER TABLE webdav_tokens SET SCHEMA tenant;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'papercrate_app') THEN
        RETURN;
    END IF;

    GRANT USAGE ON SCHEMA shared TO papercrate_app;
    GRANT USAGE ON SCHEMA tenant TO papercrate_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA shared TO papercrate_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant TO papercrate_app;

    ALTER DEFAULT PRIVILEGES IN SCHEMA shared GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO papercrate_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA tenant GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO papercrate_app;
END
$$;
