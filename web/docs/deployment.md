# Deployment Guide

This guide covers local development and public self-hosting for the Mentiko
platform. SaaS control-plane and tenant provisioning are separate deployment
paths and do not belong in this public application guide.

## Environment variables

For a self-hosted install, the only required values are:

```dotenv
BETTER_AUTH_SECRET=replace-with-a-stable-secret
BETTER_AUTH_URL=https://mentiko.example.com
```

`BETTER_AUTH_SECRET` must remain stable across restarts. Generate it once with
`openssl rand -hex 32` and store it in your secret manager or `.env` file.

Optional values include `WS_ALLOWED_ORIGINS` for browser terminal access,
`MENTIKO_TERMINAL_PROXY=true` and `WS_TERMINAL_PROXY_PATH=/ws/terminal` when a
reverse proxy handles the terminal WebSocket, OAuth credentials, SMTP/Resend
mail settings, Sentry, and included-AI gateway settings. Provider API keys for
agents belong in the Mentiko secrets vault, not in the image.

## Local development

```bash
cd web
npm install
cp .env.example .env
npm run dev
```

The development server uses the repository's development process definitions.
It is not the production Docker entrypoint. Open `http://localhost:3200` when
using the checked-in development process configuration.

## Published Docker image

Releases are published as multi-architecture images on GHCR. Use a strict
versioned tag for a reproducible install:

```bash
export MENTIKO_VERSION=vX.Y.Z
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)" # generate once; keep stable

docker pull ghcr.io/kollaborai/mentiko:${MENTIKO_VERSION}
docker run -d --name mentiko \
  -p 3000:3000 \
  -p 3099:3099 \
  -v mentiko-data:/app \
  -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}" \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  ghcr.io/kollaborai/mentiko:${MENTIKO_VERSION}
```

The container listens internally on web port `3000` and terminal WebSocket
port `3099`. The left side of `-p HOST:CONTAINER` is the host port. For
example, use `-p 13000:3000` to expose the web UI on host port `13000`.
Do not use `-e PORT=13000` for host remapping; it changes the container's
internal configuration and does not replace the port mapping.

The `/app` volume contains the SQLite auth database and runtime data. Do not
mount `/app/.mentiko`, and do not mount the Docker socket for the platform
container.

## Docker Compose with a release image

The repository's `docker-compose.production.yml` is a source-build definition
for maintainers. For a self-hosted release deployment, use a compose file that
references the published image:

```yaml
services:
  mentiko:
    image: ghcr.io/kollaborai/mentiko:vX.Y.Z
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "3099:3099"
    volumes:
      - mentiko-data:/app
    environment:
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
      DATABASE_URL: file:/app/data/auth.db

volumes:
  mentiko-data:
```

Change only the image tag and host side of the port mappings for a different
release or host port. Keep `BETTER_AUTH_SECRET` stable.

## Reverse proxy and HTTPS

When using a domain, set `BETTER_AUTH_URL` and `WS_ALLOWED_ORIGINS` to the
same public origin, for example `https://mentiko.example.com`. A Caddy setup
can route the web and terminal listeners separately:

```caddyfile
mentiko.example.com {
  reverse_proxy /ws/terminal localhost:3099
  reverse_proxy localhost:3000
}
```

Set these values for that layout:

```dotenv
BETTER_AUTH_URL=https://mentiko.example.com
WS_ALLOWED_ORIGINS=https://mentiko.example.com
MENTIKO_TERMINAL_PROXY=true
WS_TERMINAL_PROXY_PATH=/ws/terminal
```

## Health, logs, and backup

```bash
curl http://localhost:3000/api/health
docker logs -f mentiko
```

Back up the named volume, including `/app/data/auth.db`, before upgrades:

```bash
docker run --rm \
  -v mentiko-data:/app:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/mentiko-backup.tar.gz -C /app .
```

Restore only after stopping the container and verifying the backup archive.

## Security checklist

- [ ] Use a stable, high-entropy `BETTER_AUTH_SECRET`.
- [ ] Pin the image to a strict `vX.Y.Z` release tag.
- [ ] Keep `/app` on persistent storage.
- [ ] Publish only the required host ports, or put them behind HTTPS.
- [ ] Configure `WS_ALLOWED_ORIGINS` when using a browser terminal.
- [ ] Back up `/app` and verify restore procedures.
- [ ] Keep provider and agent API keys out of the Docker command and image.
