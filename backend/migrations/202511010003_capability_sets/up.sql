CREATE TYPE api_capability AS ENUM (
    'documents:read',
    'documents:edit',
    'documents:write',
    'documents:upload',
    'folders:read',
    'folders:edit',
    'folders:write',
    'tags:read',
    'tags:edit',
    'tags:write',
    'correspondents:read',
    'correspondents:edit',
    'correspondents:write',
    'profile:read',
    'profile:write',
    'webdav:read',
    'webdav:write',
    'capability_sets:read',
    'capability_sets:write'
);

CREATE TABLE tenant.capability_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES shared.tenants(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    cap_version INT NOT NULL DEFAULT 1,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE tenant.capability_set_capabilities (
    capability_set_id UUID NOT NULL REFERENCES tenant.capability_sets(id) ON DELETE CASCADE,
    capability api_capability NOT NULL,
    PRIMARY KEY (capability_set_id, capability)
);

ALTER TABLE tenant.api_tokens
    ADD COLUMN capability_set_id UUID REFERENCES tenant.capability_sets(id);

ALTER TABLE tenant.user_memberships
    ADD COLUMN capability_set_id UUID REFERENCES tenant.capability_sets(id);

WITH owner_sets AS (
    INSERT INTO tenant.capability_sets (tenant_id, slug, is_system)
    SELECT id, 'owner', TRUE
    FROM shared.tenants
    RETURNING id, tenant_id
),
user_sets AS (
    INSERT INTO tenant.capability_sets (tenant_id, slug, is_system)
    SELECT id, 'user', TRUE
    FROM shared.tenants
    RETURNING id, tenant_id
),
readonly_sets AS (
    INSERT INTO tenant.capability_sets (tenant_id, slug, is_system)
    SELECT id, 'readonly', TRUE
    FROM shared.tenants
    RETURNING id, tenant_id
),
webdav_sets AS (
    INSERT INTO tenant.capability_sets (tenant_id, slug, is_system)
    SELECT id, 'webdav', TRUE
    FROM shared.tenants
    RETURNING id, tenant_id
)
INSERT INTO tenant.capability_set_capabilities (capability_set_id, capability)
SELECT set_id,
       capability
FROM (
    SELECT os.id AS set_id,
           UNNEST(ARRAY[
               'documents:read'::api_capability,
               'documents:edit'::api_capability,
               'documents:write'::api_capability,
               'documents:upload'::api_capability,
               'folders:read'::api_capability,
               'folders:edit'::api_capability,
               'folders:write'::api_capability,
               'tags:read'::api_capability,
               'tags:edit'::api_capability,
               'tags:write'::api_capability,
               'correspondents:read'::api_capability,
               'correspondents:edit'::api_capability,
               'correspondents:write'::api_capability,
               'profile:read'::api_capability,
               'profile:write'::api_capability,
               'webdav:read'::api_capability,
               'webdav:write'::api_capability,
               'capability_sets:read'::api_capability,
               'capability_sets:write'::api_capability
           ]) AS capability
    FROM owner_sets os
    UNION ALL
    SELECT us.id,
           UNNEST(ARRAY[
               'documents:read'::api_capability,
               'documents:edit'::api_capability,
               'documents:write'::api_capability,
               'documents:upload'::api_capability,
               'folders:read'::api_capability,
               'folders:edit'::api_capability,
               'folders:write'::api_capability,
               'tags:read'::api_capability,
               'tags:edit'::api_capability,
               'tags:write'::api_capability,
               'correspondents:read'::api_capability,
               'correspondents:edit'::api_capability,
               'correspondents:write'::api_capability,
               'profile:read'::api_capability,
               'profile:write'::api_capability
           ]) AS capability
    FROM user_sets us
    UNION ALL
    SELECT rs.id,
           UNNEST(ARRAY[
               'documents:read'::api_capability,
               'folders:read'::api_capability,
               'tags:read'::api_capability,
               'correspondents:read'::api_capability,
               'webdav:read'::api_capability
           ]) AS capability
    FROM readonly_sets rs
    UNION ALL
    SELECT ws.id,
           UNNEST(ARRAY['webdav:read'::api_capability]) AS capability
    FROM webdav_sets ws
) seeded;

UPDATE tenant.user_memberships um
SET capability_set_id = cs.id
FROM tenant.capability_sets cs
WHERE cs.tenant_id = um.tenant_id
  AND cs.slug = 'owner';

UPDATE tenant.api_tokens t
SET capability_set_id = cs.id
FROM tenant.capability_sets cs
WHERE cs.tenant_id = t.tenant_id
  AND cs.slug = 'owner';

UPDATE tenant.api_tokens t
SET capability_set_id = cs.id
FROM tenant.capability_sets cs
WHERE cs.tenant_id = t.tenant_id
  AND cs.slug = 'webdav'
  AND t.capability_set_id IS NULL;

ALTER TABLE tenant.api_tokens
    ALTER COLUMN capability_set_id SET NOT NULL;

ALTER TABLE tenant.api_tokens
    DROP COLUMN capabilities;

DROP TYPE IF EXISTS api_token_capability;
