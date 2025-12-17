# API response helpers

The backend now exposes `crate::http::responders`, which wraps common success and
error patterns for routes:

- `ok_json`, `created_json`, `accepted_json` return `JsonResponse<T>` with the
  respective status codes.
- `no_content`/`empty` provide shared empty responses.
- `JsonResponse<T>` implements `IntoResponse`, so any handler can return
  `AppResult<JsonResponse<T>>` without pairing tuples manually.
- `IntoAppResult`, `RowsAffectedExt`, and friends convert Diesel results into
  `AppResult<T>` with consistent `AppError` handling.

When adding new routes, import from `crate::http::responders` instead of
constructing `(StatusCode, Json<T>)` tuples directly. The folders, documents,
auth, capability-set, correspondent, tag, and profile routers now all share
these helpers; WebDAV keeps its bespoke streaming responses for now.
