# audit log remote setup (S3-compatible object storage)

SOC2 requires audit logs to be stored separately from application data.
this document covers provisioning an S3-compatible object-storage bucket
and configuring the platform to ship audit entries remotely via rclone.

Any S3-compatible backend will work. Common choices: AWS S3, Cloudflare R2,
Backblaze B2, Linode Object Storage, MinIO. Examples below use Linode
Object Storage; substitute your provider's endpoint + CLI as needed.

## overview

audit-ship.sh runs as a background process when an audit entry is written.
if AUDIT_REMOTE_URL is unset, the shipper is disabled (silent no-op).
feature: OFF BY DEFAULT until ops provisioning is complete.

## prerequisites

- access to your provider's CLI or web console (to create the bucket and
  access keys). For Linode Object Storage, `linode-cli` is already
  installed in the container image.
- container runtime has `rclone` available (pre-installed in the image).

## step 1: provision an object-storage bucket

Create a dedicated bucket for audit logs. Naming is up to you — a
common pattern is `<your-app>-audit-<env>`, e.g. `myapp-audit-prod`.

```bash
# example: Linode Object Storage
linode-cli configure
linode-cli obj create-bucket <your-audit-bucket>
linode-cli obj list-buckets

# example: AWS S3
aws s3api create-bucket --bucket <your-audit-bucket> --region us-east-1

# example: Cloudflare R2
wrangler r2 bucket create <your-audit-bucket>
```

Buckets are typically region-specific. Pick one close to your tenant
compute for lower upload latency.

## step 2: generate access keys

create credentials specifically for audit shipping (principle of least
privilege — scope to the audit bucket only).

```bash
# example: Linode Object Storage
linode-cli obj create-key <your-audit-bucket>
#   access_key:    xxxxxxxxxxxxxxxx
#   secret_key:    yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
#   object_store_cluster: us-east-1

# example: AWS S3 (create an IAM user with s3:PutObject on the bucket)
aws iam create-access-key --user-name mentiko-audit-writer

# save these securely — they'll be set as env vars on tenant containers.
```

## step 3: configure tenant containers

set these environment variables on each tenant container (via docker-compose,
kubernetes secrets, or container runtime config).

```bash
# the S3 endpoint for your provider
# Linode:      https://{cluster}.linodeobjects.com
# Cloudflare:  https://{account_id}.r2.cloudflarestorage.com
# AWS S3:      (leave blank — AWS SDK resolves per region)
# MinIO:       https://minio.your-domain.tld
AUDIT_S3_ENDPOINT=https://<region>.<provider>.com

# the remote URL with bucket + tenant prefix
# {NAMESPACE_ID} is replaced at runtime with the tenant's namespace
AUDIT_REMOTE_URL=s3://<your-audit-bucket>/tenants/{NAMESPACE_ID}/

# access credentials (from step 2)
AUDIT_REMOTE_ACCESS_KEY=xxxxxxxxxxxxxxxx
AUDIT_REMOTE_SECRET_KEY=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy

# tenant namespace (set per-container if multi-tenant; single-tenant
# installs typically leave this as "default")
NAMESPACE_ID=default
```

### example: docker-compose.yml

```yaml
services:
  platform:
    image: ghcr.io/<your-org>/mentiko:latest
    environment:
      AUDIT_S3_ENDPOINT: "https://<region>.<provider>.com"
      AUDIT_REMOTE_URL: "s3://<your-audit-bucket>/tenants/{NAMESPACE_ID}/"
      AUDIT_REMOTE_ACCESS_KEY: "xxxxxxxxxxxxxxxx"
      AUDIT_REMOTE_SECRET_KEY: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
      NAMESPACE_ID: "default"
```

### example: kubernetes secret + deployment

```bash
# create secret with audit credentials
kubectl create secret generic audit-remote \
  --from-literal=access_key=xxxxxxxxxxxxxxxx \
  --from-literal=secret_key=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mentiko
spec:
  template:
    spec:
      containers:
      - name: platform
        image: ghcr.io/<your-org>/mentiko:latest
        env:
        - name: AUDIT_S3_ENDPOINT
          value: "https://<region>.<provider>.com"
        - name: AUDIT_REMOTE_URL
          value: "s3://<your-audit-bucket>/tenants/{NAMESPACE_ID}/"
        - name: AUDIT_REMOTE_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: audit-remote
              key: access_key
        - name: AUDIT_REMOTE_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: audit-remote
              key: secret_key
        - name: NAMESPACE_ID
          value: "default"
```

## step 4: set bucket retention policy (SOC2 compliance)

SOC2 requires that audit records cannot be tampered with or deleted
before the retention window closes. Two mechanisms apply:

**Object-lock (write-once-read-many)** — prevents modification or
deletion of audit objects within a retention window. This is the
SOC2-relevant control. **This must be enabled at bucket creation; it
cannot be turned on for an existing bucket.** See step 4a.

**Lifecycle policy** — deletes objects AFTER the retention window
expires, to cap storage costs. Compatible with object-lock — once the
lock window clears, lifecycle is free to delete. See step 4b.

### step 4a: object-lock (primary control)

Use the helper script `scripts/audit-bucket-setup.sh`. It wraps the
three S3 API calls needed to configure a new bucket (create with
object-lock, enable versioning, set default retention).

```bash
# source your env (AUDIT_REMOTE_ACCESS_KEY + SECRET + S3_ENDPOINT + BUCKET)
source /opt/<your-app>/ops/.audit.env

# preview the AWS calls without hitting the network
./scripts/audit-bucket-setup.sh --create --dry-run

# for real (creates bucket with 1-year GOVERNANCE-mode retention)
./scripts/audit-bucket-setup.sh --create

# verify
./scripts/audit-bucket-setup.sh --verify
```

Flags:
- `--mode GOVERNANCE` (default) — retention is enforced but a user with
  the `s3:BypassGovernanceRetention` permission can still delete. Right
  call for day-to-day SOC2.
- `--mode COMPLIANCE` — retention is absolute. Even the root account
  cannot delete before expiry. Use only if a customer contract (e.g.
  FINRA 17a-4) requires it.
- `--days 365` (default) — retention window.

**Migrating an existing bucket to object-lock**: if the bucket was
created without `--object-lock-enabled-for-bucket`, you must create a
new bucket (e.g. `<your-audit-bucket>-v2`), copy historical objects across
via `rclone copyto`, then update tenant containers to point at the new
`AUDIT_REMOTE_URL`. This is non-trivial; plan it during a maintenance
window.

**Post-enable verification**: after turning on object-lock on a bucket
that tenant containers are already shipping to, tail
`ship-failures.log` for 10 minutes:

```bash
# inside the running container (or on the host, for bind-mounted data)
tail -F /app/namespaces/*/audit/ship-failures.log
```

The existing `rclone copyto` in `lib/audit-ship.sh` works against
object-lock-enabled buckets without code changes — default retention
applies automatically. But a rclone version or credential mismatch
would show up here fast.

### step 4b: lifecycle policy (cost cap)

After objects age out of the object-lock window, a lifecycle policy
deletes them to bound storage cost:

```bash
# create a lifecycle policy file
cat > /tmp/lifecycle.json <<'EOF'
{
  "Rules": [
    {
      "ID": "audit-retention",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "Expiration": {
        "Days": 400
      }
    }
  ]
}
EOF

# apply the policy to the bucket
aws s3api put-bucket-lifecycle-configuration \
  --bucket <your-audit-bucket> \
  --lifecycle-configuration file:///tmp/lifecycle.json \
  --endpoint-url https://<region>.<provider>.com
```

Set `Days` > object-lock window (365) so lifecycle never fights the
lock. 400 is a safe floor.

note: not all provider CLIs support lifecycle or object-lock operations
(e.g. `linode-cli` as of 2026-04 does not). `aws-cli` works against any
S3-compatible endpoint; alternatively, configure both in your provider's
web console under "Bucket Settings".

## step 5: verify audit shipping

once containers are running with env vars set, verify entries are shipped:

```bash
# on the container or ops machine with rclone configured
# wait 5-10s for audit entries to be written and shipped

# list entries in the audit bucket
rclone ls :s3:<your-audit-bucket>/tenants/default/

# expected output:
#   2026/04/22/audit-1713789045000-abc12345.json
#   2026/04/22/audit-1713789046000-def67890.json
#   ...

# to view an entry
rclone cat :s3:<your-audit-bucket>/tenants/default/2026/04/22/audit-1713789045000-abc12345.json
```

## step 6: monitor and troubleshoot

### if entries aren't appearing in remote storage

1. check that AUDIT_REMOTE_URL, AUDIT_REMOTE_ACCESS_KEY, AUDIT_REMOTE_SECRET_KEY are set:
   ```bash
   docker exec <container> env | grep AUDIT_REMOTE
   ```

2. check that local audit entries are being written:
   ```bash
   docker exec <container> tail -20 /app/namespaces/default/audit/audit.log
   ```

3. verify rclone can reach the endpoint (from inside the container):
   ```bash
   docker exec <container> rclone ls :s3:<your-audit-bucket>/
   ```
   if this fails, credentials or endpoint is wrong.

4. check container logs for audit shipping warnings (stderr from audit-ship.sh):
   ```bash
   docker logs <container> 2>&1 | grep "warn: audit ship"
   ```

### expected behavior when AUDIT_REMOTE_URL is unset

- local audit.log is written normally
- audit-ship.sh exits 0 immediately (no-op)
- no errors, no logs (feature is silent when disabled)
- this allows safe deployment before ops provisioning is complete

### rclone configuration reference

the shipper uses inline S3 config via environment variables:
- `RCLONE_S3_ACCESS_KEY_ID` — set by audit-ship.sh from AUDIT_REMOTE_ACCESS_KEY
- `RCLONE_S3_SECRET_ACCESS_KEY` — set by audit-ship.sh from AUDIT_REMOTE_SECRET_KEY
- `AUDIT_S3_ENDPOINT` — your provider's S3 endpoint (e.g.
  `https://us-east-1.linodeobjects.com`, `https://s3.amazonaws.com`,
  `https://<account_id>.r2.cloudflarestorage.com`). Optional for AWS S3.

the shipper uses `--s3-provider=Other` for generic S3-compatible backends.
for detailed rclone S3 options, see: https://rclone.org/s3/

## object storage key format

audit entries are keyed by tenant namespace, date, and unique ID:

```
{NAMESPACE_ID}/YYYY/MM/DD/audit-{epoch_ms}-{short_id}.json
```

example:
```
default/2026/04/22/audit-1713789045123-abc12345.json
team-x/2026/04/22/audit-1713789046456-def67890.json
```

keys are immutable (one-time write per entry, no overwrites).
this ensures audit log integrity: entries cannot be modified after shipping.

## backup and recovery

audit logs in object storage are the primary record for SOC2 compliance.

recommended backup strategy:
- enable versioning on the bucket (per your provider's UI)
- enable multi-region replication if your provider supports it
  (AWS S3 does; Linode and some others do not — check your provider)
- run monthly exports to cold storage (glacier-like):
  ```bash
  # export audit entries from the past month to compressed archive
  rclone copyto :s3:<your-audit-bucket>/ \
    /local/backup/audit-$(date +%Y-%m).tar.gz \
    --fast-list
  ```

## troubleshooting reference

| symptom | cause | fix |
|---------|-------|-----|
| entries in local audit.log but not in remote | env vars not set | verify AUDIT_REMOTE_* vars on container |
| rclone ls fails with auth error | credentials wrong | regenerate keys (step 2) |
| shipping warnings in logs | temporary network issue | shipper will retry (3 attempts, exp backoff) |
| object storage bucket not found | wrong bucket name or region | verify bucket exists in your provider's UI |
| S3 endpoint timeout | endpoint URL wrong or network issue | check AUDIT_S3_ENDPOINT format |

## disabling remote shipping

to temporarily disable remote shipping without redeploying:

```bash
# unset AUDIT_REMOTE_URL (or set to empty string)
docker exec <container> env -i <other-vars> node /opt/mentiko/lib/process-manager.js

# or from compose:
# remove AUDIT_REMOTE_URL from env and restart
```

local audit.log will continue to be written. the shipper will silently exit 0.

## ship-failures.log monitoring

When `audit-ship.sh` exhausts all retries, it writes a JSON record to
`{AUDIT_DIR}/ship-failures.log` (default:
`/app/namespaces/{NAMESPACE_ID}/audit/ship-failures.log`) so the drop is
durable and monitorable. Each line looks like:

```
{"failed_at":"2026-04-23T22:18:04Z","entry_id":"audit_01234567","remote_key":"default/2026/04/23/audit-1.json","remote_url":"s3://<your-audit-bucket>/tenants/default/","attempts":3}
```

### cron-based alerting

The operator script `scripts/monitor-audit-ship-failures.sh` reads that
log, finds entries within a recent window, and prints a human-readable
report to stdout. Cron delivers stdout to the `MAILTO` address, so the
script itself does not need mail credentials.

Install on each host running a tenant container:

```
# /etc/cron.d/mentiko-audit-monitor
MAILTO=<your-ops-email>
*/15 * * * * root /opt/mentiko/scripts/monitor-audit-ship-failures.sh
```

(Replace `/opt/mentiko/` with wherever you checked the repo out to on
the host.)

Config via env vars:

- `WINDOW_MINUTES` — how far back to look (default 60)
- `QUIET_THRESHOLD` — max failures per window before report is emitted
  (default 0 — alert on any failure). Raise to 5 if a low-grade
  transient rate is acceptable; 0 is the right starting value for a
  fresh tenant.
- `AUDIT_DIR` / `NAMESPACE_ROOT` / `NAMESPACE_ID` — override path
  resolution. Usually unnecessary inside the tenant container since
  the standard container env vars are already set.

Behavior:

- Empty or missing log → exit 0, stdout empty (cron stays silent).
- Failures below threshold → exit 0, stdout empty (cron stays silent).
- Failures above threshold → prints report, exit 0 (cron emails MAILTO).
- Internal error (missing jq, unparseable log) → exit 1 (cron emails
  on non-zero exit regardless of stdout).

### verifying the monitor locally

```bash
# synthesize a fake failure log and run the monitor
tmpdir=$(mktemp -d)
recent_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$tmpdir/ship-failures.log" <<EOF
{"failed_at":"$recent_ts","entry_id":"audit_test0001","remote_key":"default/2026/04/23/test.json","remote_url":"s3://<your-audit-bucket>/tenants/default/","attempts":3}
EOF
AUDIT_DIR="$tmpdir" ./scripts/monitor-audit-ship-failures.sh
# expected: a report is printed.

# raise threshold -> silent
AUDIT_DIR="$tmpdir" QUIET_THRESHOLD=5 ./scripts/monitor-audit-ship-failures.sh
# expected: no output.

rm "$tmpdir/ship-failures.log"; rmdir "$tmpdir"
```

### what the alert looks like (for on-call)

When the cron fires with failures in window, the email arrives at
`MAILTO` with subject `Cron <...>` and body:

```
Mentiko audit-ship failures detected

Tenant:          example-tenant
Host:            tenant-example.internal
Window:          last 60 minutes (since 2026-04-23T22:18:04Z)
Failures:        2
Threshold:       0 (alert above)
Log file:        /app/namespaces/example-tenant/audit/ship-failures.log

Recent failures:
  [2026-04-23T23:18:04Z] entry=audit_01234567 key=example-tenant/2026/04/23/audit-1.json url=... attempts=3
  [2026-04-23T23:18:04Z] entry=audit_89abcdef key=example-tenant/2026/04/23/audit-2.json url=... attempts=3

Next steps:
  1. Check tenant outbound network: rclone ls :s3:$BUCKET/
  2. Verify AUDIT_REMOTE_* credentials still valid.
  3. Check your provider's object-storage dashboard for bucket health + quota.
  4. If rclone works manually but ship fails, pull recent tenant logs.
  5. See docs/AUDIT_SETUP.md for the full runbook.
```

### when to escalate

- More than 5 failures in a single window — something structural
  (credential expired, bucket deleted, endpoint changed). Investigate
  immediately.
- Failures accumulating across many tenants at the same time —
  shared infrastructure problem (provider region outage, DNS,
  credential rotation not propagated). Check your provider's status
  page and recent deploys.
- ship-failures.log growing without bound (> 10 MB) — truncate after
  the underlying issue is fixed. Historical failures stay in container
  logs.
