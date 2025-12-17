DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
DROP FUNCTION IF EXISTS touch_jobs_updated_at();

DROP TABLE IF EXISTS webauthn_challenges;
DROP TABLE IF EXISTS user_passkeys;
DROP TABLE IF EXISTS webdav_tokens;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_current_version_fk;
DROP TABLE IF EXISTS document_asset_objects;
DROP TABLE IF EXISTS document_assets;
DROP TABLE IF EXISTS document_versions;
DROP TABLE IF EXISTS document_tags;
DROP TABLE IF EXISTS document_correspondents;
DROP TABLE IF EXISTS correspondents;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS user_memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS tenants;

DROP TYPE IF EXISTS tenant_status;

DROP EXTENSION IF EXISTS "pgcrypto";
