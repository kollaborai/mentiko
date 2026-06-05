/**
 * Per-user Data Encryption Key (DEK) wrapper for GDPR crypto-shred.
 *
 * Each user gets a random 32-byte DEK, wrapped (encrypted) under the
 * tenant KEK (derived from BETTER_AUTH_SECRET via resolveAppSecret).
 * The wrapped DEK is stored in the user row (wrapped_dek BLOB column).
 *
 * To "shred" a user's data: overwrite wrapped_dek with random bytes.
 * All ciphertext produced by encryptForUser becomes unreadable.
 * This satisfies GDPR Art 17 without scrubbing every row.
 *
 * The actual encryption of user data at rest is a FUTURE step.
 * This module provides the key management primitives now.
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto";
import { resolveAppSecret } from "../secrets/dev-secret";

const DEK_LENGTH = 32; // 256-bit AES key
const IV_LENGTH = 12;  // 96-bit IV for AES-256-GCM
const KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
const KEY_DERIVATION_ITERATIONS = 100000;

function getKEK(slot: "current" | "previous" = "current"): Buffer {
  const secret = resolveAppSecret("user-crypto", slot);
  return pbkdf2Sync(secret, KEY_DERIVATION_SALT, KEY_DERIVATION_ITERATIONS, DEK_LENGTH, "sha256");
}

function getKEKs(): Buffer[] {
  const current = getKEK("current");
  const previous = getKEK("previous");
  if (previous.equals(current)) return [current];
  return [current, previous];
}

function wrapDEK(dek: Buffer, kek: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  // format: iv(12) + tag(16) + ciphertext(32)
  return Buffer.concat([iv, tag, encrypted]);
}

function unwrapDEK(wrapped: Buffer, kek: Buffer): Buffer | null {
  try {
    if (wrapped.length < IV_LENGTH + 16 + DEK_LENGTH) return null;
    const iv = wrapped.subarray(0, IV_LENGTH);
    const tag = wrapped.subarray(IV_LENGTH, IV_LENGTH + 16);
    const ciphertext = wrapped.subarray(IV_LENGTH + 16);
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }
}

export interface UserCryptoDb {
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown };
}

/**
 * Generate a new DEK for a user, wrap it with the tenant KEK,
 * and store the wrapped DEK in the users table.
 * Returns the plaintext DEK (caller should not persist this).
 */
export function generateDEKForUser(
  userId: string,
  db: UserCryptoDb,
): Buffer {
  const dek = randomBytes(DEK_LENGTH);
  const kek = getKEK();
  const wrapped = wrapDEK(dek, kek);

  db.prepare(
    `UPDATE "user" SET wrapped_dek = ? WHERE id = ?`,
  ).run(wrapped, userId);

  return dek;
}

/**
 * Unwrap a user's DEK. Returns null if the user has no DEK
 * or if the wrapped DEK has been shredded (overwritten with garbage).
 */
export function unwrapDEKForUser(
  userId: string,
  db: UserCryptoDb,
): Buffer | null {
  const row = db.prepare(
    `SELECT wrapped_dek FROM "user" WHERE id = ?`,
  ).get(userId) as { wrapped_dek: Buffer | null } | undefined;

  if (!row?.wrapped_dek) return null;

  for (const kek of getKEKs()) {
    const dek = unwrapDEK(row.wrapped_dek, kek);
    if (dek) return dek;
  }

  return null;
}

/**
 * Encrypt plaintext for a user using their DEK.
 * Returns v1 ciphertext string, or null if user has no valid DEK.
 */
export function encryptForUser(
  userId: string,
  plaintext: string,
  db: UserCryptoDb,
): string | null {
  const dek = unwrapDEKForUser(userId, db);
  if (!dek) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const keyId = "0000000000000000";

  return `v1:${keyId}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt ciphertext for a user using their DEK.
 * Returns plaintext, or null if DEK has been shredded or ciphertext is invalid.
 */
export function decryptForUser(
  userId: string,
  ciphertext: string,
  db: UserCryptoDb,
): string | null {
  const dek = unwrapDEKForUser(userId, db);
  if (!dek) return null;

  try {
    if (!ciphertext.startsWith("v1:")) return null;
    const parts = ciphertext.split(":", 5);
    if (parts.length !== 5) return null;
    const [, , ivHex, tagHex, encHex] = parts;

    const decipher = createDecipheriv("aes-256-gcm", dek, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Shred a user's DEK by overwriting wrapped_dek with random bytes.
 * After this, all ciphertext encrypted for this user is unreadable.
 * Returns true if the shred was performed.
 */
export function shredDEK(
  userId: string,
  db: UserCryptoDb,
): boolean {
  // overwrite with random garbage of the same size as a real wrapped DEK
  // (iv=12 + tag=16 + ciphertext=32 = 60 bytes)
  const garbage = randomBytes(60);

  const result = db.prepare(
    `UPDATE "user" SET wrapped_dek = ? WHERE id = ?`,
  ).run(garbage, userId);

  return (result as { changes: number }).changes > 0;
}
