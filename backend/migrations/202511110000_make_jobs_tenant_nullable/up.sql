ALTER TABLE shared.jobs
    ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE shared.jobs
    DROP CONSTRAINT jobs_tenant_id_fkey;

ALTER TABLE shared.jobs
    ADD CONSTRAINT jobs_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES shared.tenants(id)
    ON DELETE SET NULL;

ALTER TABLE shared.jobs
    ADD COLUMN result JSONB;
