# Roadmap v0.1

Items required for the beta release.

## General

- [ ] Document and test Docker/Kubernetes deployment thoroughly
- [x] Ensure all Rust/NPM dependencies are on recent versions

## Backend

### Review & Stability
- [x] **Critical**: Connection leak risk in WebDAV authentication. [Review 1.C]
- [x] **Security**: Tenant selection/Login must validate `active` status.
- [x] **Critical**: WebDAV `Content-Length` mismatch check vs S3 actual size. [Review 3.A]
- [x] **Critical**: Refactor RLS to use `SET LOCAL` within transactions to prevent dirty connection leaks.
- [x] **Refactor**: Fix unbounded string reading in `issued_at.rs`. [Review 4.2]
- [ ] **Refactor**: Split async write methods (`upload_document`, `update_document`) so DB writes run inside `.scoped()` and S3 work runs outside. Eliminates session-level GUC fallback (`unscoped_with_tenant`).
- [ ] **Deployment**: Verify `RESET_DATABASE_SQL` is not used in production/migrations. [Review 5.1]
- [ ] **Security**: API tokens should have no access to user profile.

## Frontend

### Cleanup
- [ ] clean: Audit `apiClient` usage; migrate to Managers where appropriate (e.g. `useDocumentMutations` vs `DocumentsManager`)
- [ ] **Critical**: Fix PDF Viewer memory leak on unmount (`isMounted` check).
- [ ] **Critical**: Fix Date Handling (UTC/Local mixup) in `toIssuedTimestamp`.
- [ ] **Critical**: Fix `usePreviewMetadata` infinite loop risk.
- [ ] **Critical**: Fix `CardPhysics` race condition (`requestAnimationFrame`).
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

## v0.2 / Future

- [ ] feat: Email Ingestion (Sidecar, `lettre`/Python) [Low]
- [ ] feat: Office Docs (Sidecar, Gotenberg) [Medium]
- [ ] Migrate `docs/` to a proper website
    - Feature list
    - MkDocs

### Backend / API
- [ ] feat: Implement `limit`/`offset` in `list_documents` query (DoS protection)
- [ ] feat: API Rate Limiting (DoS Protection) via `tower_governor`
- [ ] feat: Audit Logs (Internal Module, New Postgres Table)
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

- [ ] regression: DocumentsViewer state retention

### Architecture (Future)
- [x] arch: **State Management**: Split "God Context" (`AppShellContext`) into Session/Data/Selection contexts.
- [ ] arch: **Data Layer**: Adopt React Query (or Repository Pattern) to replace ad-hoc Managers.
- [ ] arch: **Physics**: Move `CardPhysics` to Web Worker (off main-thread).
- [ ] arch: **API**: Replace Singleton with `ApiClient` Context (Dependency Injection).
- [ ] arch: **Components**: Decouple Smart/Dumb components (e.g. `Sidebar` vs `SidebarController`).
