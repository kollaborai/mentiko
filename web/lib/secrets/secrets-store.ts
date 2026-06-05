/**
 * Unified encrypted secrets store.
 *
 * Stores arbitrary named secrets (API keys, tokens, passwords, etc.)
 * encrypted at rest using AES-256-GCM. Key derived from BETTER_AUTH_SECRET.
 *
 * Each secret has a name, an env var name it maps to, and an encrypted value.
 * `getSecretsEnvVars()` decrypts all secrets for a namespace and returns them
 * as a flat Record<envVarName, value> — used by chain runner env injection.
 */

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, pbkdf2Sync } from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { resolveAppSecret } from "./dev-secret";
import { listProfiles } from "../agents/agent-profile-storage";

// secret reference pattern: {secret:NAME}
const SECRET_REF_PATTERN = /^\{secret:([^}]+)\}$/;

// ── encryption ─────────────────────────────────────────────────────────────

// fixed salt for key derivation (ensures reproducible keys from BETTER_AUTH_SECRET)
// in production, rotate this if BETTER_AUTH_SECRET is compromised
const KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
const KEY_DERIVATION_ITERATIONS = 100000;
const KEY_LENGTH_BYTES = 32; // 256 bits for AES-256-GCM
const KEY_DERIVATION_LABEL = "mentiko-vault-encryption-v1";

function deriveVaultAppSecret(rootSecret: string): string {
  // HKDF-Extract then HKDF-Expand with fixed, zero-length salt.
  const prk = createHmac("sha256", "\x00".repeat(32)).update(rootSecret).digest();
  return createHmac("sha256", prk)
    .update(`${KEY_DERIVATION_LABEL}\x01`)
    .digest("hex");
}

function resolveVaultSecret(secret?: string): string {
  if (secret !== undefined) {
    return deriveVaultAppSecret(secret);
  }

  return resolveAppSecret("vault", "current");
}

function resolveLegacyVaultSecret(secret?: string): string {
  if (secret !== undefined) {
    return secret;
  }

  return resolveAppSecret("vault-secret");
}

function getDerivedKey(secret?: string): Buffer {
  // when no override, use the HKDF-derived vault key (purpose-specific, not raw BETTER_AUTH_SECRET)
  const appSecret = deriveVaultAppSecret(resolveVaultSecret(secret));

  // PBKDF2 key derivation with salt and high iteration count
  return pbkdf2Sync(
    appSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}

function getLegacyDerivedKey(secret?: string): Buffer {
  // legacy v0 fallback: raw secret was fed directly into PBKDF2 (no HKDF)
  const rawSecret = resolveLegacyVaultSecret(secret);

  // PBKDF2 key derivation with salt and high iteration count
  return pbkdf2Sync(
    rawSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}

function getKeyId(key?: Buffer): string {
  const derivedKey = key ?? getDerivedKey();
  return createHash("sha256").update(derivedKey).digest("hex").slice(0, 16);
}

export function encrypt(plaintext: string, keyOverride?: string): string {
  const key = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
  const keyId = getKeyId(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${keyId}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string, keyOverride?: string): string | null {
  try {
    // detect format: v0 = 2 colons (3 parts), v1 = 4 colons (5 parts)
    if (ciphertext.startsWith("v1:")) {
      // v1 format: v1:keyId:ivHex:tagHex:encHex
      const parts = ciphertext.split(":", 5);
      if (parts.length !== 5) throw new Error("invalid v1 ciphertext format");
      const [, keyIdStored, ivHex, tagHex, encHex] = parts;

      const key = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
      const keyId = getKeyId(key);

      if (keyIdStored !== keyId) {
        // key mismatch - wrong key or data corrupted
        return null;
      }

      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
      decipher.setAuthTag(Buffer.from(tagHex, "hex"));
      return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
    } else {
      // v0 format: ivHex:tagHex:encHex (legacy, no version tag)
      const parts = ciphertext.split(":");
      if (parts.length !== 3) throw new Error("invalid v0 ciphertext format");
      const [ivHex, tagHex, encHex] = parts;

      const primaryKey = keyOverride ? getDerivedKey(keyOverride) : getDerivedKey();
      const fallbackKey = getLegacyDerivedKey(keyOverride);
      const keyCandidates = [primaryKey, ...(!primaryKey.equals(fallbackKey) ? [fallbackKey] : [])];

      for (const candidate of keyCandidates) {
        try {
          const decipher = createDecipheriv("aes-256-gcm", candidate, Buffer.from(ivHex, "hex"));
          decipher.setAuthTag(Buffer.from(tagHex, "hex"));
          return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
        } catch {
          // try next candidate
        }
      }

      return null;
    }
  } catch {
    return null;
  }
}

// ── types ───────────────────────────────────────────────────────────────────

export interface SecretMeta {
  id: string;
  name: string;
  description?: string;
  envVar: string;          // env var name to inject (e.g., MY_SECRET_KEY)
  maskedValue: string;     // last 4 chars for display
  createdAt: string;
  updatedAt: string;
}

interface SecretRecord extends SecretMeta {
  encryptedValue: string;  // AES-256-GCM ciphertext (never returned to client)
  keyId?: string;          // key ID from encryption (v1 format)
}

// ── paths ───────────────────────────────────────────────────────────────────

function secretsDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "secrets");
}

function secretPath(namespaceId: string, orgId: string, id: string): string {
  return join(secretsDir(namespaceId, orgId), `${id}.json`);
}

// ── list ────────────────────────────────────────────────────────────────────

export function listSecrets(namespaceId: string, orgId: string): SecretMeta[] {
  const dir = secretsDir(namespaceId, orgId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const rec = JSON.parse(readFileSync(join(dir, f), "utf-8")) as SecretRecord;
        const { encryptedValue: _ev, ...meta } = rec;
        return meta as SecretMeta;
      } catch { return null; }
    })
    .filter(Boolean) as SecretMeta[];
}

// ── get decrypted value ──────────────────────────────────────────────────────

export function getSecretValue(namespaceId: string, orgId: string, id: string): string | null {
  const p = secretPath(namespaceId, orgId, id);
  if (!existsSync(p)) return null;
  try {
    const rec = JSON.parse(readFileSync(p, "utf-8")) as SecretRecord;
    return decrypt(rec.encryptedValue);
  } catch { return null; }
}

// ── create ──────────────────────────────────────────────────────────────────

export function createSecret(
  namespaceId: string,
  orgId: string,
  params: { name: string; envVar: string; value: string; description?: string }
): SecretMeta {
  const dir = secretsDir(namespaceId, orgId);
  mkdirSync(dir, { recursive: true });

  const id = `sec-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const maskedValue = params.value.length > 4 ? `...${params.value.slice(-4)}` : "****";
  const now = new Date().toISOString();
  const currentKeyId = getKeyId();

  const record: SecretRecord = {
    id,
    name: params.name,
    description: params.description,
    envVar: params.envVar,
    maskedValue,
    encryptedValue: encrypt(params.value),
    keyId: currentKeyId,
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(secretPath(namespaceId, orgId, id), JSON.stringify(record, null, 2), { mode: 0o600 });

  const { encryptedValue: _ev, keyId: _ki, ...meta } = record;
  return meta as SecretMeta;
}

// ── update value ─────────────────────────────────────────────────────────────

export function updateSecret(
  namespaceId: string,
  orgId: string,
  id: string,
  params: { value?: string; name?: string; envVar?: string; description?: string }
): SecretMeta | null {
  const p = secretPath(namespaceId, orgId, id);
  if (!existsSync(p)) return null;
  try {
    const rec = JSON.parse(readFileSync(p, "utf-8")) as SecretRecord;
    if (params.value !== undefined) {
      rec.encryptedValue = encrypt(params.value);
      rec.maskedValue = params.value.length > 4 ? `...${params.value.slice(-4)}` : "****";
      rec.keyId = getKeyId();
    }
    if (params.name !== undefined) rec.name = params.name;
    if (params.envVar !== undefined) rec.envVar = params.envVar;
    if (params.description !== undefined) rec.description = params.description;
    rec.updatedAt = new Date().toISOString();
    writeFileSync(p, JSON.stringify(rec, null, 2), { mode: 0o600 });
    const { encryptedValue: _ev, keyId: _ki, ...meta } = rec;
    return meta as SecretMeta;
  } catch { return null; }
}

// ── delete ───────────────────────────────────────────────────────────────────

export function deleteSecret(namespaceId: string, orgId: string, id: string):
  | { ok: true; usages: [] }
  | { ok: false; error: string; usages: SecretUsage[] } {
  const p = secretPath(namespaceId, orgId, id);
  if (!existsSync(p)) return { ok: false, error: "Secret not found", usages: [] };

  // check if any profiles reference this secret
  const secretRec = JSON.parse(readFileSync(p, "utf-8")) as SecretRecord;
  const usages = findProfilesUsingSecret(namespaceId, orgId, secretRec.name);

  if (usages.length > 0) {
    return {
      ok: false,
      error: `Secret is used in ${usages.length} profile${usages.length > 1 ? "s" : ""}`,
      usages,
    };
  }

  unlinkSync(p);
  return { ok: true, usages: [] };
}

// ── env injection ─────────────────────────────────────────────────────────────

/**
 * Get decrypted env vars from the secrets store.
 * Returns Record<envVarName, decryptedValue>.
 * Used by chain runner for env injection.
 */
export function getSecretsEnvVars(namespaceId: string, orgId: string): Record<string, string> {
  const dir = secretsDir(namespaceId, orgId);
  const result: Record<string, string> = {};
  if (!existsSync(dir)) return result;

  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .forEach((f) => {
      try {
        const rec = JSON.parse(readFileSync(join(dir, f), "utf-8")) as SecretRecord;
        if (rec.envVar && rec.encryptedValue) {
          const val = decrypt(rec.encryptedValue);
          if (val) {
            result[rec.envVar] = val;
          } else {
            console.warn(`[secrets] decryption failed: ${rec.id} — key mismatch or corrupt`);
          }
        }
      } catch (err) {
        console.warn(`[secrets] error reading secret: ${f} — ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  return result;
}

/**
 * Find a secret by name and return its decrypted value.
 * Used for resolving {secret:NAME} references in agent profiles.
 */
export function getSecretByName(namespaceId: string, orgId: string, name: string): string | null {
  const dir = secretsDir(namespaceId, orgId);
  if (!existsSync(dir)) return null;

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf-8")) as SecretRecord;
      if (rec.name === name && rec.encryptedValue) {
        const val = decrypt(rec.encryptedValue);
        if (!val) {
          console.warn(`[secrets] decryption failed: ${rec.id} — key mismatch or corrupt`);
        }
        return val;
      }
    } catch (err) {
      console.warn(`[secrets] error reading secret: ${f} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

// ── profile dependency tracking ────────────────────────────────────────────────────────

/**
 * Find all agent profiles that reference a secret by name.
 * Returns array of { profileId, profileName, envVar } for each reference.
 */
export interface SecretUsage {
  profileId: string;
  profileName: string;
  envVar: string;
}

export function findProfilesUsingSecret(namespaceId: string, orgId: string, secretName: string): SecretUsage[] {
  const profiles = listProfiles(namespaceId, orgId);
  const usages: SecretUsage[] = [];

  for (const profile of profiles) {
    if (!profile.env) continue;
    for (const [envVar, value] of Object.entries(profile.env)) {
      const match = value.match(SECRET_REF_PATTERN);
      if (match && match[1] === secretName) {
        usages.push({
          profileId: profile.id,
          profileName: profile.name,
          envVar,
        });
      }
    }
  }

  return usages;
}

/**
 * Resolve secret references in agent profile env values.
 * Supports syntax: {secret:SECRET_NAME}
 * Returns Record<envVarName, resolvedValue>.
 */
export function resolveProfileEnvVars(
  namespaceId: string,
  orgId: string,
  profileEnv: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(profileEnv)) {
    const match = value.match(SECRET_REF_PATTERN);
    if (match) {
      const secretName = match[1];
      const secretValue = getSecretByName(namespaceId, orgId, secretName);
      if (secretValue !== null) {
        result[key] = secretValue;
      } else {
        // secret not found, leave the reference as-is (will fail at runtime)
        result[key] = value;
      }
    } else {
      // not a secret reference, use literal value
      result[key] = value;
    }
  }

  return result;
}

// ── key rotation ────────────────────────────────────────────────────────────

export type SecretStatus = "ok" | "unreadable" | "unknown";

export interface SecretStatusInfo {
  id: string;
  name: string;
  status: SecretStatus;
}

export interface RotateSecretsResult {
  ok: boolean;
  total: number;
  rotated?: number;
  skipped?: number;
  failed?: number;
  needsRotation?: number;
  alreadyCurrent?: number;
  dryRun: boolean;
  failures?: Array<{ id: string; name: string; error: string }>;
  error?: string;
}

/**
 * Re-encrypt all secrets with a new key.
 * oldSecret: the previous BETTER_AUTH_SECRET value
 * dryRun: if true, don't write anything, just report counts
 */
export function rotateSecrets(
  namespaceId: string,
  orgId: string,
  oldSecret: string,
  opts: { dryRun?: boolean } = {}
): RotateSecretsResult {
  const dir = secretsDir(namespaceId, orgId);
  const currentKeyId = getKeyId();
  getDerivedKey(oldSecret); // validates oldSecret is a usable key (throws on bad input)

  if (!existsSync(dir)) {
    return { ok: true, total: 0, dryRun: opts.dryRun || false };
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const failures: Array<{ id: string; name: string; error: string }> = [];
  let rotated = 0;
  let skipped = 0;
  let dryRunNeeds = 0;
  let dryRunCurrent = 0;

  for (const f of files) {
    const p = join(dir, f);
    try {
      const rec = JSON.parse(readFileSync(p, "utf-8")) as SecretRecord;

      // skip if already on current key
      if (rec.keyId === currentKeyId) {
        if (opts.dryRun) {
          dryRunCurrent++;
        } else {
          skipped++;
        }
        continue;
      }

      // check if we have anything to rotate
      if (opts.dryRun) {
        if (rec.keyId) {
          dryRunNeeds++;
        } else {
          const readableWithCurrent = decrypt(rec.encryptedValue);
          if (readableWithCurrent !== null) {
            dryRunCurrent++;
          } else {
            dryRunNeeds++;
          }
        }
        continue;
      }

      // try to decrypt with old key
      const plaintext = decrypt(rec.encryptedValue, oldSecret);
      if (!plaintext) {
        failures.push({
          id: rec.id,
          name: rec.name,
          error: "decryption failed with old key — manual intervention required",
        });
        continue;
      }

      // re-encrypt with new key
      rec.encryptedValue = encrypt(plaintext);
      rec.keyId = currentKeyId;
      rec.updatedAt = new Date().toISOString();

      // atomic write: write to .tmp, rename
      const tmpPath = `${p}.tmp`;
      writeFileSync(tmpPath, JSON.stringify(rec, null, 2), { mode: 0o600 });
      renameSync(tmpPath, p);

      rotated++;
    } catch (err) {
      failures.push({
        id: f.replace(".json", ""),
        name: f,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (opts.dryRun) {
    return {
      ok: true,
      total: files.length,
      needsRotation: dryRunNeeds,
      alreadyCurrent: dryRunCurrent,
      dryRun: true,
    };
  }

  // if all secrets failed and we rotated none, likely wrong old key
  if (rotated === 0 && failures.length === files.length && files.length > 0) {
    return {
      ok: false,
      total: files.length,
      rotated: 0,
      skipped,
      failed: failures.length,
      dryRun: false,
      failures,
      error: "old secret produced no valid decryptions — check BETTER_AUTH_SECRET_OLD",
    };
  }

  return {
    ok: failures.length === 0,
    total: files.length,
    rotated,
    skipped,
    failed: failures.length,
    dryRun: false,
    ...(failures.length > 0 && { failures }),
  };
}

/**
 * Get status (ok/unreadable/unknown) for each secret without decrypting.
 */
export function getSecretsStatus(namespaceId: string, orgId: string): SecretStatusInfo[] {
  const dir = secretsDir(namespaceId, orgId);
  if (!existsSync(dir)) return [];
  const currentKeyId = getKeyId();

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const p = join(dir, f);
      try {
        const rec = JSON.parse(readFileSync(p, "utf-8")) as SecretRecord;
        return {
          id: rec.id,
          name: rec.name,
          status: rec.keyId === currentKeyId ? "ok" : "unreadable",
        };
      } catch {
        return {
          id: f.replace(".json", ""),
          name: f,
          status: "unknown" as const,
        };
      }
    });
}
