#!/usr/bin/env node
/**
 * secrets-resolve.mjs black-box tests
 *
 * tests the CLI via child process execution.
 * exercises: key derivation, v0/v1 decryption, secret reference resolution,
 * profile env var injection, error handling.
 */

import { execFileSync, spawnSync } from "child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";

const TMP = `/tmp/test-secrets-resolve-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "bin", "secrets-resolve.mjs");
const TEST_SECRET = "test-secrets-resolve-alignment-key";

// encrypt helper -- uses secrets-store.ts derivation path
// we replicate the exact derivation here so tests are self-contained
import { createHmac, pbkdf2Sync, createHash, createCipheriv, randomBytes as rb } from "crypto";

const SALT = "mentiko-vault-crypto-v1";
const LABEL = "mentiko-vault-encryption-v1";

function deriveVaultAppSecret(rootSecret) {
  const prk = createHmac("sha256", "\x00".repeat(32)).update(rootSecret).digest();
  return createHmac("sha256", prk).update(`${LABEL}\x01`).digest("hex");
}

function getDerivedKey(secret) {
  const appSecret = deriveVaultAppSecret(deriveVaultAppSecret(secret));
  return pbkdf2Sync(appSecret, SALT, 100000, 32, "sha256");
}

function getKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function encrypt(plaintext, secret) {
  const key = getDerivedKey(secret);
  const keyId = getKeyId(key);
  const iv = rb(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${keyId}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

function runResolve(namespaceId, orgId, profileFile, env = {}) {
  return execFileSync("node", [SCRIPT, namespaceId, orgId, profileFile], {
    env: { ...process.env, MENTIKO_GLOBAL_ROOT: TMP, ...env, BETTER_AUTH_SECRET: TEST_SECRET },
    encoding: "utf-8",
    timeout: 5000,
  });
}

function runResolveWithStderr(namespaceId, orgId, profileFile, env = {}) {
  const result = spawnSync("node", [SCRIPT, namespaceId, orgId, profileFile], {
    env: { ...process.env, MENTIKO_GLOBAL_ROOT: TMP, ...env, BETTER_AUTH_SECRET: TEST_SECRET },
    encoding: "utf-8",
    timeout: 5000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`secrets-resolve exited ${result.status}: ${result.stderr || result.stdout}`);
  }
  return { stdout: result.stdout || "", stderr: result.stderr || "" };
}

function makeSecretFile(dir, name, envVar, value) {
  const id = `sec-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const ciphertext = encrypt(value, TEST_SECRET);
  const rec = {
    id,
    name,
    envVar,
    maskedValue: value.length > 4 ? `...${value.slice(-4)}` : "****",
    encryptedValue: ciphertext,
    keyId: getKeyId(getDerivedKey(TEST_SECRET)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(rec, null, 2));
  return id;
}

function makeProfile(dir, env) {
  const file = join(dir, `profile-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ env }));
  return file;
}

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, msg) {
  if (!condition) throw new Error(`assertion failed: ${msg}`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`  ✖ ${name}`);
    console.log(`    ${err.message}`);
    testsFailed++;
  }
}

// ── setup ──────────────────────────────────────────────────────────────

const nsDir = join(TMP, "namespaces", "test-ns", "secrets");
mkdirSync(nsDir, { recursive: true });

console.log("secrets-resolve.mjs tests\n");

// ── tests ──────────────────────────────────────────────────────────────

test("resolves a single {secret:NAME} reference", () => {
  makeSecretFile(nsDir, "api-key", "API_KEY", "sk-test-123");
  const profile = makeProfile(TMP, { MY_KEY: "{secret:api-key}" });
  const output = runResolve("test-ns", "default", profile);
  assert(output.includes("export MY_KEY='sk-test-123'"), `got: ${output.trim()}`);
});

test("resolves multiple secret references", () => {
  makeSecretFile(nsDir, "db-pass", "DB_PASS", "supersecret");
  const profile = makeProfile(TMP, {
    KEY1: "{secret:api-key}",
    KEY2: "{secret:db-pass}",
  });
  const output = runResolve("test-ns", "default", profile);
  assert(output.includes("export KEY1='sk-test-123'"), `missing KEY1 in: ${output}`);
  assert(output.includes("export KEY2='supersecret'"), `missing KEY2 in: ${output}`);
});

test("leaves literal values untouched", () => {
  const profile = makeProfile(TMP, {
    LITERAL: "plain-text-value",
    ANOTHER: "/usr/local/bin",
  });
  const output = runResolve("test-ns", "default", profile);
  assert(output.includes("export LITERAL='plain-text-value'"), `got: ${output.trim()}`);
  assert(output.includes("export ANOTHER='/usr/local/bin'"), `got: ${output.trim()}`);
});

test("skips unresolved {secret:NAME} when secret not found", () => {
  const profile = makeProfile(TMP, { MISSING: "{secret:nonexistent-key}" });
  const result = runResolveWithStderr("test-ns", "default", profile);
  assert(!result.stdout.includes("export MISSING="), `got stdout: ${result.stdout.trim()}`);
  assert(result.stderr.includes("unresolved secret reference skipped: MISSING={secret:nonexistent-key}"), `got stderr: ${result.stderr.trim()}`);
});

test("handles empty profile env", () => {
  const profile = makeProfile(TMP, {});
  const output = runResolve("test-ns", "default", profile);
  assert(output.trim() === "", `expected empty output, got: ${output.trim()}`);
});

test("handles profile with no env field", () => {
  const file = join(TMP, "no-env.json");
  writeFileSync(file, JSON.stringify({ name: "test" }));
  const output = runResolve("test-ns", "default", file);
  assert(output.trim() === "", `expected empty output, got: ${output.trim()}`);
});

test("escapes single quotes in secret values", () => {
  makeSecretFile(nsDir, "quoted", "QUOTED", "it's a value with 'quotes'");
  const profile = makeProfile(TMP, { Q: "{secret:quoted}" });
  const output = runResolve("test-ns", "default", profile);
  assert(output.includes("it'\\''s a value with '\\''quotes'\\''"), `got: ${output.trim()}`);
});

test("exits 1 when no profile file argument", () => {
  try {
    execFileSync("node", [SCRIPT], {
      env: { ...process.env, BETTER_AUTH_SECRET: TEST_SECRET },
      encoding: "utf-8",
      timeout: 5000,
    });
    assert(false, "should have exited with error");
  } catch (err) {
    assert(err.status === 1, `expected exit 1, got ${err.status}`);
  }
});

test("exits 1 when profile file does not exist", () => {
  try {
    runResolve("test-ns", "default", "/nonexistent/file.json");
    assert(false, "should have exited with error");
  } catch (err) {
    assert(err.status === 1, `expected exit 1, got ${err.status}`);
  }
});

test("skips secret when no auth secret is available", () => {
  makeSecretFile(nsDir, "needs-decrypt", "NEEDS_DECRYPT", "value");
  const profile = makeProfile(TMP, { X: "{secret:needs-decrypt}" });
  const env = { ...process.env, MENTIKO_GLOBAL_ROOT: TMP };
  delete env.BETTER_AUTH_SECRET;
  delete env.SECRET_KEY;
  delete env.VAULT_ENCRYPTION_KEY;
  const result = spawnSync("node", [SCRIPT, "test-ns", "default", profile], { env, encoding: "utf-8", timeout: 5000 });
  if (result.error) throw result.error;
  assert(result.status === 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert(!result.stdout.includes("export X="), `got stdout: ${result.stdout.trim()}`);
  assert(result.stderr.includes("unresolved secret reference skipped: X={secret:needs-decrypt}"), `got stderr: ${result.stderr.trim()}`);
});

test("uses VAULT_ENCRYPTION_KEY when set", () => {
  const vaultKey = "direct-vault-key-for-testing";
  // encrypt with the vault key directly
  const key = getDerivedKey(vaultKey);
  const keyId = getKeyId(key);
  const iv = rb(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update("vault-decrypted", "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = `v1:${keyId}:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;

  const id = `sec-vault-${Date.now()}`;
  writeFileSync(join(nsDir, `${id}.json`), JSON.stringify({
    id, name: "vault-secret", envVar: "VAULT_VAR",
    encryptedValue: ciphertext, keyId,
  }));

  const profile = makeProfile(TMP, { V: "{secret:vault-secret}" });
  const output = execFileSync("node", [SCRIPT, "test-ns", "default", profile], {
    env: { ...process.env, MENTIKO_GLOBAL_ROOT: TMP, VAULT_ENCRYPTION_KEY: vaultKey },
    encoding: "utf-8",
    timeout: 5000,
  });
  assert(output.includes("export V='vault-decrypted'"), `got: ${output.trim()}`);
});

test("mixed resolved and literal env vars", () => {
  const profile = makeProfile(TMP, {
    RESOLVED: "{secret:api-key}",
    LITERAL: "plain",
    NUMBER: "42",
  });
  const output = runResolve("test-ns", "default", profile);
  assert(output.includes("export RESOLVED='sk-test-123'"), `got: ${output}`);
  assert(output.includes("export LITERAL='plain'"), `got: ${output}`);
  assert(output.includes("export NUMBER='42'"), `got: ${output}`);
});

// ── cleanup ────────────────────────────────────────────────────────────

rmSync(TMP, { recursive: true, force: true });

console.log(`\nresults: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
