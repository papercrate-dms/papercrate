# Development

This document collects runtime assumptions and workflows for local development,
integration testing, and infrastructure automation.

## Local Development

The entire application stack (frontend, backend, worker, database, minio, quickwit) runs fully containerized via Docker Compose.

### Start Development Environment

To start the stack (builds are handled automatically):

```bash
docker compose -f docker-compose.dev.yml up --build
```

### Apply Code Changes

Hot-reloading is handled automatically by `cargo watch` inside the container.
When you save files in `backend/src`, the watcher will:

1.  Rebuild the modified binaries.
2.  Restart the `backend`, `worker`, and `webdav` services via `supervisord`.

No manual restart is required.

### Running Migrations

Since `diesel-cli` runs inside the container:

```bash
# Run pending migrations
docker compose -f docker-compose.dev.yml exec server diesel migration run

# Revert last migration
docker compose -f docker-compose.dev.yml exec server diesel migration revert

# Create new migration
docker compose -f docker-compose.dev.yml exec server diesel migration generate name_of_migration
```

The development Postgres container now seeds two database roles:

- `papercrate_app_login` (password `papercrate_app`) is used by the backend and
  is subject to row-level security policies.
- `papercrate` remains the owner role for running Diesel migrations or other
  maintenance tasks.

When connecting manually to inspect RLS behaviour, switch to the application
role with `SET ROLE papercrate_app_login;` before querying tenant tables.

## Backend Integration Tests

Integration tests run in a dedicated, ephemeral container stack. The repository includes a lightweight compose file that provisions a fresh Postgres instance (using tmpfs) and Quickwit for every run.

To run the tests:

```bash
docker compose -f docker-compose.test.yml run --rm test-runner
```

This will:
1.  Spin up `postgres-test` and `quickwit-test` (in background if not running).
2.  Start the `test-runner` container.
3.  Wait for DB, run migrations, and execute `cargo test`.
4.  Remove the runner container after exit.

To clean up the infrastructure afterwards:
```bash
docker compose -f docker-compose.test.yml down
```

The compose service uses tmpfs storage, giving each test run a clean database.

## Runtime Dependencies

- `ocrmypdf`: Used by the worker to extract text from images. If missing, the worker logs a warning and skips text extraction for that document.
- `Quickwit`: Used for full-text search. If configured (via `QUICKWIT_ENDPOINT`), the worker pushes extracted text to the index. If missing, search features will simply be unavailable.

## Configuration

The backend reads its settings from environment variables. In particular:

- `DATABASE_URL` – connection string for the primary Postgres database (required).
- `DATABASE_MAX_POOL_SIZE` – optional override for the r2d2 connection pool size.
  Defaults to `2`; increase it in staging/production to match expected concurrency.
- `PROXY_DOWNLOADS` – set to `true` when the object store is only reachable from
  the backend network. When enabled, `/api/download/{token}` and asset-object fetches
  stream bytes through the API instead of redirecting clients to S3/Hetzner.

On startup each binary logs the effective configuration with secrets redacted
(for example, the database password is masked). This makes it easier to confirm
runtime settings in staging without exposing credentials.

## Running Migrations in Kubernetes

The backend container image ships with the `papercrate-admin` binary, which can execute schema migrations
as a short-lived Job (or Helm hook) before rolling out new pods. Example manifest:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: papercrate-migrate
spec:
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migrate
          image: ghcr.io/example/papercrate-backend:<TAG>
          command: ["/usr/local/bin/papercrate-admin", "migrate-database"]
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: papercrate-db
                  key: DATABASE_URL

            - name: MIGRATIONS_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: papercrate-db
                  key: DATABASE_URL
```

Run the Job manually or use the Helm hooks configured in `k8s/papercrate/templates/migrate-job.yaml`. The `papercrate-admin` binary is built specifically for administrative tasks.
