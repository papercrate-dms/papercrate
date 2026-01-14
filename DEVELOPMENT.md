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

*   **Backend**: The `server` container runs `cargo watch`. Changes to `backend/src` will automatically trigger a recompile and restart.
*   **Frontend**: The frontend uses Webpack with Hot Module Replacement (HMR). Changes to `frontend/src` are reflected immediately in the browser.
*   **Supervisord**: The backend container uses `supervisord` to run the API server, background worker, and WebDAV server simultaneously. This is a development-only pattern to share the build cache and simplify startup.
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

- `papercrate_app_login` (password `papercrate_app`) is the restricted role used in
  production configurations. It is subject to row-level security policies.
- `papercrate` remains the owner role. The **local development backend** connects as
  this role (via `docker-compose.dev.yml`) to simplify running migrations and
  maintenance tasks during development.

When connecting manually to inspect RLS behaviour, switch to the application
role with `SET ROLE papercrate_app_login;` before querying tenant tables.

## Admin CLI & Setup

In the development environment, the `papercrate-admin` binary is **not** installed to the system PATH. You must run it via `cargo`.

### Setup Instructions (First Run)

Run these commands inside the `server` container (e.g., `docker compose -f docker-compose.dev.yml exec server ...`).
If using a custom project name (e.g., `-p scratch`), append that flag to the `docker compose` command.

**1. Create a User**
```bash
cargo run --bin admin -- create-user "<USERNAME>"
```

**2. Create a Tenant**
```bash
# Copy the output UUID!
cargo run --bin admin -- create-tenant "<TENANT_NAME>"
```

**3. Add User to Tenant**
```bash
cargo run --bin admin -- add-user-to-tenant "<USERNAME>" <TENANT_ID>
```

**4. Generate Magic Token**
```bash
cargo run --bin admin -- magic-token "<USERNAME>"
```

## Integration Testing

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

*   `DATABASE_URL`: Connection string for the *application* (runtime). In dev, this uses the restricted `papercrate_app_login` user (enforces RLS).
*   `MIGRATIONS_DATABASE_URL`: Connection string for *migrations*. This must use a superuser or owner role (`papercrate`) to modify schema and RLS policies.
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
