-- diesel:run_in_transaction = false

WITH owner_sets AS (
    SELECT id FROM tenant.capability_sets WHERE slug = 'owner'
)
INSERT INTO tenant.capability_set_capabilities (capability_set_id, capability)
SELECT id, 'tenants:write'::api_capability FROM owner_sets
ON CONFLICT DO NOTHING;

WITH owner_sets AS (
    SELECT id FROM tenant.capability_sets WHERE slug = 'owner'
)
INSERT INTO tenant.capability_set_capabilities (capability_set_id, capability)
SELECT id, 'tenants:reset'::api_capability FROM owner_sets
ON CONFLICT DO NOTHING;

WITH owner_sets AS (
    SELECT id FROM tenant.capability_sets WHERE slug = 'owner'
)
INSERT INTO tenant.capability_set_capabilities (capability_set_id, capability)
SELECT id, 'tenants:delete'::api_capability FROM owner_sets
ON CONFLICT DO NOTHING;
