# Mentiko Production Rollback Runbook

**Purpose**: Step-by-step rollback procedures for a mentiko deployment —
app container(s), tenant instances (if multi-tenant), and database.

**See also**: `docs/ROLLBACK_ARCH3.md` — supplement for rolling back the
ARCH-3 change (session-only tenant resolution, commit a5a0ab90).

**Last Updated**: 2026-04-23

This doc focuses on generic rollback patterns that apply to any Mentiko
self-hoster. Operator-specific procedures should live outside this public repo.

---

## Architecture overview (reference)

A mentiko deployment typically has:

- **App container(s)**: the platform (`ghcr.io/<your-org>/mentiko`),
  pulled from GHCR, run under docker-compose, podman Quadlet, or k8s.
- **Database**: postgres 16 (for multi-tenant deployments) or sqlite
  (`~/.mentiko/data/auth.db` for the tenant/single-instance case).
- **Reverse proxy**: whatever your TLS terminator is (caddy, nginx, traefik).
- **Optional management layer**: only if you're running multi-tenant.
  Self-hosters usually aren't.

Everything below assumes you have SSH into the host, image-pull access
to GHCR (public image, no auth needed for pull), and the ability to
edit compose / systemd / k8s manifests.

---

## TL;DR emergency rollback

```bash
# Docker-compose deployment — pull a pinned previous tag and recreate:
ssh <your-ssh-user>@<your-vps>
cd /opt/mentiko     # or wherever your deployment lives
# Edit docker-compose.yml: change image tag to :<previous-commit-sha>
docker compose pull app
docker compose up -d --force-recreate app

# Podman Quadlet deployment — flip image digest in the .container file:
sudo sed -i "s|^Image=.*|Image=ghcr.io/<your-org>/mentiko@sha256:<previous-digest>|" \
  /etc/containers/systemd/mentiko-<slug>.container
sudo systemctl daemon-reload
sudo systemctl restart mentiko-<slug>

# Database schema rollback — drop the newly added column (ONLY if safe):
ALTER TABLE <table> DROP COLUMN IF EXISTS <problematic_column>;
# Then restart the app.
```

---

## 1. App container rollback

### How it works

- The platform image is published to GHCR with both `:latest` and per-commit tags:
  - `ghcr.io/<your-org>/mentiko:latest`
  - `ghcr.io/<your-org>/mentiko:<commit-sha>`
- For reproducible rollbacks, **always pin to a specific tag or digest**
  in production — don't rely on `:latest` moving backward.

### Finding previous image tags

```bash
# Option 1: GHCR API (requires GH token, but public list works too)
gh api /orgs/<your-org>/packages/container/mentiko/versions \
  --jq '.[].metadata.container.tags[]' | head -20

# Option 2: Recent CI builds (if you're the one doing CI)
gh run list --repo kollaborai/mentiko --limit 10

# Option 3: Local image cache on your host
docker images ghcr.io/<your-org>/mentiko
# or: sudo podman images ghcr.io/<your-org>/mentiko
```

### Rollback procedure (docker-compose)

```bash
# Step 1: SSH in
ssh <your-ssh-user>@<your-vps>
cd /opt/mentiko

# Step 2: Pull the previous image
docker pull ghcr.io/<your-org>/mentiko:<previous-commit-sha>

# Step 3: Edit your compose file to pin the rollback tag
# (Replace `:latest` with `:<previous-commit-sha>`.)
vi docker-compose.yml

# Step 4: Recreate the app container
docker compose up -d --force-recreate app

# Step 5: Verify health
docker logs <app-container> --tail 20
curl -sf http://localhost:3000/api/health | jq .
```

### Rollback procedure (Podman Quadlet)

Podman Quadlet files (`/etc/containers/systemd/<name>.container`) pin
image by digest. Rollback is to flip `Image=` back to the previous digest
and restart the service.

```bash
sudo sed -i "s|^Image=.*|Image=ghcr.io/<your-org>/mentiko@sha256:<previous-digest>|" \
  /etc/containers/systemd/mentiko-<slug>.container
sudo systemctl daemon-reload
sudo systemctl restart mentiko-<slug>

# Verify
sudo journalctl -u mentiko-<slug> --no-pager -n 20
curl -sf http://127.0.0.1:3000/api/health
```

### Automatic rollback hooks (if you have them)

If your rolling-deploy code includes a health check with automatic
rollback (the platform ships one — `lib/infra/platform-deploy.ts`),
rollback happens for you:

1. Deploy pulls new image, updates Quadlet, restarts.
2. Health check runs (5 attempts, 5s delay).
3. **If health fails**: automatically restores the previous `Image=`
   line and restarts.
4. Returns `rolled_back` status in deploy results.

---

## 2. Database rollback

### How schema changes work in this repo

- **No migration system** — schemas use `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
- This is mostly **forward-compatible** but not backward-compatible.
- Default database in production is **PostgreSQL 16**; sqlite is used
  for the single-instance tenant and for the `~/.mentiko/data/auth.db` store.

### The problem with ALTER TABLE

```sql
-- Safe (idempotent):
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS new_col varchar(50);

-- NOT safe for rollback:
ALTER TABLE tenant DROP COLUMN new_col;  -- data loss!
```

### Rollback strategies

#### Strategy A: New column is optional (best case)

If the new column has `DEFAULT` values and is nullable:

```bash
# Do nothing — old code will ignore the new column.
# The column stays, no rollback needed.

# Verify it's not causing issues:
docker exec <postgres-container> psql -U mentiko -c "
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'tenant'
  ORDER BY ordinal_position;
"
```

#### Strategy B: Drop the column (last resort)

**WARNING**: Only do this if you're certain the column is unused and
was added in the failing deploy.

```bash
# Backup first!
docker exec <postgres-container> pg_dump -U mentiko mentiko > /tmp/backup-$(date +%s).sql

# Drop the problematic column
docker exec <postgres-container> psql -U mentiko -c "
  ALTER TABLE tenant DROP COLUMN IF EXISTS problematic_column;
"

# Restart the app to pick up the schema change
docker compose restart app
```

#### Strategy C: Full database restore (nuclear option)

```bash
# Step 1: Stop all containers
docker compose stop

# Step 2: List available backups
ls -lh /opt/mentiko/backups/

# Step 3: Restore from backup
docker compose up -d postgres
docker exec -i <postgres-container> psql -U mentiko < /path/to/backup.sql

# Step 4: Start app
docker compose up -d
```

See `docs/BACKUP_SETUP.md` for the backup pipeline.

### Preventing database rollback pain

**Best practices for schema changes:**

1. **Add columns, don't remove**: Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
2. **Make new columns nullable**: with sensible defaults.
3. **Write backward-compatible code**: check for column existence before using.
4. **Test with old code**: verify previous version works with new schema.

Example safe change:

```sql
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS new_feature_enabled BOOLEAN DEFAULT false;
```

```ts
// Backward compatible
const featureEnabled = row.new_feature_enabled ?? false;
```

---

## 3. Tracking previous known-good images

### Current state (open-source repo)

- The public image published to GHCR has both `:latest` and per-commit
  tags. Pull either one by name.
- For production, pin to a commit tag or digest in your compose /
  Quadlet files, not `:latest`.

### Recommended: store the last-known-good somewhere

```bash
# After each successful deploy, record the running digest:
docker inspect --format='{{.Image}}' <app-container> > /opt/mentiko/last-known-good.txt

# Or for Quadlet:
grep '^Image=' /etc/containers/systemd/mentiko-*.container \
  > /var/lib/mentiko/last-known-good.txt
```

This gives you a cheap rollback target without needing to hit GHCR.

### Using GHCR as image history

```bash
# List recent tags for the tenant image
gh api /orgs/<your-org>/packages/container/mentiko/versions \
  --jq '.[] | select(.metadata.container.tags | length > 0) |
         {tags: .metadata.container.tags[0], updated: .updated_at}' | \
  head -10

# List recent digests
gh api /orgs/<your-org>/packages/container/mentiko/versions \
  --jq '.[] | {digest: .metadata.container.digest, updated: .updated_at}' | \
  head -10
```

---

## 4. Time estimates

| Scenario | Time to rollback | Notes |
|----------|------------------|-------|
| App image (tag known) | 2–3 min | pull + recreate |
| App image (find tag first) | 5–8 min | GHCR lookup + pull + recreate |
| Single tenant (auto-rollback) | 1–2 min | built-in to the rolling deploy |
| Single tenant (manual) | 3–5 min | SSH + edit manifest + restart |
| All tenants | depends on deployment size | serial or parallel; stop at first failure |
| Database (drop column) | 2–3 min | + app restart |
| Database (full restore) | 10–20 min | depends on backup size |

---

## 5. Decision tree

```
                    Something is broken
                            |
                ┌───────────┴───────────┐
                │                       │
          App container?          Tenant host?
                │                       │
                ▼                       ▼
    Is it the image or code?    Is auto-rollback configured?
                │                       │
        ┌───────┴───────┐           Yes → Done
        │               │               │
    Image           Code?          No → Manual rollback
    (section 1)        │                      │
                    ┌──┴────┐           (section 1)
                DB issue?  Code only
                    │           │
                    ▼           Revert image
               (section 2)  (section 1)
```

---

## 6. Pre-deploy checklist

Before deploying, verify you can rollback:

```bash
# 1. Note current running image (for the rollback target)
docker inspect --format='{{.Image}}' <app-container>

# 2. Verify GHCR access (if you need to pull older tags)
gh auth status

# 3. Take a DB backup if the deploy includes schema changes
docker exec <postgres-container> pg_dump -U mentiko mentiko | gzip > \
  /opt/mentiko/backups/pre-deploy-$(date +%s).sql.gz

# 4. Confirm you have the previous commit SHA written down somewhere
```

---

## 7. Post-rollback verification

```bash
# App health
curl -sf https://<your-prod-host>/api/health | jq .

# Database connectivity
docker exec <postgres-container> psql -U mentiko -c 'SELECT 1;'

# Recent errors in logs
docker logs <app-container> --tail 200 | grep -i error
```

---

## 8. Common rollback scenarios

### Scenario A: Deploy broke the app API

```bash
# Symptom: 500s, /api/health failing
# Cause: new image has a bug
# Fix: pull previous image, pin in compose, recreate (section 1).
```

### Scenario B: Database migration broke things

```bash
# Symptom: app starts but API returns errors about missing/wrong columns
# Cause: code out of sync with schema
# Fix: Strategy B (drop the new column) if it's safe, otherwise
#      forward-roll to a patched image that handles the column.
```

### Scenario C: Tenant-specific break

```bash
# Symptom: one tenant failing, others OK
# Cause: tenant-specific data issue, or host-level problem
# Fix:
#   SSH into that host, inspect logs (journalctl / docker logs).
#   If image issue: roll back per section 1.
#   If data issue: restore from backup.
```

---

## Appendix: quick reference

### Running container inspection

```bash
docker ps                                         # containers running
docker logs <container> --tail 100                # last 100 log lines
docker exec -it <container> sh                    # shell inside
```

### Image registry

```bash
# Public registry, pull without auth:
docker pull ghcr.io/<your-org>/mentiko:<tag>

# List tags you already have locally:
docker images ghcr.io/<your-org>/mentiko
```

### Database

```bash
# Connect to postgres
docker exec -it <postgres-container> psql -U mentiko

# Dump
docker exec <postgres-container> pg_dump -U mentiko mentiko > dump.sql

# Restore
docker exec -i <postgres-container> psql -U mentiko < dump.sql
```
