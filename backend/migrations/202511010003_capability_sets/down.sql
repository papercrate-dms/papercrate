CREATE TYPE api_token_capability AS ENUM ('api', 'webdav');

ALTER TABLE tenant.api_tokens
    ADD COLUMN capabilities api_token_capability[] NOT NULL DEFAULT ARRAY[]::api_token_capability[];

UPDATE tenant.api_tokens t
SET capabilities = ARRAY['api']::api_token_capability[]
FROM tenant.capability_sets cs
WHERE t.capability_set_id = cs.id
  AND cs.slug = 'owner';

UPDATE tenant.api_tokens t
SET capabilities = ARRAY['webdav']::api_token_capability[]
FROM tenant.capability_sets cs
WHERE t.capability_set_id = cs.id
  AND cs.slug = 'webdav'
  AND (t.capabilities IS NULL OR array_length(t.capabilities, 1) = 0);

ALTER TABLE tenant.api_tokens
    DROP COLUMN capability_set_id;

ALTER TABLE tenant.user_memberships
    DROP COLUMN capability_set_id;

DROP TABLE IF EXISTS tenant.capability_set_capabilities;
DROP TABLE IF EXISTS tenant.capability_sets;

DROP TYPE IF EXISTS api_capability;
