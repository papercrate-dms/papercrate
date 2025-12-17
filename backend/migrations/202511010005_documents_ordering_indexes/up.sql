CREATE COLLATION IF NOT EXISTS unicode_ci
    (provider = icu, locale = 'und-u-ks-level2');

CREATE INDEX idx_documents_tenant_folder_title_order
    ON tenant.documents (
        tenant_id,
        COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
        title COLLATE "unicode_ci"
    )
    WHERE deleted_at IS NULL;

CREATE INDEX idx_documents_tenant_folder_issued_at
    ON tenant.documents (
        tenant_id,
        COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
        issued_at,
        title COLLATE "unicode_ci"
    )
    WHERE deleted_at IS NULL;

CREATE INDEX idx_documents_tenant_folder_created_at
    ON tenant.documents (
        tenant_id,
        COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
        created_at,
        title COLLATE "unicode_ci"
    )
    WHERE deleted_at IS NULL;

CREATE INDEX idx_documents_tenant_folder_updated_at
    ON tenant.documents (
        tenant_id,
        COALESCE(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
        updated_at,
        title COLLATE "unicode_ci"
    )
    WHERE deleted_at IS NULL;
