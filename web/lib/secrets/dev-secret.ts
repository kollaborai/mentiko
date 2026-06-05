/**
 * resolve-app-secret: central secret resolution with HKDF key split.
 *
 * BETTER_AUTH_SECRET is the single root secret. From it we derive two
 * purpose-specific keys via HKDF:
 *   session  — signs better-auth session cookies
 *   vault    — encrypts the secrets vault (AES-256-GCM)
 *   user-crypto — wraps per-user DEKs for GDPR shred flow
 *
 * If SESSION_SIGNING_KEY or VAULT_ENCRYPTION_KEY are set directly
 * (externally provisioned), those take precedence over derivation.
 *
 * Legacy callers pass a single context string — that still returns the
 * raw BETTER_AUTH_SECRET for backward compat.
 *
 * Dual-key window: "previous" slot returns the last key (env var _OLD
 * suffix), so readers can accept both current and previous for 7 days.
 */

import { createHmac, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";

let _devSecretWarned = false;
let _devSecret: string | null = null;

type Purpose = "session" | "vault" | "user-crypto";
type Slot = "current" | "previous";

const HKDF_LABELS: Record<Purpose, string> = {
  session: "mentiko-session-signing-v1",
  vault: "mentiko-vault-encryption-v1",
  "user-crypto": "mentiko-user-crypto-v1",
};

/**
 * HKDF-Extract then HKDF-Expand (RFC 5869) using HMAC-SHA256.
 * Produces a 32-byte derived key from a master secret + info label.
 */
function hkdfSha256(ikm: string, info: string, length = 32): string {
  // Extract: PRK = HMAC-Hash(salt, IKM)  (salt = zero-length)
  const prk = createHmac("sha256", "\x00".repeat(32)).update(ikm).digest();
  // Expand: OKM = HMAC-Hash(PRK, info || 0x01)
  const okm = createHmac("sha256", prk).update(info + "\x01").digest();
  return okm.slice(0, length).toString("hex");
}

function getLocalDevSecret(): string {
  if (_devSecret) return _devSecret;

  const configured = process.env.MENTIKO_DEV_SECRET;
  if (configured) {
    _devSecret = configured;
    return _devSecret;
  }

  const root =
    process.env.MENTIKO_GLOBAL_ROOT ||
    process.env.MENTIKO_ROOT ||
    join(homedir(), ".mentiko");
  const dir = join(root, "data");
  const file = join(dir, "dev-secret");

  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, "utf8").trim();
      if (existing) {
        _devSecret = existing;
        return _devSecret;
      }
    }

    mkdirSync(dir, { recursive: true });
    _devSecret = `dev-${randomBytes(32).toString("hex")}`;
    writeFileSync(file, `${_devSecret}\n`, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {}
    return _devSecret;
  } catch {
    _devSecret = `ephemeral-dev-${randomBytes(32).toString("hex")}`;
    return _devSecret;
  }
}

/**
 * Read the root secret from env. Production requires it.
 */
function getRootSecret(context: string): string {
  const value =
    process.env.BETTER_AUTH_SECRET ||
    process.env.SECRET_KEY;
  if (value) return value;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `BETTER_AUTH_SECRET is required in production (${context})`,
    );
  }

  if (!_devSecretWarned) {
    _devSecretWarned = true;
    console.warn(
      "[security] BETTER_AUTH_SECRET not set - using local development secret. " +
        "Set BETTER_AUTH_SECRET in web/.env.local before sharing data.",
    );
  }
  return getLocalDevSecret();
}

/**
 * Resolve a purpose-specific key with slot support.
 *
 * @param purpose "session" or "vault"
 * @param slot "current" (default) or "previous" for dual-key window
 * @returns 64-char hex string (32 bytes)
 *
 * Precedence per purpose:
 *   session: SESSION_SIGNING_KEY > SESSION_SIGNING_KEY_OLD > HKDF(BETTER_AUTH_SECRET)
 *   vault:   VAULT_ENCRYPTION_KEY > VAULT_ENCRYPTION_KEY_OLD > HKDF(BETTER_AUTH_SECRET)
 *
 * Back-compat: if only BETTER_AUTH_SECRET is set, both keys are derived
 * deterministically via HKDF with fixed labels.
 */
export function resolveAppSecret(purpose: Purpose, slot: Slot): string;
/**
 * Legacy overload: single context string returns raw BETTER_AUTH_SECRET.
 * Existing callers (email-suppression, unsubscribe-token, etc.) unchanged.
 */
export function resolveAppSecret(context: string): string;
export function resolveAppSecret(purposeOrContext: string, slot: Slot = "current"): string {
  // Legacy single-arg call: just return the root secret
  if (
    purposeOrContext !== "session" &&
    purposeOrContext !== "vault" &&
    purposeOrContext !== "user-crypto"
  ) {
    return getRootSecret(purposeOrContext);
  }

  const purpose = purposeOrContext as Purpose;
  const isPrevious = slot === "previous";

  // Check for direct env var overrides (externally provisioned)
  const envMap: Record<Purpose, { current: string; previous: string }> = {
    session: {
      current: "SESSION_SIGNING_KEY",
      previous: "SESSION_SIGNING_KEY_OLD",
    },
    vault: {
      current: "VAULT_ENCRYPTION_KEY",
      previous: "VAULT_ENCRYPTION_KEY_OLD",
    },
    "user-crypto": {
      current: "USER_CRYPTO_KEY",
      previous: "USER_CRYPTO_KEY_OLD",
    },
  };

  const envVar = envMap[purpose][isPrevious ? "previous" : "current"];
  const directValue = process.env[envVar];
  if (directValue) return directValue;

  // Derive from root secret via HKDF
  const root = getRootSecret(`${purpose}-${slot}`);
  return hkdfSha256(root, HKDF_LABELS[purpose]);
}
