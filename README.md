# Papercrate

![Papercrate document workspace](docs/screenshot.png)

Papercrate is a modern, open-source document management system (DMS) designed for organizing scanned documents and digital archives. It combines a fast, searchable backend with a sleek, drag-and-drop web interface.

### Features

*   **Document Management**: Organize files with folders, tags, and correspondents.
*   **OCR & Search**: Automatically extracts text from images and PDFs (via `ocrmypdf`) for full-text search (powered by Quickwit).
*   **Multi-Tenancy**: Built from the ground up to support multiple isolated tenants and users on a single instance, enforced via Postgres **Row-Level Security (RLS)** (Pro/Dev mode only).
*   **Modern Security**: exclusively uses **Passkeys (WebAuthn)** for secure, passwordless authentication.
*   **Storage Agnostic**: Stores files in any S3-compatible object store (Garage, AWS S3, Hetzner, etc.).
*   **WebDAV Support**: Access your documents directly via the filesystem using the WebDAV protocol.

## Quick Start

The default `docker-compose.yml` uses pre-built images and runs with **Row-Level Security (RLS) disabled** (superuser access). Multi-tenancy is fully functional but enforced only at the application level.

1.  Review or create `.env` (the compose file expects `POSTGRES_PASSWORD`, `JWT_SECRET`, etc.).
2.  Start the stack:

    ```bash
    docker compose up -d
    ```

3.  **Bootstrapping (Auto-Create User)**:
    Set the `PAPERCRATE_INITIAL_USER` environment variable in your `.env` file (e.g. `PAPERCRATE_INITIAL_USER=myuser`). When the stack starts, a bootstrap container will automatically create this user with a personal tenant and generate a magic login token.

    ```bash
    # Check the logs for your login token
    docker compose logs bootstrap
    ```

    *Alternatively, created manually:*
    ```bash
    docker compose exec backend /usr/local/bin/papercrate-admin create-user myuser --personal-tenant --with-token
    ```

    > **Lost your token?** You can generate a new one at any time:
    > ```bash
    > docker compose exec backend /usr/local/bin/papercrate-admin magic-token myuser
    > ```

4.  Visit `https://localhost` (or your configured domain) and log in with the token.


## Authentication

**Papercrate does not support password-based login.** Authentication is handled exclusively via:

1.  **Passkeys (WebAuthn)**: The primary login method. This requires the application to be served over **HTTPS** (or `localhost`) due to browser security restrictions.
2.  **Magic Tokens**: Used for initial account bootstrapping or recovery (via the admin CLI).

> [!IMPORTANT]
> The `WEBAUTHN_ORIGIN` environment variable must exactly match the URL in the browser (including scheme and port), or passkey registration and login will fail.

## Production Deployment

The same `docker-compose.yml` works for both local and production use. Caddy sits in front of all services and handles TLS automatically:

| Path           | Service                 |
|----------------|-------------------------|
| `/`            | Frontend (static SPA)   |
| `/api/*`       | Backend API             |
| `/download/*`  | Backend (file downloads)|
| `/webdav/*`    | WebDAV server           |

To deploy on a server:

1.  Copy `.env.prod.example` to `.env` and fill in your values:
    ```bash
    cp .env.prod.example .env
    ```

2.  Set `DOMAIN` to your hostname — Caddy will provision a Let's Encrypt certificate automatically:
    ```env
    DOMAIN=papercrate.example.com
    ```

3.  Point your DNS to the server and start the stack:
    ```bash
    docker compose up -d
    ```

## Configuration

*   **Secrets**: The stack expects `POSTGRES_PASSWORD` and `JWT_SECRET` in `.env`.
*   **Domain**: Set `DOMAIN=localhost` for local use (self-signed TLS), or a real hostname for automatic Let's Encrypt.
*   **WebAuthn**: For production, set `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `REFRESH_COOKIE_SECURE=true`, `REFRESH_COOKIE_DOMAIN`, and `CORS_ALLOWED_ORIGIN` in `.env` (see `.env.prod.example`).
*   **WebDAV**: Available at `/webdav/` on the same domain. Create a token with `webdav` capability in the UI and use it as the password.
*   **Object Storage**: The built-in Garage instance works out of the box. To use an external S3 provider, set `AWS_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_BUCKET`.

## Admin CLI

The `papercrate-admin` tool drives tenant management. Run it inside the backend container:

```bash
docker compose exec backend /usr/local/bin/papercrate-admin <command>
```

Common commands:
*   `create-user <username>`
*   `create-tenant <name>`
*   `add-user-to-tenant <username> <tenant_id>`
*   `magic-token <username>` — Generate a temporary login link
*   `users list` — List all users
*   `tenants list` — List all tenants

## Migration & Backup

A migration script is provided in `scripts/migrate.py` for exporting, importing, and migrating accounts between instances. Requires `requests` and `tqdm`.

```bash
python scripts/migrate.py export --url https://source.example.com -o ./backup
python scripts/migrate.py import --url https://target.example.com -i ./backup
python scripts/migrate.py migrate --source-url ... --target-url ...
```

API tokens are prompted securely at runtime. Pass `--token` (export/import) or `--source-token`/`--target-token` (migrate) to provide them non-interactively.

Run `python scripts/migrate.py --help` for full usage.

## Kubernetes Deployment (Helm)

For larger deployments, a Helm chart is provided in `k8s/papercrate`.

1.  Customize `k8s/papercrate/values.yaml` (especially persistence, ingress, and secrets).
2.  Install the chart:

    ```bash
    helm install papercrate ./k8s/papercrate --namespace papercrate --create-namespace
    ```

The chart includes a pre-install/upgrade hook to run database migrations automatically.

## Screenshots

![Document detail view](docs/detailview.png)
![Desk overview](docs/deskview.png)
![Document view](docs/documentview.png)

---

For development workflows (local stack, integration tests, migrations, and
configuration details) see [DEVELOPMENT.md](./DEVELOPMENT.md).
