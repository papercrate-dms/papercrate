CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE tenant_status AS ENUM ('creating', 'active', 'suspended', 'deleting', 'error');

CREATE TABLE tenants (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    storage_root TEXT,
    quickwit_index TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status tenant_status NOT NULL,
    created_by UUID
);

CREATE UNIQUE INDEX tenants_storage_root_unique
    ON tenants (storage_root)
    WHERE storage_root IS NOT NULL;

CREATE UNIQUE INDEX tenants_quickwit_index_unique
    ON tenants (quickwit_index)
    WHERE quickwit_index IS NOT NULL;

CREATE TABLE users (
    id UUID PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_memberships (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, tenant_id)
);

CREATE INDEX user_memberships_tenant_id_idx ON user_memberships(tenant_id);
CREATE INDEX user_memberships_user_id_idx ON user_memberships(user_id);

CREATE TABLE folders (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id UUID NOT NULL REFERENCES tenants(id)
);

CREATE INDEX idx_folders_parent ON folders(parent_id);
CREATE INDEX folders_tenant_id_idx ON folders(tenant_id);
CREATE UNIQUE INDEX folders_tenant_parent_name_unique_idx
    ON folders (
        tenant_id,
        COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
        name
    );

CREATE TABLE documents (
    id UUID PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(100),
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    issued_at TIMESTAMPTZ,
    title VARCHAR(255) NOT NULL,
    current_version_id UUID NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id)
);

CREATE INDEX idx_documents_folder ON documents(folder_id);
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at);
CREATE INDEX documents_tenant_id_idx ON documents(tenant_id);
CREATE INDEX idx_documents_current_version_id ON documents(current_version_id);
CREATE INDEX idx_documents_folder_title
    ON documents (
        COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
        title
    )
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX documents_tenant_folder_filename_unique
    ON documents (
        tenant_id,
        COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
        filename
    )
    WHERE deleted_at IS NULL;

CREATE TABLE document_versions (
    id UUID PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    s3_key VARCHAR(500) NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    CONSTRAINT document_versions_unique_version UNIQUE (document_id, version_number)
);

CREATE INDEX idx_document_versions_document ON document_versions(document_id);
CREATE INDEX document_versions_tenant_id_idx ON document_versions(tenant_id);

ALTER TABLE documents
    ADD CONSTRAINT documents_current_version_fk
    FOREIGN KEY (current_version_id)
    REFERENCES document_versions(id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE tags (
    id UUID PRIMARY KEY,
    label VARCHAR(100) NOT NULL,
    color VARCHAR(7),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id UUID NOT NULL REFERENCES tenants(id)
);

CREATE UNIQUE INDEX tags_tenant_label_unique ON tags(tenant_id, label);
CREATE INDEX tags_tenant_id_idx ON tags(tenant_id);

CREATE TABLE document_tags (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    PRIMARY KEY (document_id, tag_id)
);

CREATE INDEX idx_document_tags_tag ON document_tags(tag_id);
CREATE INDEX document_tags_tenant_id_idx ON document_tags(tenant_id);

CREATE TABLE correspondents (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id UUID NOT NULL REFERENCES tenants(id)
);

CREATE UNIQUE INDEX correspondents_tenant_name_unique
    ON correspondents (tenant_id, name);
CREATE INDEX correspondents_tenant_id_idx ON correspondents(tenant_id);

CREATE TABLE document_correspondents (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    correspondent_id UUID NOT NULL REFERENCES correspondents(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    PRIMARY KEY (document_id, correspondent_id)
);

CREATE INDEX idx_document_correspondents_document ON document_correspondents(document_id);
CREATE INDEX idx_document_correspondents_correspondent ON document_correspondents(correspondent_id);
CREATE INDEX document_correspondents_tenant_id_idx ON document_correspondents(tenant_id);

CREATE TABLE document_assets (
    id UUID PRIMARY KEY,
    document_version_id UUID NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
    asset_type TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cardinality INTEGER,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    CONSTRAINT document_assets_unique UNIQUE (document_version_id, asset_type),
    CONSTRAINT document_assets_cardinality_positive CHECK (cardinality IS NULL OR cardinality >= 1)
);

CREATE INDEX idx_document_assets_version ON document_assets(document_version_id);
CREATE INDEX idx_document_assets_type ON document_assets(asset_type);
CREATE INDEX document_assets_tenant_id_idx ON document_assets(tenant_id);

CREATE TABLE document_asset_objects (
    id UUID PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES document_assets(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    s3_key TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    CONSTRAINT document_asset_objects_ordinal_positive CHECK (ordinal >= 1),
    CONSTRAINT document_asset_objects_asset_ordinal_unique UNIQUE (asset_id, ordinal)
);

CREATE INDEX idx_document_asset_objects_asset_ordinal
    ON document_asset_objects(asset_id, ordinal);
CREATE INDEX document_asset_objects_tenant_id_idx ON document_asset_objects(tenant_id);

CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'processing', 'succeeded', 'failed'))
);

CREATE INDEX idx_jobs_status_run_after ON jobs(status, run_after);
CREATE INDEX idx_jobs_job_type ON jobs(job_type);
CREATE INDEX jobs_tenant_id_idx ON jobs(tenant_id);

CREATE OR REPLACE FUNCTION touch_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION touch_jobs_updated_at();

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tenant_id UUID NOT NULL REFERENCES tenants(id)
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX refresh_tokens_tenant_id_idx ON refresh_tokens(tenant_id);

CREATE TABLE webdav_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    token_prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX webdav_tokens_token_prefix_key ON webdav_tokens(token_prefix);
CREATE INDEX webdav_tokens_user_tenant_idx ON webdav_tokens(user_id, tenant_id);

CREATE TABLE user_passkeys (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL UNIQUE,
    public_key BYTEA NOT NULL,
    credential JSONB NOT NULL,
    sign_count BIGINT NOT NULL,
    transports TEXT[] NOT NULL DEFAULT '{}'::text[],
    aaguid UUID,
    nickname TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    revoked_reason TEXT
);

CREATE INDEX user_passkeys_user_id_idx ON user_passkeys(user_id);

CREATE TABLE webauthn_challenges (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    challenge BYTEA NOT NULL,
    state BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT webauthn_challenges_purpose_check CHECK (purpose IN ('registration', 'authentication'))
);

CREATE INDEX webauthn_challenges_user_id_idx ON webauthn_challenges(user_id);
CREATE INDEX webauthn_challenges_expires_at_idx ON webauthn_challenges(expires_at);
