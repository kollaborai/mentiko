# GDPR Compliance

Mentiko supports GDPR compliance through crypto-shred deletion
and data export capabilities.

## Supported rights

### Art 15 — Right of access

Users can request all data held about them via:

```
POST /api/gdpr/export
```

Requires authentication. Returns a JSON bundle containing:
- User profile (auth.db)
- Session history
- OAuth account links
- Organization memberships
- Tasks created
- Chains owned
- Decisions

### Art 17 — Right to erasure

Users can request account deletion via:

```
POST /api/gdpr/delete
Body: { "confirmation": "DELETE MY ACCOUNT" }
```

This triggers a crypto-shred:
1. All user data encrypted under their personal DEK
2. The DEK is destroyed (overwritten with random bytes)
3. All ciphertext becomes permanently unreadable
4. Auth session and user rows are cleared (tombstoned)
5. Filesystem sweep removes orphan files in background

Crypto-shred is immediate. Filesystem sweep completes within 24 hours.

### Art 20 — Right to data portability

The `/api/gdpr/export` endpoint provides a machine-readable JSON
export of all user data suitable for migration.

## Audit log retention exception

Audit log entries contain `user_id` only — never email or name.
These entries survive the crypto-shred legally as they contain
no personally identifiable information. This is documented in
the PII scrubber (phase 1) which prevents email/name from
entering audit logs going forward.

## Implementation

- Per-user DEK (Data Encryption Key) encrypted under tenant KEK
- KEK derived from BETTER_AUTH_SECRET via PBKDF2
- AES-256-GCM encryption for all user data
- Shredding: overwrite DEK with random bytes = instant erasure
- Pre-delete export retained in gdpr-exports/ for legal hold

## Files

- `web/lib/auth/user-crypto.ts` — DEK management + encrypt/decrypt
- `web/lib/system/gdpr-data-map.ts` — exhaustive data surface inventory
- `web/app/api/gdpr/export/route.ts` — export endpoint
- `web/app/api/gdpr/delete/route.ts` — delete endpoint
- `lib/gdpr-sweep.sh` — filesystem cleanup
- `scripts/scrub-audit-pii.mjs` — PII migration for audit logs
- `web/lib/system/audit-log.ts` — typed PII rejection and audit-index ownership
