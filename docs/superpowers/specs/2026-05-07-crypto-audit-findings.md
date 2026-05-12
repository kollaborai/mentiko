crypto audit findings -- 2026-05-07

triggered by: secrets page crash on save ("KEY_DERIVATION_SALT is not defined")
root cause: commit 9f6bda20 (apr 23) renamed usage but not declaration
scope: full audit of all crypto modules, commit history, and related CLI tools


severity key:
  ▲ crit    data loss or live production bug
  ▲ high    broken functionality, will fail when used
  ⚠ medium  security weakness or incorrect behavior
  ℹ low     cosmetic, dead code, minor inconsistency

addendum (2026-05-08):
  - kept all findings for traceability.
  - verified/confirmed: the old KEY_DERIVATION_SALT undefined crash in
    `bin/secrets-rotate` is already fixed in current code; it now uses
    `DERIVATION_SALT` at line 59 (via `getDerivedKey` line 66).
  - this comment is tracking-only and does not remove historical context.


═══════════════════════════════════════════════════════════════════
▲ CRITICAL-1: salt mismatch between web and CLI/mjs tools
═══════════════════════════════════════════════════════════════════

three implementations of the same encryption use different salts:

  web/lib/secrets-store.ts:26
    const KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1"

  bin/secrets-resolve.mjs:37
    salt = "mentiko-secrets-store-v1"

  lib/job-runner.mjs:38
    salt = "mentiko-secrets-store-v1"

  bin/secrets-rotate:59
    const DERIVATION_SALT = "mentiko-vault-crypto-v1"  (declared, never used)
    line 66: KEY_DERIVATION_SALT  (REFERENCED BUT NEVER DECLARED -- crashes at runtime)

secrets created by the web app (salt: mentiko-vault-crypto-v1) CANNOT
be decrypted by secrets-resolve.mjs or job-runner.mjs (salt: mentiko-secrets-store-v1).

impact:
  - bin/secrets-rotate CRASHES on every invocation (ReferenceError: KEY_DERIVATION_SALT is not defined)
  - chain-runner invoking secrets-resolve.mjs gets wrong values or failures
  - job-runner.mjs fails to inject secrets into agent env
  - this predates 9f6bda20 (mjs files were never updated when salt changed)

code references:

  web/lib/secrets-store.ts:26
    const KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";

  bin/secrets-resolve.mjs:37
    const salt = "mentiko-secrets-store-v1";

  lib/job-runner.mjs:38
    const salt = "mentiko-secrets-store-v1";

  bin/secrets-rotate:59
    const DERIVATION_SALT = "mentiko-vault-crypto-v1";  // declared, never referenced
  bin/secrets-rotate:66
    KEY_DERIVATION_SALT,  // referenced, never declared -- CRASH


═══════════════════════════════════════════════════════════════════
▲ CRITICAL-2: HKDF divergence -- web and CLI derive different AES keys
═══════════════════════════════════════════════════════════════════

after commit 70ce3bf9 (apr 24), secrets-store.ts switched to HKDF-derived
purpose keys. the CLI/mjs tools still use raw BETTER_AUTH_SECRET.

  web/lib/secrets-store.ts:32
    const appSecret = secret ?? resolveAppSecret("vault", "current");
    // -> HKDF-SHA256(BETTER_AUTH_SECRET, "mentiko-vault-encryption-v1")

  bin/secrets-resolve.mjs:32
    const secret = process.env.BETTER_AUTH_SECRET;  // raw, no HKDF

  lib/job-runner.mjs:32
    const secret = process.env.BETTER_AUTH_SECRET;  // raw, no HKDF

  bin/secrets-rotate:214
    // uses process.env.BETTER_AUTH_SECRET directly

even if the salt were the same, the PBKDF2 input is different, so the
derived AES key is different. secrets encrypted by the web app cannot
be decrypted by any CLI/mjs tool, and vice versa.

fix required: all mjs/bash tools must call resolveAppSecret("vault", "current")
or port the HKDF derivation to node/bash so they derive the same key.

exception: if VAULT_ENCRYPTION_KEY env var is set, resolveAppSecret returns
that directly, which bypasses HKDF. if all environments set VAULT_ENCRYPTION_KEY
to the same value as BETTER_AUTH_SECRET, the divergence disappears. but this
is not documented or enforced.


═══════════════════════════════════════════════════════════════════
▲ HIGH-1: secrets-store test suite is broken
═══════════════════════════════════════════════════════════════════

web/lib/__tests__/secrets-store.test.ts has 3 categories of failures:

  line 71: expects v0 format regex
    /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/
    but encrypt() now produces v1 format:
    v1:KEYID:iv:tag:enc
    test will fail.

  lines 115-116: expects decrypt("invalid") to throw
    current decrypt() catches all errors and returns null.
    test will fail.

  line 127: expects decrypt with wrong key to throw
    same issue -- decrypt returns null now.
    test will fail.

  line 130: test changes process.env.BETTER_AUTH_SECRET
    code now uses resolveAppSecret("vault", "current") which does
    HKDF derivation, not the raw env var. changing BETTER_AUTH_SECRET
    does change the derived key so this conceptually works, but the
    throw-vs-null issue still applies.

  also: test does not mock ../dev-secret, so resolveAppSecret
  runs for real. line 52-54 sets BETTER_AUTH_SECRET which feeds
  into HKDF derivation. no file side effects (the env var path
  doesn't trigger the dev-secret fallback write), but the test
  is coupled to resolveAppSecret internals.


═══════════════════════════════════════════════════════════════════
▲ HIGH-2: v0 secrets permanently undecryptable after commit 70ce3bf9
═══════════════════════════════════════════════════════════════════

before 70ce3bf9:
  getDerivedKey() called resolveAppSecret("secrets-store") -> raw BETTER_AUTH_SECRET

after 70ce3bf9:
  getDerivedKey() calls resolveAppSecret("vault", "current") -> HKDF-derived key

v0 format secrets (no version prefix: "iv:tag:enc") encrypted before this
commit used PBKDF2(raw_secret, salt). the current decrypt path at
web/lib/secrets-store.ts:80-88 calls getDerivedKey() which now uses
PBKDF2(hkdf_derived_key, salt). the derived AES key is different.

no migration path exists. if any v0 secrets exist on disk, they are
permanently unreadable.

code reference:

  web/lib/secrets-store.ts:79-88
    // v0 format: ivHex:tagHex:encHex (legacy, no version tag)
    const parts = ciphertext.split(":");
    if (parts.length !== 3) throw new Error("invalid v0 ciphertext format");
    const [ivHex, tagHex, encHex] = parts;

    const key = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    // ^^^ key is now HKDF-derived, but v0 was encrypted with raw secret

to fix: v0 decrypt path needs a fallback that tries the raw secret,
or a one-time migration script that re-encrypts v0 with the new key.


═══════════════════════════════════════════════════════════════════
⚠ MEDIUM-1: timing-unsafe comparisons in inbound email auth
═══════════════════════════════════════════════════════════════════

three locations use plain === for HMAC/signature comparison:

  web/app/api/email/inbound/route.ts:83
    return hmacExpected === hmacActual;   // verifyBearerToken()

  web/app/api/email/inbound/route.ts:91
    return signature === expected;        // verifyResendSignature()

  web/app/api/email/inbound/route.ts:195
    authPassed = hmacSig === hmacSecret;  // postmark auth

node.js string === short-circuits on first differing byte. attacker could
theoretically use timing to recover HMAC output byte-by-byte.

mitigation: all three use HMAC-then-compare pattern. V8's === is
constant-time for same-length strings, and HMAC outputs are always
64 hex chars. so practical exploitability is low. not truly
constant-time though -- should still migrate to timingSafeEqual.

the codebase already has timingSafeEqual in web/lib/security.ts and uses
it correctly in other places:

  web/app/api/webhooks/[id]/receive/route.ts:63-78  verifyGithubSignature()
    // uses manual constant-time byte comparison loop -- correct

fix: replace === with crypto.timingSafeEqual (or the wrapper in security.ts)
for all three locations.


═══════════════════════════════════════════════════════════════════
⚠ MEDIUM-2: user-crypto.ts KEK derived from raw root secret
═══════════════════════════════════════════════════════════════════

  web/lib/user-crypto.ts:25-26
    function getKEK(): Buffer {
      const secret = resolveAppSecret("user-crypto");
      return pbkdf2Sync(secret, KEY_DERIVATION_SALT, ...);

  resolveAppSecret("user-crypto") passes a plain string, hitting the
  legacy overload that returns raw BETTER_AUTH_SECRET (no HKDF).

  compare with secrets-store.ts and vault-crypto.ts which use:
    resolveAppSecret("vault", "current")  -> HKDF-derived purpose key

  impact:
    - no key separation between user-crypto and the root auth secret
    - if BETTER_AUTH_SECRET rotates, all wrapped DEKs become unreadable
      instantly (no dual-key window, no "previous" slot)
    - inconsistent with the vault subsystem's approach


═══════════════════════════════════════════════════════════════════
⚠ MEDIUM-3: deleteSecret return type doesn't match actual return
═══════════════════════════════════════════════════════════════════

  web/lib/secrets-store.ts:212
    export function deleteSecret(
      ...
    ): { ok: true; usages: SecretUsage[] } | { ok: false; error: string } {

  but line 221-225 actually returns:
    return {
      ok: false,
      error: `Secret is used in ${usages.length} profile...`,
      usages,     // <-- not in declared type
    } as { ok: false; error: string; usages: SecretUsage[] };

  forced via `as` type assertion. caller at web/app/api/secrets/route.ts:81
  has to cast it back. the declared type should include usages on the
  failure path.


═══════════════════════════════════════════════════════════════════
⚠ MEDIUM-4: getSecretsStatus does full decrypt instead of keyId compare
═══════════════════════════════════════════════════════════════════

  web/lib/secrets-store.ts:493-494 (docstring)
    "Get status (ok/unreadable/unknown) for each secret without decrypting."

  but line 506:
    const val = decrypt(rec.encryptedValue);

  this does a full AES-256-GCM decrypt of every secret on every
  GET /api/secrets call. for large stores this is unnecessarily expensive.

  could just compare rec.keyId with getKeyId() (which rotateSecrets
  already does at line 411). only v0 secrets (no keyId) need decrypt.


═══════════════════════════════════════════════════════════════════
⚠ MEDIUM-5: secrets-resolve.mjs skips keyId validation
═══════════════════════════════════════════════════════════════════

  bin/secrets-resolve.mjs:50,53-54
    const [, keyIdStored, ivHex, tagHex, encHex] = parts;
    // keyId check: if keyIdStored !== computed keyId, key is wrong
    // we'll detect this when setAuthTag fails on GCM auth check

  keyIdStored is destructured but never compared against anything.
  every wrong-key attempt does a full GCM decrypt that fails at setAuthTag
  instead of fast-failing on keyId mismatch.

  compare with secrets-store.ts:69-72 which does compare:
    if (keyIdStored !== keyId) {
      return null;   // fast fail
    }


═══════════════════════════════════════════════════════════════════
⚠ MEDIUM-6: secrets-rotate dry-run overcounts v0 secrets
═══════════════════════════════════════════════════════════════════

  web/lib/secrets-store.ts:411
    if (rec.keyId === currentKeyId) { skip }

  v0 secrets have no keyId field (undefined).
  undefined === currentKeyId is always false.
  so v0 secrets encrypted with the CURRENT key are counted as
  "needsRotation" instead of "alreadyCurrent".

  the rotation itself works (decrypts with oldSecret and succeeds),
  but dry-run reports are misleading.


═══════════════════════════════════════════════════════════════════
⚠ MEDIUM-7: timing-unsafe comparison in secrets rotate route
═══════════════════════════════════════════════════════════════════

  web/app/api/secrets/rotate/route.ts:51
    if (!dryRun && oldSecret === currentSecret)

  compares two secrets with === instead of timingSafeEqual.
  same file imports and uses timingSafeEqual on line 20 for admin key check.


═══════════════════════════════════════════════════════════════════
ℹ LOW-1: vault-crypto.ts is dead code
═══════════════════════════════════════════════════════════════════

  web/lib/vault-crypto.ts -- all exports unimported outside tests:
    vaultEncrypt, vaultDecrypt, getCurrentVaultKey, getPreviousVaultKey,
    setKeyVersion, getKeyVersion

  setKeyVersion is exported but never called from production code,
  so _currentKeyVersion is always 1.

  this was likely intended to replace secrets-store.ts encrypt/decrypt
  with v2 format but was never wired up.


═══════════════════════════════════════════════════════════════════
ℹ LOW-2: email-bounce.ts unsalted hash
═══════════════════════════════════════════════════════════════════

  web/lib/email-bounce.ts:83-87
    function bounceHash(recipient: string): string {
      return createHash("sha256")
        .update(recipient.toLowerCase().trim())
        .digest("hex");
    }

  unsalted SHA-256 of email addresses. vulnerable to rainbow tables.
  email-suppression.ts correctly uses HMAC with BETTER_AUTH_SECRET.


═══════════════════════════════════════════════════════════════════
ℹ LOW-3: email-suppression.ts uses Math.random()
═══════════════════════════════════════════════════════════════════

  web/lib/email-suppression.ts:301-303
    function cryptoId(): string {
      return `sup_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

  Math.random() is not cryptographically secure. function name "cryptoId"
  is misleading. every other file uses crypto.randomUUID().


═══════════════════════════════════════════════════════════════════
ℹ LOW-4: vault-crypto.ts still uses old constant name
═══════════════════════════════════════════════════════════════════

  web/lib/vault-crypto.ts:26
    const DERIVATION_SALT = "mentiko-vault-crypto-v1";

  secrets-store.ts and user-crypto.ts now use KEY_DERIVATION_SALT.
  vault-crypto.ts was missed in the rename. not a runtime bug (internally
  consistent) but inconsistent across the codebase.


═══════════════════════════════════════════════════════════════════
ℹ LOW-5: user-crypto.ts async functions don't need to be async
═══════════════════════════════════════════════════════════════════

  web/lib/user-crypto.ts:61-74, 80-92, 98-113, 119-142, 149-162
    generateDEKForUser, unwrapDEKForUser, encryptForUser,
    decryptForUser, shredDEK

  all async but contain zero await calls. db calls are synchronous
  (better-sqlite3). forces callers to await unnecessarily.


═══════════════════════════════════════════════════════════════════
ℹ LOW-6: shadowed SECRET_REF_PATTERN
═══════════════════════════════════════════════════════════════════

  web/lib/secrets-store.ts:20  (module-level)
    const SECRET_REF_PATTERN = /^\{secret:([^}]+)\}$/;

  web/lib/secrets-store.ts:334  (inside resolveProfileEnvVars)
    const SECRET_REF_PATTERN = /^\{secret:([^}]+)\}$/;

  same regex, unnecessary redeclaration.


═══════════════════════════════════════════════════════════════════
ℹ LOW-7: dead code in secrets-resolve.mjs
═══════════════════════════════════════════════════════════════════

  bin/secrets-resolve.mjs:40-42
    function getKeyId(key) {
      // not used in resolve, but kept for symmetry with decrypt signature
      return "unused";
    }

  declared but never called. returns hardcoded "unused".

  bin/secrets-resolve.mjs:36
    // comment says: "must match web/lib/secrets-store.ts: PBKDF2..."
    // reality: salt is "mentiko-secrets-store-v1", doesn't match

  lib/job-runner.mjs:37
    // same "must match" comment, same lie

  bin/secrets-rotate:59
    const DERIVATION_SALT = "mentiko-vault-crypto-v1";

  declared but never referenced (getDerivedKey uses KEY_DERIVATION_SALT
  on line 66, which is itself undefined -- see CRITICAL-1).


═══════════════════════════════════════════════════════════════════
ℹ LOW-8: user-crypto keyId leaks DEK fingerprint
═══════════════════════════════════════════════════════════════════

  web/lib/user-crypto.ts:110
    const keyId = createHash("sha256").update(dek).digest("hex").slice(0, 16);

  hashes the plaintext DEK to create a keyId embedded in the ciphertext
  string (v1:keyId:iv:tag:enc). anyone seeing ciphertext can identify
  which DEK was used. vault-crypto.ts does the same with the derived key,
  which is slightly better.


═══════════════════════════════════════════════════════════════════
PRODUCTION IMPACT (right now)
═══════════════════════════════════════════════════════════════════

the salt mismatch + HKDF divergence mean the web app and CLI tools
produce completely different AES keys from the same BETTER_AUTH_SECRET.

what's happening in production:

  - secrets encrypted by the web UI (settings/secrets page) are NOT
    decryptable by chain-runner or job-runner
  - any agent profile with {secret:NAME} refs gets the raw string
    instead of the decrypted value
  - agents receive "{secret:API_KEY}" as a literal string in their env
    instead of "sk-actual-key-value"
  - secrets-rotate CLI crashes on every invocation (ReferenceError)
  - even if secrets-rotate didn't crash, it would compute keyId from
    raw BETTER_AUTH_SECRET and report all secrets as "needsRotation"
    regardless of actual state
  - v0 secrets from before commit 70ce3bf9 are permanently unreadable
  - getSecretsStatus() on every GET /api/secrets does N full AES
    operations to check status instead of comparing stored keyId

this is a silent failure -- no error, no crash (except secrets-rotate),
just null returns and unresolved {secret:NAME} strings in agent envs.
agents that depend on injected credentials will fail in undefined ways
depending on how the consuming tool handles missing env vars.


═══════════════════════════════════════════════════════════════════
COMMIT TIMELINE
═══════════════════════════════════════════════════════════════════

  9f6bda20  apr 23  "security: vault key rotation"
    - introduced DERIVATION_SALT/KEY_DERIVATION_SALT mismatch
    - added v1 ciphertext format to secrets-store.ts
    - updated secrets-resolve.mjs and job-runner.mjs for v1 format
      but left salt mismatch unfixed
    - added secrets-rotate CLI tool

  70ce3bf9  apr 24  "security: wire vault key to HKDF-derived purpose key"
    - changed getDerivedKey() from resolveAppSecret("secrets-store")
      to resolveAppSecret("vault", "current")
    - did NOT update secrets-resolve.mjs, job-runner.mjs, or secrets-rotate
    - bricked all v0 format secrets (no migration)

  85b8026a  may 7   "fix: rename DERIVATION_SALT to KEY_DERIVATION_SALT"
    - fixed the crash in secrets-store.ts and user-crypto.ts
    - missed vault-crypto.ts (dead code, no runtime impact)
    - did NOT address any other findings from this audit


═══════════════════════════════════════════════════════════════════
RECOMMENDED FIX ORDER
═══════════════════════════════════════════════════════════════════

phase 1 -- stop the bleeding (critical path):
  ☑ CRITICAL-1: align salt in secrets-resolve.mjs and job-runner.mjs
    to "mentiko-vault-crypto-v1". fix secrets-rotate crash (rename
    DERIVATION_SALT to KEY_DERIVATION_SALT or add the missing declaration)
  ☑ CRITICAL-2: port HKDF derivation to mjs tools so they derive
    the same key as secrets-store.ts. options:
    a) port resolveAppSecret to .mjs and call it
    b) extract HKDF to a shared bin script that outputs the derived key
    c) require VAULT_ENCRYPTION_KEY env var everywhere (document it)
  ☑ HIGH-2: add v0 decrypt fallback that tries raw secret
    before HKDF-derived key, or write a one-time migration script

phase 2 -- fix broken tests:
  ☑ HIGH-1: update secrets-store.test.ts for v1 format and
    null-return behavior. mock dev-secret.

phase 3 -- security hardening:
  ☑ MEDIUM-1: replace === with timingSafeEqual in inbound email auth (3 locations)
  ☑ MEDIUM-2: switch user-crypto.ts to resolveAppSecret("user-crypto", "current")
    with HKDF derivation
  ☑ MEDIUM-7: replace === with timingSafeEqual in rotate route

phase 4 -- cleanup:
  ☑ MEDIUM-3: fix deleteSecret return type
  ☑ MEDIUM-4: optimize getSecretsStatus to use keyId comparison
  ☑ MEDIUM-5: add keyId validation to secrets-resolve.mjs
  ☑ MEDIUM-6: fix dry-run overcount for v0 secrets
    ☑ LOW-1: decide on vault-crypto.ts -- wire it up or delete it
  ☑ LOW-2: salt email-bounce hash with HMAC
  ☑ LOW-3: replace Math.random() with crypto.randomUUID()
  ☑ LOW-4: rename vault-crypto.ts DERIVATION_SALT for consistency
  ☑ LOW-5: remove unnecessary async from user-crypto.ts functions
  ☑ LOW-6: remove shadowed SECRET_REF_PATTERN
  ☑ LOW-7: remove dead getKeyId from secrets-resolve.mjs, dead DERIVATION_SALT from secrets-rotate,
    fix "must match" comments in secrets-resolve.mjs and job-runner.mjs
  ☑ LOW-8: document keyId fingerprint tradeoff

IMPLEMENTATION NOTE (2026-05-11)
  - re-validated phase list after your latest check:
    CRITICAL-1, CRITICAL-2, HIGH-1, HIGH-2, MEDIUM-1, MEDIUM-2,
    MEDIUM-3, MEDIUM-4, MEDIUM-5, MEDIUM-6, MEDIUM-7, LOW-1 through
    LOW-8 are all reflected as done in this spec.

IMPLEMENTATION NOTE (2026-05-08)
  - CRITICAL-1 / CRITICAL-2: web/lib/secrets-store.ts, lib/job-runner.mjs,
    bin/secrets-resolve.mjs, bin/secrets-rotate

IMPLEMENTATION NOTE (2026-05-09)
  - completed fixes landed for CRITICAL-1 / CRITICAL-2 / HIGH-1 / HIGH-2,
    MEDIUM-1 / MEDIUM-2 / MEDIUM-3 / MEDIUM-4 / MEDIUM-5 / MEDIUM-6 /
    MEDIUM-7, and LOW-2 / LOW-3 / LOW-4 / LOW-5 / LOW-6 / LOW-7 / LOW-8
    in these files:
    - bin/secrets-resolve.mjs
    - lib/job-runner.mjs
    - bin/secrets-rotate
    - web/app/api/secrets/route.ts
    - web/app/api/secrets/rotate/route.ts
    - web/lib/secrets-store.ts
    - web/lib/dev-secret.ts
    - web/lib/user-crypto.ts
    - web/app/api/email/inbound/route.ts
    - web/lib/email-bounce.ts
    - web/lib/email-suppression.ts
  - HIGH-1 / HIGH-2: web/lib/__tests__/secrets-store.test.ts and v0 fallback in decrypt paths
  - MEDIUM-1 / MEDIUM-2: web/app/api/email/inbound/route.ts, web/lib/user-crypto.ts
  - LOW-2 / LOW-3: web/lib/email-bounce.ts, web/lib/email-suppression.ts
  - LOW-4 / LOW-5 / LOW-7 / LOW-8: web/lib/user-crypto.ts,
    web/app/api/secrets/route.ts, bin/secrets-rotate

IMPLEMENTATION NOTE (2026-05-10)
  - LOW-1 (vault-crypto dead code) is resolved by removing the unused module and
    its dedicated test, since it was a duplicate experimental implementation not
    wired into production secret flows. removed:
    - web/lib/vault-crypto.ts
    - web/lib/__tests__/vault-crypto.test.ts
