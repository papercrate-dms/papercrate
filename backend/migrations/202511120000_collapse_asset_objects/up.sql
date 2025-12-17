-- Prevent concurrent inserts/updates during backfill.
LOCK TABLE tenant.document_asset_objects IN ACCESS EXCLUSIVE MODE;
LOCK TABLE tenant.document_assets IN ACCESS EXCLUSIVE MODE;

ALTER TABLE tenant.document_assets ADD COLUMN s3_key TEXT;

UPDATE tenant.document_assets AS da
SET s3_key = o.s3_key,
    metadata = COALESCE(da.metadata, '{}'::jsonb) || COALESCE(o.metadata, '{}'::jsonb)
FROM tenant.document_asset_objects AS o
WHERE o.asset_id = da.id
  AND o.ordinal = 1;

DELETE FROM tenant.document_asset_objects WHERE ordinal <> 1;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM tenant.document_assets WHERE s3_key IS NULL) THEN
        RAISE EXCEPTION 'cannot drop document_asset_objects: some assets are missing a populated ordinal 1 object (s3_key null)';
    END IF;
END
$$;

ALTER TABLE tenant.document_assets ALTER COLUMN s3_key SET NOT NULL;
ALTER TABLE tenant.document_assets DROP COLUMN cardinality;

DROP TABLE tenant.document_asset_objects;
