# Job Catalogue

Papercrate stores asynchronous work in the shared `jobs` table. Each job carries a
`tenant_id`, a small JSON payload, and one of the statuses defined in
`backend/src/jobs.rs` (`queued`, `processing`, `succeeded`, `failed`). Workers
continuously reserve jobs by type and execute the appropriate handler. This
document lists every job type that is currently recognized by the backend and
briefly describes what it does.

| Job type | Payload shape | When it is enqueued | Work performed |
| --- | --- | --- | --- |
| `analyze-document` | `{ "document_id": Uuid, "document_version_id": Uuid, "force": bool }` | Uploading a document, calling the re-analyze bulk action, or after a metadata edit (e.g. title change) | Runs the taskflow pipeline (`GenerateThumbnailsTask`, `GenerateOcrTask`, `DetermineIssuedAtTask`, `IndexDocumentTask`) for the specified document version. The handler refuses to run if the tenant is not `Active`. |
| `purge-document` | `{ "document_id": Uuid }` | `DELETE /api/documents/{id}` after the document has been trashed | Removes every version and asset object from tenant storage, deletes database rows (`documents`, `document_versions`, associated assets/tags/correspondents), and leaves the system ready for GC. |
| `provision-tenant` | `{ "members": [Uuid, ...] }` | When a tenant is created with status `creating` | Creates/ensures the tenant’s Quickwit index, materializes the system capability sets (`owner`, `user`, `readonly`, `webdav`), attaches the initial member list, and flips the tenant status to `active`. |
| `delete-tenant` | `{ "remove_tenant": bool, "tenant_name": string, "action": "delete"\|"reset", "nonce": string, "issued_at": RFC3339 datetime, "signature": hex(HMAC-SHA256), "final_status"?: "active"\|"suspended" }` | Administrative action after a tenant has been marked `deleting` | Deletes all tenant-scoped storage objects, wipes the tenant’s Quickwit index (and optionally deletes it entirely), truncates the tenant schemas/tables, removes queued jobs for that tenant, and either deletes the tenant row or leaves it in the requested final status (defaults to `suspended`) while recreating an empty Quickwit index. |

## Retired job types

`generate-thumbnails` and `generate-ocr-text` once existed as standalone jobs.
Those behaviors now run as tasks inside `analyze-document`. No worker is
registered for the legacy types; keep them out of new payloads.

### Tenant delete/reset safety checks

The `delete-tenant` job refuses to run without a signed payload. The admin CLI
derives a message of the form `v1|tenant_id|tenant_name|action|nonce|issued_at|final_status`
and signs it with an HMAC-SHA256 key based on the server’s JWT secret.
Workers verify the signature, ensure the payload matches the job flags, and
require the `issued_at` timestamp to be no more than five minutes old. This
protects against accidental wipes triggered by stale requests or insufficiently
scoped API calls.

## Operational notes

* Every job handler calls `ensure_active_tenant` (or an equivalent guard) before
  touching tenant data. If a tenant is suspended or deleting, the job will fail
  immediately.
* Jobs are only enqueued for the tenant they operate on. Consequently, wiping a
  tenant with `delete-tenant` also removes any remaining queued jobs for that
  tenant so workers do not waste effort on work that can no longer succeed.
