# Deployment Guide

How to deploy Agent Chain in various environments.

---

## Environment Variables

Create a `.env` file in the `web/` directory:

```bash
# Required for production
BETTER_AUTH_SECRET=your-better-auth-secret
BETTER_AUTH_URL=https://your-domain.example

# Optional: Custom paths
AGENT_CHAIN_ROOT=/path/to/agent chains
AGENT_CHAIN_BIN=/usr/local/bin

# Optional: Default namespace
DEFAULT_TENANT=default

# Optional: Custom session prefix
SESSION_PREFIX=ac

# Optional: Anthropic API (for chain generation)
ANTHROPIC_API_KEY=your-api-key
```

### Security Notes

1. **Never commit `.env` files** - Add to `.gitignore`
2. **Use strong session secrets** - Set strong `BETTER_AUTH_SECRET` for production
3. **Rotate secrets** - Change session secrets periodically
4. **Use secrets management** - In production, use env-specific secret stores

---

## Local Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Agent Chain CLI installed

### Setup

```bash
# Clone repository
git clone https://github.com/your-org/mentiko.git
cd mentiko/web

# Install dependencies
npm install

# Copy env template
cp .env.example .env
# Edit .env with your settings

# Run dev server
npm run dev
```

Access at `http://localhost:3000`

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package*.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
      - BETTER_AUTH_URL=${BETTER_AUTH_URL}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - AGENT_CHAIN_ROOT=/app/chains
    volumes:
      - ./chains:/app/chains
      - ./agents:/app/agents
    restart: unless-stopped

  # Optional: nginx reverse proxy
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - web
    restart: unless-stopped
```

### Running with Docker

```bash
# Build image
docker build -t mentiko-web .

# Run container
docker run -d \
  -p 3000:3000 \
  -e BETTER_AUTH_SECRET=your-secret \
  -e BETTER_AUTH_URL=https://your-domain.example \
  -v $(pwd)/chains:/app/chains \
  -v $(pwd)/agents:/app/agents \
  --name mentiko \
  mentiko-web

# Or with compose
docker-compose up -d
```

---

## Cloud Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
cd web
vercel

# Set environment variables in Vercel dashboard:
# - BETTER_AUTH_SECRET
# - ANTHROPIC_API_KEY (optional)
```

**vercel.json** (optional config):

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "framework": "nextjs",
  "env": {
    "BETTER_AUTH_SECRET\": \"<secret>\",
    "BETTER_AUTH_URL": "https://your-domain.example",
    "ANTHROPIC_API_KEY": "@anthropic-api-key"
  }
}
```

### AWS

#### Using ECS/Fargate

1. Push Docker image to ECR
2. Create ECS task definition
3. Configure load balancer
4. Set environment variables in task definition

#### Using EC2

```bash
# Launch EC2 instance (Ubuntu 22.04)

# SSH in
ssh ubuntu@your-ec2-ip

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu

# Create app directory
mkdir -p /opt/mentiko
cd /opt/mentiko

# Copy your docker-compose.yml
# Copy .env with production values

# Start
docker-compose up -d

# Configure nginx reverse proxy
sudo apt install nginx
sudo cp nginx.conf /etc/nginx/sites-available/mentiko
sudo ln -s /etc/nginx/sites-available/mentiko /etc/nginx/sites-enabled/
sudo systemctl reload nginx
```

### Google Cloud Run

```bash
# Build and push image
gcloud builds submit --tag gcr.io/PROJECT_ID/mentiko

# Deploy
gcloud run deploy mentiko \
  --image gcr.io/PROJECT_ID/mentiko \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars BETTER_AUTH_SECRET=your-secret,BETTER_AUTH_URL=https://your-domain.example
```

### Azure Container Instances

```bash
# Create resource group
az group create --name mentiko-rg --location eastus

# Create container
az container create \
  --resource-group mentiko-rg \
  --name mentiko \
  --image your-registry/mentiko \
  --dns-name-label mentiko-unique \
  --ports 80 \
  --environment-variables BETTER_AUTH_SECRET=your-secret BETTER_AUTH_URL=https://your-domain.example
```

---

## Reverse Proxy (nginx)

Recommended for production deployments.

### nginx.conf

```nginx
upstream mentiko {
    server localhost:3000;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    location / {
        proxy_pass http://mentiko;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts for long-running chains
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }

    # WebSocket support for SSE
    location /api/events/stream {
        proxy_pass http://mentiko;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding off;
    }
}
```

### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal (configured automatically)
sudo certbot renew --dry-run
```

---

## Multi-Namespace Setup

For hosting multiple teams/organizations:

### Architecture

```
/opt/mentiko/
├── namespaces/
│   ├── namespace-a/
│   │   ├── chains/
│   │   └── agents/
│   ├── namespace-b/
│   │   ├── chains/
│   │   └── agents/
│   └── shared/
│       └── templates/
```

### Configuration

```bash
# .env
DEFAULT_TENANT=shared
TENANT_CONFIG_DIR=/opt/mentiko/namespaces
```

### Namespace Selection

Namespaces are selected via HTTP header or subdomain:

```bash
# Via header
curl -H "X-Namespace-ID: namespace-a" https://mentiko.com/api/chains/list

# Via subdomain (requires DNS config)
https://namespace-a.mentiko.com
```

---

## Monitoring & Logging

### Health Checks

```bash
# Simple health check
curl https://your-domain.com/api/health

# Expected response
{"status":"ok","version":"1.0.0"}
```

### Application Logging

Logs are written to:
- **Development**: Console output
- **Docker**: `docker logs mentiko`
- **Systemd**: `/var/log/mentiko/`

### Metrics Endpoint

```bash
curl https://your-domain.com/api/metrics
```

Returns:
- Run counts by status
- Agent performance metrics
- Token usage statistics

### Prometheus Integration (Optional)

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'mentiko'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/prometheus'
```

---

## Scaling Considerations

### Vertical Scaling

For moderate loads (<100 concurrent runs):
- 2 CPU cores
- 4GB RAM
- Handles ~10-20 active chains

### Horizontal Scaling

For high loads, deploy multiple instances behind a load balancer:

1. Use shared storage for chains (NFS, S3)
2. Configure sticky sessions for SSE
3. Use Redis for shared state (future)

### Database Mode (Future)

For large-scale deployments, a database backend will be added to support:
- Shared state across instances
- Persistent run history
- Multi-region deployment

---

## Backup & Recovery

### Backup Chains

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR=/backups/mentiko
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup chains
tar -czf $BACKUP_DIR/chains_$DATE.tar.gz /opt/mentiko/namespaces/*/chains/

# Backup runs (optional, can be large)
tar -czf $BACKUP_DIR/runs_$DATE.tar.gz /opt/mentiko/agents/runs/

# Keep last 30 days
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
```

### Restore

```bash
#!/bin/bash
# restore.sh

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./restore.sh <backup_file.tar.gz>"
  exit 1
fi

tar -xzf $BACKUP_FILE -C /
```

### Automated Backups

Add to crontab:

```
# Daily backup at 2am
0 2 * * * /opt/scripts/backup.sh
```

---

## Security Checklist

Before deploying to production:

- [ ] Strong `BETTER_AUTH_SECRET` set (32+ chars)
- [ ] HTTPS enabled with valid SSL
- [ ] Firewall rules configured (allow only 80/443)
- [ ] Rate limiting enabled
- [ ] Log rotation configured
- [ ] Regular backups scheduled
- [ ] Monitoring/alerting set up
- [ ] Error pages don't leak information
- [ ] CORS configured if needed
- [ ] Session timeout configured
- [ ] DNS security (DNSSEC, SPF records)
