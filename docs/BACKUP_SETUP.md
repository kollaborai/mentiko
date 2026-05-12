# Postgres Backup Setup

automated daily `pg_dump` → `gzip` → S3-compatible object storage.
retention: 7 daily, 4 weekly (sunday), 3 monthly (1st).

Any S3-compatible backend works (AWS S3, Cloudflare R2, Backblaze B2,
Linode Object Storage, MinIO). Examples below use generic variable names.

> **Note**: the default public `docker-compose.production.yml` in this
> repo runs the platform with sqlite, not postgres. This doc applies
> when you're running your own postgres (e.g. a multi-tenant
> management layer, or a larger self-hosted install). For sqlite backups,
> the simpler approach is just snapshotting the `/app/data/` volume —
> see the note at the top of `docker-compose.production.yml`.

## quick setup on the host

```bash
ssh <your-ssh-user>@<your-vps>

# 1. create backup dir (any path you like)
mkdir -p /opt/mentiko/backups

# 2. add to your .env (wherever the compose stack loads it from)
cat >> /opt/mentiko/.env <<'EOF'
BACKUP_DIR=/opt/mentiko/backups
BACKUP_BUCKET=<your-backup-bucket>
BACKUP_ENDPOINT=<region>.<provider>.com
BACKUP_OBJ_ACCESS_KEY=<your-access-key>
BACKUP_OBJ_SECRET_KEY=<your-secret-key>
BACKUP_NOTIFY_EMAIL=<your-ops-email>
EOF

# 3. install aws cli (for S3-compatible upload — works with any S3-compatible provider)
apt-get install -y awscli

# 4. test the backup (dry run)
cd /opt/mentiko && ./scripts/backup-db.sh --dry-run

# 5. run for real
./scripts/backup-db.sh

# 6. set up cron
crontab -e
```

crontab entries:
```
# daily backup at 3am
0 3 * * * /opt/mentiko/scripts/backup-db.sh >> /var/log/mentiko-backup.log 2>&1

# check backup freshness at 4am (alerts if missed)
0 4 * * * /opt/mentiko/scripts/backup-check.sh >> /var/log/mentiko-backup.log 2>&1
```

Note: the scripts historically read `LINODE_OBJ_ACCESS_KEY` /
`LINODE_OBJ_SECRET_KEY` env var names. If your provider isn't Linode,
the names still work — they're just S3 keys under any provider — but
feel free to alias to provider-agnostic names if it helps clarity in
your own stack.

## object storage bucket setup

1. go to your provider's console → object storage → create bucket
2. bucket name: anything, e.g. `<your-app>-backups`; region: close to your VPS
3. create access key scoped to that bucket (principle of least privilege)
4. set `BACKUP_OBJ_ACCESS_KEY` + `BACKUP_OBJ_SECRET_KEY` in `.env`

## postgres container name

Set `POSTGRES_CONTAINER` in `.env` to the name of your running postgres
container. The script defaults to a compose-generated pattern like
`<project>-postgres-1`; if your project name or service name differs,
override it.

check with: `docker ps --format '{{.Names}}' | grep postgres`

## restore procedure

```bash
# list available backups
./scripts/restore-db.sh --list

# restore from specific backup
./scripts/restore-db.sh /opt/mentiko/backups/daily-2026-03-07_030001.sql.gz
```

WARNING: restore overwrites all data. confirm you have a recent backup before
making destructive changes.

## testing the backup

after first run, verify:
```bash
# check backup exists and has reasonable size
ls -lh /opt/mentiko/backups/

# test restore to a temp db
docker exec -e PGPASSWORD=<pw> <postgres-container> \
  psql -U mentiko -c "CREATE DATABASE mentiko_restore_test;"

gunzip -c /opt/mentiko/backups/daily-*.sql.gz | \
  docker exec -i -e PGPASSWORD=<pw> <postgres-container> \
  psql -U mentiko mentiko_restore_test

# check row counts
docker exec -e PGPASSWORD=<pw> <postgres-container> \
  psql -U mentiko mentiko_restore_test -c "\dt"

# cleanup
docker exec -e PGPASSWORD=<pw> <postgres-container> \
  psql -U mentiko -c "DROP DATABASE mentiko_restore_test;"
```

## what's NOT covered (future)

- WAL archiving for point-in-time recovery (needs postgres.conf changes)
- encryption at rest (add: `| age -r <pubkey>` before gzip if needed)
- cross-region replication (provider-dependent — check your provider
  for "versioning + CRR" support)
