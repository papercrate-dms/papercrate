# Document Data Model

This note describes the core persistence model for documents: the metadata held in
`documents`, how versions are tracked, and the way auxiliary assets are stored.

## documents

Each row represents the logical document a user interacts with in the UI. Key
fields:

- `id (uuid)` – Stable identifier used in API paths.
- `tenant_id (uuid)` – Multi-tenancy boundary; all joins filter by this.
- `title (varchar)` – Display name editable via PATCH.
- `filename / original_name (varchar)` – Current storage filename vs. the name
  captured during upload.
- `folder_id (uuid, nullable)` – Parent folder, `NULL` means root.
- `metadata (jsonb)` – Arbitrary structured metadata (source import details,
  custom fields, etc.).
- `issued_at (timestamptz, nullable)` – User-provided timestamp for when the
  document was issued (invoice date, etc.).
- `current_version_id (uuid)` – FK pointing at the active `document_versions`
  row; updated whenever a new version is promoted.
- `deleted_at (timestamptz, nullable)` – Soft-delete marker; non-NULL rows are
  treated as living in the trash.
- `created_at / updated_at (timestamptz)` – Audit stamps; `updated_at` reflects
  metadata or version changes.

Other indexes enforce per-tenant uniqueness for `(folder, filename)` and support
common queries (folder listing, trash filtering).

## document_versions

Every binary revision lives here. Fields of interest:

- `document_id (uuid)` – Back-reference to the logical document.
- `version_number (int)` – Monotonic per document (1, 2, …); enforced via
  `UNIQUE(document_id, version_number)`.
- `s3_key (varchar)` – Object storage path for the binary (used for download).
- `size_bytes`, `checksum` – Stored metadata about the binary; checksum is a
  hex-encoded SHA-256 hash used for dedupe/conflicts.
- `metadata (jsonb)` – Small metadata blob specific to the version (extracted
  text summary, processing hints, etc.).
- `tenant_id (uuid)` – Mirrors the owning document’s tenant.

The row referenced by `documents.current_version_id` is treated as the latest
revision. Older versions remain queryable for download or audit.

## Assets

A document version can have zero or more derived artifacts (thumbnails, OCR
output, previews). These are modelled via:

- `document_assets`
  - `document_version_id` – FK to the owning version.
  - `asset_type (text)` – Logical type identifier (e.g. `thumbnail`, `ocr_text`).
  - `mime_type (text)` – Media type for consumers.
  - `metadata (jsonb)` – Asset-specific metadata (dimensions, page count, etc.).
  - `cardinality (int, nullable)` – Optional hint for multi-object assets.
  - `tenant_id (uuid)` – Tenant scoping.
  - Uniqueness on `(document_version_id, asset_type)` ensures one logical asset
    per type; multi-object cases are stored in `document_asset_objects`.

- `document_asset_objects`
  - `asset_id` – FK to `document_assets`.
  - `ordinal (int)` – 1-based position for multi-part assets.
  - `s3_key (text)` – Object storage key for the binary blob.
  - `metadata (jsonb)` – Per-object metadata if needed (e.g. page number).

Simple assets (single thumbnail) live solely in `document_assets`. Complex ones
(e.g. per-page previews) use `document_asset_objects` to point at multiple S3
objects under a single logical asset.

## Related tables

- `document_tags` and `document_correspondents` provide many-to-many
  relationships for categorisation.
- `jobs` records background work (OCR, thumbnails, indexing) keyed by tenant.
- `api_tokens`, `user_sessions`, and `user_passkeys` live alongside but do
  not alter the document schema directly.

## Lifecycle summary

1. Upload creates a `documents` row and an initial `document_versions` entry.
2. Workers generate derived assets, inserting rows into `document_assets`
   (and possibly `document_asset_objects`).
3. When a new version is promoted, a fresh `document_versions` row is written
   and `documents.current_version_id` is updated atomically.
4. Soft-deleting the document sets `deleted_at`; restore clears it and the
   document reappears in listings.

This schema allows arbitrary metadata expansion while maintaining a clear
separation between logical documents, their version history, and derived assets.
