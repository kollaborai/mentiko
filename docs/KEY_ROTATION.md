# Key Rotation

Mentiko derives two independent keys from BETTER_AUTH_SECRET via HKDF:

  SESSION_SIGNING_KEY -- signs better-auth session cookies
  VAULT_ENCRYPTION_KEY -- encrypts the secrets vault (AES-256-GCM)

If SESSION_SIGNING_KEY or VAULT_ENCRYPTION_KEY are set directly as env
vars, those take precedence over HKDF derivation. This is how an
external provisioner can supply per-tenant keys.

## Dual-Key Window

Both keys support a 7-day dual-key window during rotation:

  current  -- the active key, used for all new signatures/encryption
  previous -- the last key, accepted for reads/verification only

Previous keys are read from:
  SESSION_SIGNING_KEY_OLD
  VAULT_ENCRYPTION_KEY_OLD

Readers try current first, then previous. If previous succeeds the
caller gets `staleKey: true` and should re-encrypt on next write
(lazy migration).

## Rotating SESSION_SIGNING_KEY

1. Set SESSION_SIGNING_KEY to the new value
2. Set SESSION_SIGNING_KEY_OLD to the old value
3. Restart the platform
4. Sessions signed with the old key remain valid for 7 days
   (session max age). After that they expire naturally.
5. After 7 days, remove SESSION_SIGNING_KEY_OLD

No re-encryption needed -- session tokens are stateless.

## Rotating VAULT_ENCRYPTION_KEY

1. Set VAULT_ENCRYPTION_KEY to the new value
2. Set VAULT_ENCRYPTION_KEY_OLD to the old value
3. Restart the platform
4. Vault entries are re-encrypted lazily: each decrypt with staleKey=true
   triggers a re-encrypt on next write with the current key
5. To force immediate re-encryption, call the rotation endpoint:
   POST /api/secrets/rotate
6. After all entries are re-encrypted, remove VAULT_ENCRYPTION_KEY_OLD

### Checking Rotation Progress

  GET /api/secrets/status

Returns per-secret status: ok (current key), unreadable (wrong key),
unknown. When all secrets show "ok", rotation is complete.

## Rollback

If rotation causes problems:

1. Swap current and _OLD values:
   VAULT_ENCRYPTION_KEY = <old value>
   VAULT_ENCRYPTION_KEY_OLD = <new value that failed>
2. Restart the platform
3. Secrets encrypted with the new key are still readable via _OLD
4. Fix the issue, then re-attempt rotation

## Backward Compatibility

If only BETTER_AUTH_SECRET is set (no SESSION_SIGNING_KEY /
VAULT_ENCRYPTION_KEY env vars), both keys are derived via HKDF with
fixed labels. This maintains compatibility for one release cycle.

Legacy callers of resolveAppSecret("some-context") still get the raw
BETTER_AUTH_SECRET value -- unchanged behavior.

## Ciphertext Format

Vault entries use versioned ciphertext:

  v2:VERSION:iv:tag:ciphertext  -- current, VERSION is 2-char hex (01, 02, ...)
  v1:keyId:iv:tag:ciphertext    -- legacy from secrets-store.ts
  iv:tag:ciphertext             -- oldest format, no version prefix

Decryption handles all formats and tries current then previous key.

## External Provisioner Integration

In managed multi-tenant deployments, the keystore can live outside the
platform. Tenants fetch keys at boot via bearer auth. The tenant-side code is
in this repo; provisioner wiring lives outside the platform.
