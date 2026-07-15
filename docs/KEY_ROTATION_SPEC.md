# Key Rotation Spec — Vault Secret Re-encryption

## 1. Problem Statement

All secrets in the mentiko vault are encrypted with AES-256-GCM using a key
derived from `BETTER_AUTH_SECRET` via PBKDF2. The key derivation is deterministic
and stateless: same secret → same key, always.

When `BETTER_AUTH_SECRET` changes (deploy rotation, security incident, operator
error), every `decrypt()` call throws because `decipher.setAuthTag()` fails GCM
authentication. The error is swallowed silently in `getSecretsEnvVars()` and
`getSecretByName()` — callers get empty strings, references resolve to their
literal `{secret:NAME}` placeholder, and agents start with missing credentials.

Production incident 2026-03-19: `BETTER_AUTH_SECRET` was rotated during a
re-deploy. All decision jobs that relied on secrets failed silently within
minutes of the deploy. No alert fired because the env injection path returns
`{}` on decryption failure — agents started but hit 401s from external APIs.

Root cause summary:
- no key versioning on ciphertext (no way to know which key encrypted it)
- no re-encryption path (no way to move data to a new key)
- decryption failures are silent (no operator visibility)
- `BETTER_AUTH_SECRET` is also the session signing key — rotate it for auth
  reasons and you break secrets with no warning

## 2. Key Versioning Scheme

### 2.1 Key ID Format

A key ID is a short lowercase hex string derived from the key material itself:
the first 8 bytes of SHA-256(`derived-key-bytes`), hex-encoded. 16 chars, e.g.
`a3f8c12d4e9b0177`. This is deterministic — no need to store it separately.

```
keyId = sha256(derivedKey).slice(0, 8).hex()  // 16 hex chars
```

Benefits:
- no external key registry needed for single-key deployments
- two operators with the same `BETTER_AUTH_SECRET` get the same keyId
- rotation detection: if stored keyId ≠ computed keyId from current secret,
  the secret needs re-encryption

### 2.2 Ciphertext Format — Current (v0, unversioned)

```
<ivHex>:<tagHex>:<encHex>
```

Three colon-separated hex segments. No version tag. Produced by all existing
encrypt() calls.

### 2.3 Ciphertext Format — v1 (versioned)

```
v1:<keyId>:<ivHex>:<tagHex>:<encHex>
```

Five colon-separated segments. Prefix `v1:` + 16-char key ID.

The `decrypt()` function detects format by counting colons:
- 2 colons → v0 (legacy, decrypt with current key, no keyId check)
- 4 colons, starts with `v1:` → v1 (check keyId, fail fast if wrong key)

All new writes (create + update + post-rotation) use v1 format.

### 2.4 SecretRecord Schema Change

Add optional `keyId` field to the on-disk JSON:

```json
{
  "id": "sec-1711234567-abc123",
  "name": "OPENAI_KEY",
  "envVar": "OPENAI_API_KEY",
  "maskedValue": "...k9Xz",
  "encryptedValue": "v1:a3f8c12d4e9b0177:ivHex:tagHex:encHex",
  "keyId": "a3f8c12d4e9b0177",
  "createdAt": "2026-03-01T00:00:00Z",
  "updatedAt": "2026-04-23T12:00:00Z"
}
```

`keyId` is stored redundantly with the ciphertext for fast "needs rotation?"
queries without parsing the full ciphertext.

### 2.5 Old Key Passing

Re-encryption requires decrypting with the old key then encrypting with the new
one. The old key is passed as `BETTER_AUTH_SECRET_OLD` (env var) or as a CLI
flag `--old-secret`. It is NEVER persisted. The rotation operation reads it
once per session, does all re-encryption in memory, discards it.

## 3. Re-encryption API Endpoint

### 3.1 Route

```
POST /api/secrets/rotate
```

Admin-only. Requires the `x-admin-key` header (same pattern as other admin
routes). In multi-tenant mode the caller must also pass namespaceId + orgId.

### 3.2 Request Shape

```json
{
  "namespaceId": "default",
  "orgId": "default",
  "oldSecret": "the-previous-BETTER_AUTH_SECRET-value",
  "dryRun": false
}
```

- `namespaceId` + `orgId`: scope of the rotation (required)
- `oldSecret`: the previous `BETTER_AUTH_SECRET` used to encrypt existing secrets
- `dryRun`: if true, detect which secrets need rotation and return counts without
  writing anything

### 3.3 Response Shape

Success (200):
```json
{
  "ok": true,
  "total": 12,
  "rotated": 11,
  "skipped": 0,
  "failed": 1,
  "failures": [
    {
      "id": "sec-1711234567-abc123",
      "name": "BAD_SECRET",
      "error": "decryption failed with old key — manual intervention required"
    }
  ],
  "dryRun": false
}
```

Dry run (200):
```json
{
  "ok": true,
  "total": 12,
  "needsRotation": 10,
  "alreadyCurrent": 2,
  "dryRun": true
}
```

Error (400/401/500):
```json
{
  "ok": false,
  "error": "old secret produced no valid decryptions — check BETTER_AUTH_SECRET_OLD"
}
```

### 3.4 Behavior

1. Authenticate request (admin key check).
2. Derive current key from `BETTER_AUTH_SECRET` (env).
3. Derive old key from `oldSecret` (request body).
4. If `oldSecret === BETTER_AUTH_SECRET` and not dry-run, return 400 — nothing
   to rotate.
5. List all `.json` files in `secrets/` for the given namespace+org.
6. For each secret file:
   a. Parse the record.
   b. Compute current keyId from current key.
   c. If `record.keyId === currentKeyId` (v1 format, already on new key): skip.
   d. Try to decrypt `encryptedValue` with old key.
   e. On success: re-encrypt with new key (v1 format), update `keyId`,
      set `updatedAt`, write atomically (write to `.tmp` then rename).
   f. On decryption failure: record in failures list, continue.
7. Return summary. If any failures and not dry-run, include failures array.
8. If ALL secrets failed decryption with old key, return 400 with hint.

### 3.5 Atomicity

Each secret file is written atomically: write to `<id>.json.tmp` then
`rename()` to `<id>.json`. This ensures no partial state on crash. Files that
haven't been written yet still have old-key ciphertext — safe because old key
still works until process is done.

### 3.6 Auth

Same `x-admin-key` check used by `/api/admin/*` routes. In production this
header must match `ADMIN_API_KEY` env var. No session cookie auth — this
endpoint is called non-interactively from CLI.

## 4. CLI Command

### 4.1 Command

```
bin/mentiko rotate-keys [options]
```

Or standalone:

```
bin/secrets-rotate [options]
```

### 4.2 Flags

```
--namespace-id <id>    namespace to rotate (default: "default")
--org-id <id>          org to rotate (default: "default")
--old-secret <value>   old BETTER_AUTH_SECRET (or set BETTER_AUTH_SECRET_OLD env)
--dry-run              detect and report, do not write
--all-namespaces       rotate every namespace found under MENTIKO_GLOBAL_ROOT
--yes                  skip confirmation prompt
--verbose              print each secret name + result
```

### 4.3 Flow

```
1. resolve BETTER_AUTH_SECRET from env (required — exits with error if missing)
2. resolve old secret: --old-secret flag || BETTER_AUTH_SECRET_OLD env
3. if no old secret and not --dry-run: prompt operator for it (hidden input)
4. if not --yes: print summary of what will be rotated, prompt to confirm
5. call POST /api/secrets/rotate (if web server running) OR
   call rotation logic directly (if running standalone against filesystem)
6. print per-secret results if --verbose
7. exit 0 if rotated >= 1 and failed === 0
   exit 1 if any failures
   exit 2 if no secrets found (nothing to do)
```

### 4.4 Standalone Mode (no web server)

`secrets-rotate` can run directly against the filesystem without the web
server. It duplicates the rotation logic from `secrets-store.ts` as pure node.
Useful for disaster recovery
when the web server won't start because all secrets are unreadable.

```
BETTER_AUTH_SECRET=new-key \
BETTER_AUTH_SECRET_OLD=old-key \
node bin/secrets-rotate --namespace-id default --org-id default --yes
```

### 4.5 Error Handling

- old secret wrong / decryption fails for all: exit 1, print count of failures
- partial failure: exit 1, list failed secret names, recommend manual steps
- file permission error: exit 1, include path in message
- interrupted mid-run (SIGINT): already-written files keep new key, rest keep
  old key — safe to resume with same command (skipped = already rotated)

## 5. Migration Path for Existing Unversioned Secrets

Existing secrets have v0 ciphertext (3-colon format, no keyId in record). The
migration is a one-time operation that converts all v0 secrets to v1 format
using the current key only (no old key needed if the key hasn't changed yet).

### 5.1 Migration Trigger

On startup, `web/lib/secrets-store.ts` will not auto-migrate. Migration is
explicit — operator runs it.

### 5.2 Same-key Migration (no rotation)

If `BETTER_AUTH_SECRET` has NOT changed since the secrets were written, run:

```
bin/secrets-rotate --same-key
```

This skips the old-secret requirement, decrypts with the current key, and
re-writes in v1 format. Effectively a format upgrade, not a key rotation.

This is the path for existing deployments where the key hasn't been rotated
yet but you want version tags on all secrets before the next rotation.

### 5.3 Post-incident Migration (key already changed)

If `BETTER_AUTH_SECRET` already changed and secrets are unreadable:

Option A — you have the old secret:
```
BETTER_AUTH_SECRET=new-key \
BETTER_AUTH_SECRET_OLD=old-key \
node bin/secrets-rotate --yes
```

Option B — old secret is lost: there is no cryptographic recovery path.
Operator must re-enter all secret values via the UI or API, which will
encrypt them with the current key in v1 format.

The UI should detect v0 secrets with a wrong keyId on read and surface a
warning in `/settings/secrets` that the secret cannot be decrypted and needs
to be re-entered.

## 6. Edge Cases

### 6.1 Partial Failure

If secret A rotates successfully and secret B fails (bad ciphertext, corrupt
file), the operation continues and reports both outcomes. A is now on the new
key. B is left on the old key (or unreadable). The response includes the
failure detail. Operator must manually fix B (re-enter the value via UI).

The system is designed for partial failure to be safe: each secret file is
independent, atomic writes prevent torn state, and the rotate command is
idempotent (re-running skips already-rotated secrets).

### 6.2 Concurrent Access

The rotation endpoint does not take a filesystem lock. If an agent is running
and reading secrets while rotation is in progress:
- reads before the file is renamed see old key ciphertext — decrypts fine
  if old key is still in BETTER_AUTH_SECRET (unlikely during rotation)
- reads after rename see new key ciphertext — decrypts fine with new key

The window where this matters: between when the old key is removed from env
and when rotation completes. Best practice: rotate `BETTER_AUTH_SECRET` in
env AFTER running `secrets-rotate`, not before. The CLI enforces this by
warning if both keys derive to the same material (would mean nothing to rotate)
or if the old key cannot decrypt any secrets (probably wrong old key).

Recommended rotation sequence:
```
1. have new BETTER_AUTH_SECRET ready but not deployed
2. run: BETTER_AUTH_SECRET=new-key BETTER_AUTH_SECRET_OLD=old-key \
        node bin/secrets-rotate --yes
3. confirm 0 failures in output
4. deploy with new BETTER_AUTH_SECRET in env
```

### 6.3 Decryption Failure Detection

Current behavior: `decrypt()` throws on GCM auth tag mismatch, caller catches
and returns null/empty. Silent failure.

New behavior post-spec:

- `decrypt()` gains a `{ allowVersionMismatch?: boolean }` option (default false)
- `getSecretsEnvVars()` and `getSecretByName()` log a structured warning when
  decryption fails: `[secrets] decryption failed: {secretId} — key mismatch?`
- `/api/secrets` list endpoint adds a `status` field per secret:
  - `"ok"` — decrypts successfully
  - `"unreadable"` — decryption fails with current key
  - `"unknown"` — file unreadable/corrupt
- `/settings/secrets` UI shows unreadable secrets with a warning badge and
  "Re-enter value" CTA

### 6.4 Multiple Simultaneous Rotations

No locking. If two rotate calls run concurrently against the same secret file,
the last writer wins. Because both decrypt with the old key first and both
encrypt with the new key, the result is identical — no data loss. This is
safe due to AES-GCM being deterministic per-call only with a new random IV
each time, and because the plaintext is preserved through both paths.

### 6.5 Corrupt or Unparseable Secret Files

Files that cannot be JSON-parsed are skipped with a warning in the response.
They are never written. Operator must delete or repair them manually.

### 6.6 Keychain Mismatch Between Web and CLI

`job-runner.mjs` duplicates the decryption logic in plain JS (it cannot import
the TypeScript store). It must be updated to handle v1 ciphertext format. If it
is not updated, it will fail on v1
ciphertext (split() returns 5 parts, old code expects 3).

The ciphertext parser must be updated in both locations atomically:
- `web/lib/secrets-store.ts`
- `lib/job-runner.mjs`

## 7. Files to Change

### 7.1 web/lib/secrets-store.ts

- `encrypt()`: produce v1 format, include keyId in ciphertext
- `decrypt()`: handle both v0 (3-part) and v1 (5-part) formats
- `getDerivedKey()`: add `getKeyId()` helper (sha256(key).slice(0,8).hex())
- `SecretRecord`: add optional `keyId?: string` field
- `createSecret()`: set `keyId` on new records
- `updateSecret()`: set `keyId` when value changes
- `getSecretsEnvVars()`: log structured warning on decryption failure instead
  of silent skip
- `getSecretByName()`: same
- new export: `rotateSecrets(namespaceId, orgId, oldSecret, opts)` — core
  rotation logic used by both API endpoint and CLI standalone mode
- new export: `getSecretsStatus(namespaceId, orgId)` — returns per-secret
  status (ok / unreadable / unknown) without decrypted values

### 7.2 lib/job-runner.mjs

- `getDerivedKey()`: no change
- `decrypt()`: apply the same v1 format update as the typed secrets store
- `getSecretByName()`: add warning log on failure (stderr, won't break bash)

### 7.4 web/app/api/secrets/rotate/route.ts (new file)

- `POST` handler: validate admin key, parse body, call `rotateSecrets()`
- return JSON summary with rotated/failed/skipped counts

### 7.5 web/app/api/secrets/route.ts (existing)

- `GET` handler: include `status` field per secret using `getSecretsStatus()`

### 7.6 bin/secrets-rotate (new file)

- standalone node script
- handles `--dry-run`, `--same-key`, `--all-namespaces`, `--yes`, `--verbose`
- duplicates `rotateSecrets()` logic from secrets-store OR calls the API if
  `MENTIKO_API_URL` env is set (hybrid mode)

### 7.7 bin/mentiko (existing CLI entry point)

- add `rotate-keys` subcommand that delegates to `bin/secrets-rotate`

### 7.8 web/components/secrets/secret-form.tsx (existing)

- no crypto changes; UI-only: consume `status` field from API
- show warning badge for `unreadable` secrets
- show "Re-enter value" button that opens the edit flow

### 7.9 web/app/api/secrets/[id]/route.ts (existing, if present)

- `GET` single secret: include `status` field

### 7.10 web/lib/dev-secret.ts

- no changes needed

## 8. Testing Plan

### 8.1 Unit Tests (jest, web/__tests__/secrets-store.test.ts)

```
describe("encrypt/decrypt")
  - v0 ciphertext round-trips with current key
  - v1 ciphertext round-trips with current key
  - v1 ciphertext fails with wrong key (throws)
  - v0 ciphertext detected and handled by updated decrypt()
  - v1 ciphertext rejected if keyId does not match current key

describe("rotateSecrets")
  - rotates v0 secret to v1 with new key
  - skips secret already on current key (keyId match)
  - handles corrupt file (skips, reports failure)
  - handles all-fail scenario (returns failures array)
  - dry-run returns counts without writing
  - atomic write: tmp file used, renamed on success

describe("getSecretsStatus")
  - returns "ok" for valid secrets
  - returns "unreadable" when decryption fails
  - returns "unknown" for corrupt JSON
```

### 8.2 Integration Tests

```
test: rotate secret across key change
  1. create secret with key A
  2. call rotateSecrets(oldSecret=A, env=B)
  3. read secret with key B — should decrypt successfully
  4. read secret with key A — should fail

test: partial failure
  1. create two secrets with key A
  2. corrupt one file manually
  3. rotate with key B
  4. verify good secret is on key B
  5. verify corrupt secret appears in failures list

test: idempotent resume
  1. create three secrets with key A
  2. rotate first two manually (simulate partial run)
  3. run full rotation with key B
  4. verify all three end up on key B, no errors
```

### 8.3 CLI Tests

```
test: bin/secrets-rotate --dry-run
  - creates secrets, runs dry-run, verifies no files changed

test: bin/secrets-rotate --yes
  - full rotation, verifies all secrets readable with new key

test: bin/secrets-rotate --same-key
  - no old key needed, v0 → v1 format upgrade only

test: bin/secrets-rotate --all-namespaces
  - creates secrets in two namespaces, rotates both, verifies
```

### 8.4 API Tests

```
test: POST /api/secrets/rotate
  - 401 without admin key
  - 400 if old secret == new secret
  - 200 with valid rotation, returns correct counts
  - 200 dry-run returns needsRotation count

test: GET /api/secrets
  - status field present for each secret
  - unreadable secret shows status:"unreadable"
```

### 8.5 Regression Tests

```
test: job-runner.mjs decrypts v1 ciphertext
  - create v1 secret, run job that uses it, verify env var set correctly

test: existing v0 secrets still work after code deploy
  - deploy new code without rotating — v0 secrets must still decrypt
```

### 8.6 Manual Smoke Test Sequence (pre-deploy)

```
1. create a secret via UI
2. note the encrypted value format (should be v1 after code deploy)
3. start an agent that requires that secret
4. verify agent starts and secret is injected correctly
5. rotate the key (--same-key if no actual rotation, full if rotating)
6. verify agent still works after rotation
7. change BETTER_AUTH_SECRET, restart server
8. run secrets-rotate with old key
9. verify secrets are readable again
```
