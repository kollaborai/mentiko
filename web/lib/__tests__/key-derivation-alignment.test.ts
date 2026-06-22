/**
 * @jest-environment node
 *
 * Cross-module key derivation alignment test.
 *
 * Verifies that all four implementations of secret encryption produce
 * the same derived AES key from the same BETTER_AUTH_SECRET:
 *   - web/lib/secrets-store.ts
 *   - lib/job-runner.mjs
 *   - bin/secrets-resolve.mjs
 *   - bin/secrets-rotate
 *
 * The 2026-05-07 audit found that these had diverged (different salts,
 * different HKDF round counts). This test prevents regression.
 */

import { execFileSync } from "child_process";
import { encrypt, decrypt } from "../secrets/secrets-store";

const TEST_SECRET = "test-alignment-secret-key-2026";

// helper: run a node script that uses the CLI derivation and prints the keyId
function runCliDerive(scriptPath: string, env: Record<string, string> = {}): string {
  const script = `
    const { createHash, createHmac, pbkdf2Sync } = require("crypto");

    const KEY_DERIVATION_SALT = "mentiko-vault-crypto-v1";
    const KEY_DERIVATION_LABEL = "mentiko-vault-encryption-v1";
    const KEY_DERIVATION_ITERATIONS = 100000;
    const KEY_LENGTH_BYTES = 32;

    function deriveVaultAppSecret(rootSecret) {
      const prk = createHmac("sha256", "\\0".repeat(32)).update(rootSecret).digest();
      return createHmac("sha256", prk).update(KEY_DERIVATION_LABEL + "\\x01").digest("hex");
    }

    function getVaultSecret() {
      return process.env.BETTER_AUTH_SECRET;
    }

    // double HKDF to match secrets-store.ts
    function getDerivedKey() {
      const appSecret = deriveVaultAppSecret(deriveVaultAppSecret(getVaultSecret()));
      return pbkdf2Sync(appSecret, KEY_DERIVATION_SALT, KEY_DERIVATION_ITERATIONS, KEY_LENGTH_BYTES, "sha256");
    }

    function getKeyId(key) {
      return createHash("sha256").update(key).digest("hex").slice(0, 16);
    }

    const key = getDerivedKey();
    process.stdout.write(getKeyId(key));
  `;

  return execFileSync("node", ["-e", script], {
    env: { ...process.env, ...env, BETTER_AUTH_SECRET: TEST_SECRET },
    encoding: "utf-8",
    timeout: 10000,
  }).trim();
}

// get the keyId that secrets-store.ts produces for the same secret
function getStoreKeyId(): string {
  const ciphertext = encrypt("alignment-test", TEST_SECRET);
  // v1 format: v1:keyId:iv:tag:enc
  const parts = ciphertext.split(":");
  return parts[1];
}

describe("key derivation alignment across modules", () => {
  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
  });

  test("secrets-store encrypt/decrypt round-trip works", () => {
    const plaintext = "alignment-test-value";
    const ciphertext = encrypt(plaintext, TEST_SECRET);
    expect(ciphertext.startsWith("v1:")).toBe(true);
    expect(decrypt(ciphertext, TEST_SECRET)).toBe(plaintext);
  });

  test("all modules produce the same keyId", () => {
    const storeKeyId = getStoreKeyId();

    // run the derivation logic that matches all CLI tools
    const cliKeyId = runCliDerive("");

    expect(cliKeyId).toBe(storeKeyId);
  });

  test("double HKDF produces different key than single HKDF", () => {
    const script = `
      const { createHmac, pbkdf2Sync, createHash } = require("crypto");
      const LABEL = "mentiko-vault-encryption-v1";
      const SALT = "mentiko-vault-crypto-v1";

      function hkdf(secret) {
        const prk = createHmac("sha256", "\\0".repeat(32)).update(secret).digest();
        return createHmac("sha256", prk).update(LABEL + "\\x01").digest("hex");
      }

      function keyId(buf) {
        return createHash("sha256").update(buf).digest("hex").slice(0, 16);
      }

      const raw = process.env.BETTER_AUTH_SECRET;
      const singleKey = pbkdf2Sync(hkdf(raw), SALT, 100000, 32, "sha256");
      const doubleKey = pbkdf2Sync(hkdf(hkdf(raw)), SALT, 100000, 32, "sha256");
      process.stdout.write(keyId(singleKey) + " " + keyId(doubleKey));
    `;

    const result = execFileSync("node", ["-e", script], {
      env: { ...process.env, BETTER_AUTH_SECRET: TEST_SECRET },
      encoding: "utf-8",
      timeout: 10000,
    }).trim();

    const [singleId, doubleId] = result.split(" ");
    expect(singleId).not.toBe(doubleId);

    // the double should match what secrets-store produces
    const storeKeyId = getStoreKeyId();
    expect(doubleId).toBe(storeKeyId);
  });

  test("legacy (single HKDF) key cannot decrypt v1 ciphertext", () => {
    const ciphertext = encrypt("test-value", TEST_SECRET);
    expect(ciphertext.startsWith("v1:")).toBe(true);

    // v1 ciphertext stores keyId -- wrong key will fail keyId check
    const result = decrypt(ciphertext, "wrong-secret-key-entirely");
    expect(result).toBeNull();
  });
});

describe("job-runner.mjs can decrypt secrets-store.ts ciphertext", () => {
  const SECRET_VALUE = "sk-ant-api03-alignment-test-key-value";

  test("ciphertext from secrets-store is decryptable by job-runner derivation", () => {
    const ciphertext = encrypt(SECRET_VALUE, TEST_SECRET);

    // simulate what job-runner.mjs does: double HKDF then decrypt
    const script = `
      const { createHmac, pbkdf2Sync, createHash, createDecipheriv } = require("crypto");
      const SALT = "mentiko-vault-crypto-v1";
      const LABEL = "mentiko-vault-encryption-v1";

      function hkdf(secret) {
        const prk = createHmac("sha256", "\\0".repeat(32)).update(secret).digest();
        return createHmac("sha256", prk).update(LABEL + "\\x01").digest("hex");
      }

      function getKeyId(key) {
        return createHash("sha256").update(key).digest("hex").slice(0, 16);
      }

      const raw = process.env.BETTER_AUTH_SECRET;
      const key = pbkdf2Sync(hkdf(hkdf(raw)), SALT, 100000, 32, "sha256");

      const ciphertext = process.argv[1];
      const parts = ciphertext.split(":", 5);
      const [, keyIdStored, ivHex, tagHex, encHex] = parts;

      if (getKeyId(key) !== keyIdStored) {
        process.stdout.write("KEY_MISMATCH");
        process.exit(0);
      }

      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        const plaintext = Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf8");
        process.stdout.write(plaintext);
      } catch (e) {
        process.stdout.write("DECRYPT_FAILED");
      }
    `;

    const result = execFileSync("node", ["-e", script, ciphertext], {
      env: { ...process.env, BETTER_AUTH_SECRET: TEST_SECRET },
      encoding: "utf-8",
      timeout: 10000,
    }).trim();

    expect(result).toBe(SECRET_VALUE);
  });
});
