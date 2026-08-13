# Self-Hosting Mentiko

Deploy Mentiko on your own infrastructure.

## Overview

Mentiko is designed for self-hosting. This guide covers deployment on common platforms.

## Prerequisites

- Docker or Podman
- 2GB RAM minimum (4GB recommended)
- 10GB disk space
- Linux or macOS

## Quick Start (Docker)

Use a strict release tag for a reproducible install. Replace `vX.Y.Z` with the
release you intend to run; do not use `latest` for a production install.

### 1. Pull the Image

```bash
export MENTIKO_VERSION=vX.Y.Z
docker pull ghcr.io/kollaborai/mentiko:${MENTIKO_VERSION}
```

### 2. Create the Auth Secret

```bash
# Generate this once and keep it stable for the lifetime of the install.
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
```

### 3. Run the Container

```bash
docker run -d \
  --name mentiko \
  -p 3000:3000 \
  -p 3099:3099 \
  -v mentiko-data:/app \
  -e BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET}" \
  -e BETTER_AUTH_URL="http://localhost:3000" \
  ghcr.io/kollaborai/mentiko:${MENTIKO_VERSION}
```

The image listens on container ports `3000` (web) and `3099` (terminal
WebSocket). The left side of `-p HOST:CONTAINER` is the host port. For example,
`-p 13000:3000` moves the web UI to host port `13000`; do not set
`-e PORT=13000`, because the container's internal readiness and service wiring
remain on port `3000`.

### 4. Access the UI

Open http://localhost:3000

## System Deployment

### Using Docker Compose

**docker-compose.yml:**
```yaml
services:
  mentiko:
    image: ghcr.io/kollaborai/mentiko:vX.Y.Z
    ports:
      - "3000:3000"
      - "3099:3099"
    volumes:
      - mentiko_data:/app
    environment:
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
      DATABASE_URL: file:/app/data/auth.db
    restart: unless-stopped

volumes:
  mentiko_data:
```

**Start:**
```bash
docker compose up -d
```

### Using Podman (Quadlet)

Create a rootless named volume, then save this as
`~/.config/containers/systemd/mentiko.container`:

```
[Unit]
Description=Mentiko Agent Orchestration

[Container]
Image=ghcr.io/kollaborai/mentiko:vX.Y.Z
Volume=mentiko-data:/app:Z
PublishPort=3000:3000
PublishPort=3099:3099
Environment=BETTER_AUTH_SECRET=CHANGE_ME
Environment=BETTER_AUTH_URL=http://localhost:3000
Environment=DATABASE_URL=file:/app/data/auth.db

[Service]
Restart=always

[Install]
WantedBy=default.target
```

**Create and enable:**
```bash
podman volume create mentiko-data
systemctl --user daemon-reload
systemctl --user enable --now mentiko.service
```

## SSL Setup

### Using Caddy (Recommended)

**Caddyfile:**
```
mentiko.example.com {
  reverse_proxy /ws/terminal localhost:3099
  reverse_proxy localhost:3000
}
```

When using a domain, set `BETTER_AUTH_URL` and `WS_ALLOWED_ORIGINS` to the
`https://mentiko.example.com` URL. Set `MENTIKO_TERMINAL_PROXY=true` and
`WS_TERMINAL_PROXY_PATH=/ws/terminal` when the reverse proxy exposes the
terminal WebSocket on that path.

### Using Nginx

```nginx
server {
  listen 443 ssl;
  server_name mentiko.example.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  location /ws/terminal {
    proxy_pass http://localhost:3099;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }

  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## Backup Strategy

**Daily backup:**
```bash
# Backup the persistent /app volume, including SQLite auth data.
docker run --rm \
  -v mentiko-data:/app:ro \
  -v "$PWD":/backup \
  alpine tar czf "/backup/mentiko-backup-$(date +%Y%m%d).tar.gz" -C /app .

# Backup to remote
rclone copy mentiko-backup-*.tar.gz remote:backups/
```

**Restore:**
```bash
# Stop Mentiko first, then restore into the named volume.
docker run --rm \
  -v mentiko-data:/app \
  -v "$PWD":/backup \
  alpine tar xzf /backup/mentiko-backup-20260702.tar.gz -C /app
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/health
```

**Expected response:**
```json
{
  "status": "ok"
}
```

### Logs

```bash
docker logs -f mentiko
```

## Troubleshooting

**Container won't start:**
- Check disk space: `df -h`
- Verify port 3000 is available: `lsof -i :3000`
- Review logs: `docker logs mentiko`

**Agents can't connect:**
- Verify workspace configuration
- Verify both host ports `3000` and `3099` are published
- If using a reverse proxy, verify the `/ws/terminal` WebSocket route and origin
- Review agent profile settings

**TODO:** VPS deployment, high availability setup, monitoring integration
