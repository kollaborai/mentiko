# Encryption at Rest — auth.db

## Threat Model

auth.db stores user credentials (hashed passwords), session tokens,
OAuth state, and organization memberships. Without encryption at rest,
a filesystem-level compromise (disk theft, backup leak, misconfigured
NFS export) exposes all of this directly.

SQLCipher provides transparent, full-database AES-256 encryption.
The database file on disk is ciphertext — without the key, it's
indistinguishable from random data.

## What's Encrypted

| Database | Encrypted | Why |
|----------|-----------|-----|
| auth.db | Yes (when AUTH_DB_ENCRYPT=1) | Credentials, sessions, org membership |
| tasks.db | No | Task metadata, no secrets — filesystem isolation sufficient |
| chains/agents | No | JSON files, no secrets — filesystem isolation sufficient |
| email-*.db | No | Bounce/suppression lists — no secrets |

Auth.db is the highest-value target. Other data stores don't contain
secrets and are protected by filesystem permissions and tenant isolation.

## Key Source

Encryption key comes from `resolveAppSecret("vault")` — the same
BETTER_AUTH_SECRET / SECRET_KEY env var used throughout the platform.

This means:
- Key rotation is handled by FUTURE-2 (vault key rotation)
- No additional secret to manage
- Key is never logged, never written to disk by application code

## How It Works

1. Package: `better-sqlite3-multiple-ciphers` (drop-in for better-sqlite3,
   same synchronous API, adds SQLCipher support)
2. When AUTH_DB_ENCRYPT=1 is set, auth-server.ts opens the DB with
   `PRAGMA cipher='sqlcipher'` and `PRAGMA key = '<derived-key>'`
3. SQLCipher handles AES-256-CBC encryption/decryption transparently
4. Key derivation: SQLCipher uses PBKDF2 (256,000 iterations by default)
   internally to derive the actual encryption key from the passphrase

## Migration (Plain → Encrypted)

Run during tenant deployment:

```bash
AUTH_DB_ENCRYPT=1 BETTER_AUTH_SECRET=<key> \
  ./scripts/migrate-auth-db-to-sqlcipher.sh
```

The migration script:
- Detects if auth.db is already encrypted (idempotent)
- Dumps schema + data from plain DB
- Creates new encrypted DB, inserts all data
- Swaps files atomically
- Keeps a `.plain-backup` for safety

## Rotation

Key rotation is handled by FUTURE-2 (vault key rotation). The rotation
process will use `PRAGMA rekey` to re-encrypt auth.db with the new key.

## Backup / Restore

No changes needed. rclone ships the raw cipher bytes — backup files are
already encrypted. Restoring works the same way: copy file, open with key.

To restore without encryption knowledge: the backup is useless by design.

## Performance

SQLCipher adds ~5-10% overhead on login/auth operations (PBKDF2 key
derivation). This is invisible for normal usage patterns:
- Login: single DB open + key derivation per process lifetime
- Session validation: no additional cost after DB is open
- Page-level encryption: no measurable impact on queries

## Configuration

Environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| AUTH_DB_ENCRYPT | No | Set to "1" to enable encryption |
| BETTER_AUTH_SECRET | Yes (prod) | Encryption key source |

In development (no BETTER_AUTH_SECRET): encryption is not recommended.
The dev fallback key is not secret and defeats the purpose.
