CREATE TABLE tenant.document_asset_objects (
    id UUID PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES tenant.document_assets(id) ON DELETE CASCADE,
    ordinal INT NOT NULL,
    s3_key TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    tenant_id UUID NOT NULL REFERENCES shared.tenants(id),
    CONSTRAINT document_asset_objects_ordinal_positive CHECK (ordinal >= 1),
    CONSTRAINT document_asset_objects_asset_ordinal_unique UNIQUE (asset_id, ordinal)
);

CREATE INDEX idx_document_asset_objects_asset_ordinal
    ON tenant.document_asset_objects(asset_id, ordinal);

CREATE INDEX document_asset_objects_tenant_id_idx ON tenant.document_asset_objects(tenant_id);

ALTER TABLE tenant.document_assets ADD COLUMN cardinality INT;
UPDATE tenant.document_assets SET cardinality = 1;

INSERT INTO tenant.document_asset_objects (id, asset_id, ordinal, s3_key, metadata, tenant_id)
SELECT gen_random_uuid(), id, 1, s3_key, metadata, tenant_id
FROM tenant.document_assets;

ALTER TABLE tenant.document_assets DROP COLUMN s3_key;
