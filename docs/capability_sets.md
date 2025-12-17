# Capability Sets

Capability sets are the tenant-scoped bundles of REST and WebDAV permissions. Every user membership and API token now references one of these sets, and the capability guard middleware enforces the scopes on every route.

## Enumerated Capabilities

All capabilities live in the `ApiCapability` enum. The current list is:

- `documents:read`
- `documents:edit`
- `documents:write`
- `documents:upload`
- `folders:read`
- `folders:edit`
- `folders:write`
- `tags:read`
- `tags:edit`
- `tags:write`
- `correspondents:read`
- `correspondents:edit`
- `correspondents:write`
- `profile:read`
- `profile:write`
- `webdav:read`
- `webdav:write`
- `capability_sets:read`
- `capability_sets:write`

## Default Sets

Provisioning (and the test harness) seed four system capability sets per tenant:

- `owner` — contains the full set above. Tenant owners, admin users, and freshly minted API tokens effectively get unrestricted access.
- `user` — the default interactive role: full document/tag/correspondent/profile access, but no capability-set or WebDAV write privileges.
- `readonly` — interactive but read-only: document/folder/tag/correspondent reads plus WebDAV downloads, but no modifying routes.
- `webdav` — contains only `webdav:read`. WebDAV backup scripts can bind to this set for read-only access.

System sets are flagged with `is_system = true` and cannot be modified or deleted via the API.

## REST API

The capability-set endpoints live at `/api/capability-sets` and require the new admin capabilities:

| Method & Path                           | Capability              | Description                             |
|----------------------------------------|-------------------------|-----------------------------------------|
| `GET /api/capability-sets`             | `capability_sets:read`  | List all sets for the tenant            |
| `POST /api/capability-sets`            | `capability_sets:write` | Create a new set                        |
| `GET /api/capability-sets/{id}`        | `capability_sets:read`  | Fetch details of a specific set         |
| `PATCH /api/capability-sets/{id}`      | `capability_sets:write` | Replace capabilities / rename the set   |
| `DELETE /api/capability-sets/{id}`     | `capability_sets:write` | Remove a custom set (must be unused)    |

### Examples

Create a read-only set:

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  https://app.papercrate.org/api/capability-sets \
  -d '{
    "slug": "api_readonly",
    "capabilities": [
      "documents:read",
      "folders:read",
      "tags:read"
    ]
  }'
```

Update an existing set:

```bash
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  https://app.papercrate.org/api/capability-sets/$SET_ID \
  -d '{
    "capabilities": ["documents:read", "documents:edit"]
  }'
```

Delete (fails if still referenced by memberships or tokens):

```bash
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  https://app.papercrate.org/api/capability-sets/$SET_ID
```

## Assigning Sets

- **User memberships**: change the `capability_set_id` column (via future admin APIs or direct SQL) to reassign a user. The authentication pipeline will enforce the new capabilities automatically.
- **API tokens**: `POST /api/profile/api-tokens` requires a `capability_set_id`. Tokens are bound to the selected set; raw capability arrays are no longer accepted.

## Guard Coverage

The `RequireCapabilitiesLayer` middleware wraps all protected routers (documents, folders, tags, correspondents, profile, capability sets, assets). Requests missing the necessary capability now terminate with a 403 containing `missing_capability` details.

Integration tests in `backend/tests/capability_guards_flow.rs` ensure read-only users cannot upload or manage capability sets, and WebDAV tokens without `webdav:read` are rejected (`backend/tests/api_tokens_flow.rs`).
