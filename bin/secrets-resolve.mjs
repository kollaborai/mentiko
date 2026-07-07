#!/usr/bin/env node
/**
 * secrets-resolve.mjs - resolve secret references for bash scripts
 *
 * usage: secrets-resolve.mjs <namespace-id> <org-id> <profile-file>
 *
 * reads agent profile, resolves {secret:NAME} references to actual values,
 * outputs bash export statements for sourcing.
 *
 * this allows chain-runner.sh to use encrypted secrets without needing
 * bash-side AES-256-GCM decryption.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createDecipheriv, createHash, createHmac, pbkdf2Sync } from "crypto";

const MENTIKO_ROOT = process.env.MENTIKO_GLOBAL_ROOT || join(homedir(), ".mentiko");
const NAMESPACE_ID = process.argv[2] || "default";
const ORG_ID = process.argv[3] || "default";
const PROFILE_FILE = process.argv[4];

if (!PROFILE_FILE) {
  console.error("usage: secrets-resolve.mjs <namespace-id> <org-id> <profile-file>");
  process.exit(1);
}

// ── decryption ─────────────────────────────────────────────────────────────

const KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
const KEY_DERIVATION_LABEL = "mentiko-vault-encryption-v1";
const KEY_DERIVATION_ITERATIONS = 100000;
const KEY_LENGTH_BYTES = 32;

function getVaultSecret() {
  const direct = process.env.VAULT_ENCRYPTION_KEY;
  if (direct) return direct;
  const fallback = process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY;
  if (!fallback) throw new Error("BETTER_AUTH_SECRET is required to decrypt profile secrets");
  return fallback;
}

function getLegacySecret() {
  return process.env.BETTER_AUTH_SECRET || process.env.SECRET_KEY || getVaultSecret();
}

function deriveVaultAppSecret(rootSecret) {
  const prk = createHmac("sha256", "\x00".repeat(32)).update(rootSecret).digest();
  return createHmac("sha256", prk).update(`${KEY_DERIVATION_LABEL}\x01`).digest("hex");
}

function getDerivedKey() {
  // double HKDF to match secrets-store.ts
  const appSecret = deriveVaultAppSecret(deriveVaultAppSecret(getVaultSecret()));
  return pbkdf2Sync(
    appSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}

function getLegacyDerivedKey() {
  const rawSecret = getLegacySecret();
  return pbkdf2Sync(
    rawSecret,
    KEY_DERIVATION_SALT,
    KEY_DERIVATION_ITERATIONS,
    KEY_LENGTH_BYTES,
    "sha256"
  );
}

function getKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function decrypt(ciphertext) {
  if (ciphertext.startsWith("v1:")) {
    // v1 format: v1:keyId:ivHex:tagHex:encHex
    const parts = ciphertext.split(":", 5);
    if (parts.length !== 5) return null;
    const [, keyIdStored, ivHex, tagHex, encHex] = parts;

    const key = getDerivedKey();
    const keyId = getKeyId(key);
    if (keyIdStored !== keyId) return null;

    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
  } else {
    // v0 format: ivHex:tagHex:encHex (legacy)
    const parts = ciphertext.split(":");
    if (parts.length !== 3) return null;
    const [ivHex, tagHex, encHex] = parts;

    const primaryKey = getDerivedKey();
    const legacyKey = getLegacyDerivedKey();
    const candidates = [primaryKey];
    if (!primaryKey.equals(legacyKey)) {
      candidates.push(legacyKey);
    }

    for (const candidate of candidates) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", candidate, Buffer.from(ivHex, "hex"));
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
      } catch {
        // try next key
      }
    }

    return null;
  }
}

// ── paths ───────────────────────────────────────────────────────────────────

const NAMESPACE_ROOT = join(MENTIKO_ROOT, "namespaces", NAMESPACE_ID);
const ORG_ROOT = ORG_ID === "default" ? NAMESPACE_ROOT : join(NAMESPACE_ROOT, "orgs", ORG_ID);
const SECRETS_DIR = join(ORG_ROOT, "secrets");

// ── get secret by name ───────────────────────────────────────────────────────

function getSecretByName(name) {
  if (!existsSync(SECRETS_DIR)) return null;
  for (const f of readdirSync(SECRETS_DIR).filter((x) => x.endsWith(".json"))) {
    try {
      const rec = JSON.parse(readFileSync(join(SECRETS_DIR, f), "utf8"));
      if (rec.name === name && rec.encryptedValue) {
        return decrypt(rec.encryptedValue);
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── resolve profile env ─────────────────────────────────────────────────────

const SECRET_REF_PATTERN = /^\{secret:([^}]+)\}$/;

function resolveProfileEnvVars(profileEnv) {
  const result = {};
  for (const [key, value] of Object.entries(profileEnv)) {
    const match = value.match(SECRET_REF_PATTERN);
    if (match) {
      const secretName = match[1];
      const secretValue = getSecretByName(secretName);
      if (secretValue !== null) {
        result[key] = secretValue;
      } else {
        // Missing/corrupt secrets must not poison runtime env. Leaving the
        // literal reference exports values like ANTHROPIC_BASE_URL={secret:...},
        // which breaks provider CLIs before the agent can recover.
        console.error(`# unresolved secret reference skipped: ${key}={secret:${secretName}}`);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── main ───────────────────────────────────────────────────────────────────

try {
  const profile = JSON.parse(readFileSync(PROFILE_FILE, "utf8"));
  const env = profile.env || {};

  // resolve secret references
  const resolvedEnv = resolveProfileEnvVars(env);

  // output as bash export statements (quoted for safety)
  for (const [key, value] of Object.entries(resolvedEnv)) {
    // escape single quotes and wrap in single quotes
    const escapedValue = value.replace(/'/g, "'\\''");
    console.log(`export ${key}='${escapedValue}'`);
  }
} catch (err) {
  console.error(`# error: ${err.message}`);
  process.exit(1);
}
