# Roadmap v0.1

Items required for the beta release.

## General

- [ ] Document and test Docker/Kubernetes deployment thoroughly
- [x] Ensure all Rust/NPM dependencies are on recent versions
- [ ] **Launch**: Pin Docker image tags to `0.1.0` release (replace `latest-dev` in docker-compose.yml)
- [ ] **Launch**: Add `CONTRIBUTING.md` with development setup, code style, and PR guidelines
- [ ] **Launch**: Add `SECURITY.md` with vulnerability reporting policy
- [ ] **Launch**: Add GitHub issue templates (bug report, feature request)

## CI

- [ ] **Critical**: Add `cargo test` step to CI (tests never run in GitHub Actions)
- [ ] **Critical**: Add `cargo clippy` and `cargo fmt --check` to CI
- [ ] Add `npm test` step to CI for frontend
- [ ] Add `cargo audit` for dependency security scanning

## Backend

### Review & Stability
- [x] **Critical**: Connection leak risk in WebDAV authentication. [Review 1.C]
- [x] **Security**: Tenant selection/Login must validate `active` status.
- [x] **Critical**: WebDAV `Content-Length` mismatch check vs S3 actual size. [Review 3.A]
- [x] **Critical**: Refactor RLS to use `SET LOCAL` within transactions to prevent dirty connection leaks.
- [x] **Refactor**: Fix unbounded string reading in `issued_at.rs`. [Review 4.2]
- [ ] **Refactor**: Split async write methods (`upload_document`, `update_document`) so DB writes run inside `.scoped()` and S3 work runs outside. Eliminates session-level GUC fallback (`unscoped_with_tenant`).

### Helm / Deployment
- [ ] Add liveness/readiness probes to all Helm chart deployment templates
- [ ] Change default `REFRESH_COOKIE_SECURE` to `true` in production compose

## Frontend

### Critical Bugs
- [ ] **Critical**: Fix PDF Viewer memory leak on unmount (`isMounted` check).
- [ ] **Critical**: Fix Date Handling (UTC/Local mixup) in `toIssuedTimestamp`.
- [ ] **Critical**: Fix `usePreviewMetadata` infinite loop risk.
- [ ] **Critical**: Fix `CardPhysics` race condition (`requestAnimationFrame`).

### Stability
- [ ] **Critical**: Add top-level React Error Boundary with fallback UI (rendering errors currently white-screen the app)
- [ ] Remove dead dependencies (`react-redux`, `prop-types`)
- [ ] Fix broken `test:engine` script in package.json

### Build & Production
- [x] Enable webpack `splitChunks` for vendor code splitting
- [x] Extract CSS with `MiniCssExtractPlugin` (currently injected via JS, causes FOUC)
- [x] Disable source maps in production builds (currently exposes source code)
- [x] Add nginx security headers (CSP, X-Frame-Options, X-Content-Type-Options) in frontend Dockerfile
- [x] Add gzip compression to nginx config
- [x] Use `npm ci` instead of `npm install` in Dockerfile for reproducible builds

### Cleanup
- [ ] clean: Audit `apiClient` usage; migrate to Managers where appropriate (e.g. `useDocumentMutations` vs `DocumentsManager`)
- [ ] clean: Review all `ensure*` calls (ensure no double-fetching)
- [ ] clean: Rename `useDocumentsWorkspace` to match context (Component `DocumentsWorkspace` does not exist; likely `useDocumentsView`)
- [x] clean: Refactor long prop lists (e.g., `UseDocumentsPanelPropsArgs`)
- [ ] clean: Fix folder issues during tenant switch
- [x] clean: Cleanup folder ID and 'root' handling (`null` vs `'root'` opaque IDs).

### Regressions
- [ ] regression: **Verified**: `FoldersManager`: Implement `invalidateTree` (currently missing).
- [ ] regression: Folder refresh in `documentspanel` not working
- [x] regression: Moving documents to folder in sidebar does not remove them from list
- [ ] regression: Check download link expiration on `previewzoomoverlay` and `documentviewer`

### Features
- [x] feat: Trash view and restore
- [ ] arch: **Routing**: "URL as Single Source of Truth" (Fixes refresh/sync regressions).
- [x] feat: Login via Magic Token (UI Support)

## v0.2

- [ ] feat: Empty trash (bulk purge all trashed documents)
- [ ] feat: **Saved Views / Saved Searches** (persist filter/sort/folder configurations per user)
- [ ] feat: **Email Ingestion** (Sidecar, `lettre`/Python — IMAP polling, attachment extraction)
- [ ] feat: **Shared Links** (time-limited, optionally password-protected public download URLs)
- [ ] feat: Office Docs (Sidecar, Gotenberg) [Medium]
- [ ] feat: Implement `limit`/`offset` in `list_documents` query (DoS protection)
- [ ] feat: API Rate Limiting (DoS Protection) via `tower_governor`
- [ ] feat: Audit Logs (Internal Module, New Postgres Table)
- [ ] Migrate `docs/` to Hugo site (deploy from `docs/` as GitHub Pages or static hosting)
    - Feature list, screenshots, getting started guide
    - Move existing markdown docs into Hugo content structure

### Backend / API
- [ ] refactor: Batch Quickwit ingestion (Prevent bulk import lockups)
- [ ] deploy: Worker startup checks (`ffmpeg`, `ocrmypdf`)
- [ ] deploy: Verify CORS header parsing for spaces
- [ ] dev: Devcontainer
- [ ] maint: Job to remove expired refresh tokens
- [ ] maint: S3 Orphan Cleanup Job
- [ ] maint: Search Index Desync Handling
- [ ] deploy: Graceful Bucket startup check
- [ ] refactor: Frontend Type Safety (`useMatches`)
- [ ] refactor: Unify `BulkCorrespondentsRequest` assignments vs `BulkTagRequest` tag_ids
- [ ] refactor: Centralize `AssetType`/`JobType` strings
- [ ] refactor: Optimize `body_to_vec`

### Frontend
- [ ] clean: Refactor `useDocumentsWorkspace`
- [ ] polish: Desktop workspace thumbnail/sizing
- [ ] polish: Mobile layout (body scroll with sidebar)
- [ ] polish: Keyboard control hints (spacebar, etc.)
- [x] refactor: Split `AppShellContext` ("God Context" issue)
- [ ] refactor: Create `BaseManager<T>` to reduce duplication
- [ ] refactor: Generic `Entry` component (DRY)
- [ ] refactor: Generic `ResourceList` / `useResourceEditor` (DRY Panels)
- [ ] refactor: `useEntityManager` hook (consumes BaseManager)
- [ ] refactor: Centralize Drag/Drop utils (`dndUtils`)
- [ ] refactor: Typed Search Params (`toApiParams`)
- [ ] refactor: Replace custom Floating UI with library
- [ ] perf: Optimize `visibleSubfolders` (O(n) -> O(1))
- [ ] regression: Desktop workspace layout issues (filtering)
- [ ] regression: Fullscreen preview scroll position
- [ ] regression: Mixed-orientation PDF zoom/scroll
- [ ] regression: DocumentsViewer state retention

### Architecture
- [x] arch: **State Management**: Split "God Context" (`AppShellContext`) into Session/Data/Selection contexts.
- [ ] arch: **Data Layer**: Adopt React Query (or Repository Pattern) to replace ad-hoc Managers.
- [ ] arch: **Physics**: Move `CardPhysics` to Web Worker (off main-thread).
- [ ] arch: **API**: Replace Singleton with `ApiClient` Context (Dependency Injection).
- [ ] arch: **Components**: Decouple Smart/Dumb components (e.g. `Sidebar` vs `SidebarController`).

## Future

- [ ] feat: **Watched Folders / Auto-Import** (filesystem watcher sidecar for scanner drop directories)
- [ ] feat: **Auto-Matching Rules** (rules engine for auto-tagging, auto-correspondent, auto-folder based on content/filename patterns)
- [ ] feat: **Image OCR** (OCR for JPEG, PNG, TIFF — not just PDFs)
- [ ] feat: **Export / Backup** (bulk ZIP export, full tenant data export for migration/backup)
- [ ] feat: **Document Types** (classification taxonomy beyond tags/correspondents/folders)
- [ ] feat: **Custom Fields UI** (structured, user-defined metadata fields with search — backend JSON metadata exists)
- [ ] feat: **Comments / Notes** (per-document annotation and discussion)
- [ ] feat: **Notifications** (email/push alerts for processing completion, shared document access, rule matches)
- [ ] feat: **Barcode / QR Splitting** (split multi-document scans by separator pages)
- [ ] feat: **Retention Policies** (time-based automatic archival or purge rules)
- [ ] feat: **Saved Searches as Smart Folders** (virtual folders backed by search queries)
- [ ] feat: **Failed Job Handling** (surface permanently failed jobs, allow retry/dismiss, optional job debug view in frontend)
