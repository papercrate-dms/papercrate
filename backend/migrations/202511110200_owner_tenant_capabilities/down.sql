-- diesel:run_in_transaction = false

DELETE FROM tenant.capability_set_capabilities
WHERE capability IN (
        'tenants:write'::api_capability,
        'tenants:reset'::api_capability,
        'tenants:delete'::api_capability
    )
  AND capability_set_id IN (SELECT id FROM tenant.capability_sets WHERE slug = 'owner');
