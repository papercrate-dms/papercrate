# Papercrate

![Papercrate document workspace](docs/screenshot.png)

## Single-Host Deployment (Docker Compose)

For self-hosting (for example on a Raspberry Pi), use the production-oriented
`docker-compose.yml`. Define the required secrets in a `.env` file alongside the
compose file before starting the stack:

```bash
cat <<'EOF' > .env
POSTGRES_PASSWORD=change-me
MINIO_ROOT_PASSWORD=change-me-too
JWT_SECRET=generate-a-long-random-string
WEBAUTHN_RP_ID=papercrate.local
WEBAUTHN_ORIGIN=http://papercrate.local:8080
# Optional overrides
# CORS_ALLOWED_ORIGIN=http://papercrate.local:8080
# REFRESH_COOKIE_SECURE=true
EOF

docker compose build
docker compose up -d
```

**Important:** the WebAuthn settings must match the public URL clients will use.
The relying party (RP) identifier is the bare host name, while the origin must
include scheme and port. Adjust the values above if you serve Papercrate from a
different host, domain, or HTTPS endpoint—otherwise passkey registration and
login will fail.

The compose file builds the backend and frontend images locally, then launches
Postgres, MinIO, Quickwit, the API, background worker, WebDAV endpoint, and the
SPA frontend. Once the containers report healthy, visit `http://<host>:8080`
and use the passkey signup flow to provision the first tenant/user. Upgrades are
as simple as `git pull` followed by `docker compose up -d`.

## Screenshots

![Document detail view](docs/detailview.png)
![Desk overview](docs/deskview.png)
![Document view](docs/documentview.png)

---

For development workflows (local stack, integration tests, migrations, and
configuration details) see [DEVELOPMENT.md](./DEVELOPMENT.md).
