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

### 1. Pull the Image

```bash
docker pull ghcr.io/kollaborai/mentiko:latest
```

### 2. Create Data Directory

```bash
mkdir -p ~/.mentiko/data
```

### 3. Run the Container

```bash
docker run -d \
  --name mentiko \
  -p 3000:3000 \
  -v ~/.mentiko:/app/.mentiko \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/kollaborai/mentiko:latest
```

### 4. Access the UI

Open http://localhost:3000

## System Deployment

### Using Docker Compose

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  mentiko:
    image: ghcr.io/kollaborai/mentiko:latest
    ports:
      - "3000:3000"
    volumes:
      - mentiko_data:/app/.mentiko
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
      - BETTER_AUTH_URL=http://localhost:3000
    restart: unless-stopped

volumes:
  mentiko_data:
```

**Start:**
```bash
docker-compose up -d
```

### Using Podman (Quadlet)

**mentiko.container:**
```
[Unit]
Description=Mentiko Agent Orchestration
Requires=mentiko-data.service
After=mentiko-data.service

[Container]
Image=ghcr.io/kollaborai/mentiko:latest
Volume=mentiko-data.volume:/app/.mentiko:Z
Volume=/var/run/docker.sock:/var/run/docker.sock:Z
Port=3000:3000
Environment=BETTER_AUTH_SECRET=CHANGE_ME
Environment=BETTER_AUTH_URL=http://localhost:3000

[Service]
Restart=always

[Install]
WantedBy=multi-user.target
```

**Enable:**
```bash
podman generate kube --file mentiko.yaml
systemctl --user enable --now mentiko.service
```

## SSL Setup

### Using Caddy (Recommended)

**Caddyfile:**
```
mentiko.example.com {
  reverse_proxy localhost:3000
}
```

### Using Nginx

```nginx
server {
  listen 443 ssl;
  server_name mentiko.example.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

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
# Backup data directory
tar -czf mentiko-backup-$(date +%Y%m%d).tar.gz ~/.mentiko

# Backup to remote
rclone copy mentiko-backup-*.tar.gz remote:backups/
```

**Restore:**
```bash
tar -xzf mentiko-backup-20260702.tar.gz -C ~/
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/health
```

**Expected response:**
```json
{
  "status": "ok",
  "version": "v0.3.10"
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
- Check Docker socket permissions
- Review agent profile settings

**TODO:** VPS deployment, high availability setup, monitoring integration
