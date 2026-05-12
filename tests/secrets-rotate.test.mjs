#!/usr/bin/env node
/**
 * bin/secrets-rotate black-box tests
 *
 * tests the rotation CLI via child process execution.
 * covers: success path, output text, error handling, and edge-case CLI flow.
 */

import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { createCipheriv, createHash, createHmac, pbkdf2Sync, randomBytes as rb } from "crypto";

const TMP = `/tmp/test-secrets-rotate-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "bin", "secrets-rotate");
const SECRET_OLD = "old-secret-key-for-rotation-test";
const SECRET_NEW = "new-secret-key-for-rotation-test";
const SALT = "mentiko-vault-crypto-v1";
const LABEL = "mentiko-vault-encryption-v1";
let secretSeq = 0;

function deriveVaultAppSecret(rootSecret) {
  const prk = createHmac("sha256", "\x00".repeat(32)).update(rootSecret).digest();
  return createHmac("sha256", prk).update(`${LABEL}\x01`).digest("hex");
}

function getDerivedKey(secret) {
  return pbkdf2Sync(
    deriveVaultAppSecret(deriveVaultAppSecret(secret)),
    SALT,
    100000,
    32,
    "sha256"
  );
}

function getKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function encryptV1(plaintext, secret) {
  const key = getDerivedKey(secret);
  const keyId = getKeyId(key);
  const iv = rb(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${keyId}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function encryptV0(plaintext, secret) {
  const key = getDerivedKey(secret);
  const iv = rb(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function runRotate(args, env = {}, stdinInput = "") {
  return execFileSync("node", [SCRIPT, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, MENTIKO_GLOBAL_ROOT: TMP, ...env },
    input: stdinInput,
    encoding: "utf-8",
    timeout: 5000,
  });
}

function runRotateFail(args, env = {}, stdinInput = "") {
  try {
    runRotate(args, env, stdinInput);
    return null;
  } catch (err) {
    return { status: err.status, stderr: err.stderr || "", stdout: err.stdout || "" };
  }
}

function mkdirSecrets(namespaceId) {
  const dir = join(TMP, "namespaces", namespaceId, "secrets");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSecret(dir, name, value, secret, includeKey = true) {
  const id = `sec-${++secretSeq}-${Date.now()}-${rb(2).toString("hex")}`;
  const encryptedValue = encryptV1(value, secret);
  const rec = {
    id,
    name,
    envVar: name.toUpperCase().replace(/-/g, "_"),
    maskedValue: value.length > 4 ? `...${value.slice(-4)}` : "****",
    encryptedValue,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (includeKey) {
    rec.keyId = getKeyId(getDerivedKey(secret));
  }
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(rec, null, 2));
  return id;
}

function makeV0Secret(dir, name, value, secret) {
  const id = `sec-v0-${++secretSeq}-${Date.now()}-${rb(2).toString("hex")}`;
  const encryptedValue = encryptV0(value, secret);
  const rec = {
    id,
    name,
    envVar: name.toUpperCase().replace(/-/g, "_"),
    maskedValue: value.length > 4 ? `...${value.slice(-4)}` : "****",
    encryptedValue,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(rec, null, 2));
  return id;
}

function readSecret(dir, id) {
  return JSON.parse(readFileSync(join(dir, `${id}.json`), "utf-8"));
}

function keyIdFor(secret) {
  return getKeyId(getDerivedKey(secret));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
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

let testsPassed = 0;
let testsFailed = 0;

mkdirSync(TMP, { recursive: true });

console.log("bin/secrets-rotate tests\n");

test("rotates old-key secrets and confirms count", () => {
  const nsDir = mkdirSecrets("rotate-success");
  const id = makeSecret(nsDir, "old-key", "secret-value", SECRET_OLD);

  const output = runRotate(
    ["--namespace-id", "rotate-success", "--old-secret", SECRET_OLD, "--yes"],
    { BETTER_AUTH_SECRET: SECRET_NEW }
  );

  assert(output.includes("rotate-success/default: 1/1 rotated, 0 failed"), `unexpected output: ${output.trim()}`);
  assert(output.includes("✔ 1/1 secrets rotated successfully"), `unexpected output: ${output.trim()}`);
  const rec = readSecret(nsDir, id);
  assert(rec.keyId === keyIdFor(SECRET_NEW), `keyId mismatch: ${rec.keyId}`);
  assert(rec.updatedAt !== rec.createdAt, "updatedAt should be refreshed");
});

test("dry-run shows need-rotation vs already-current", () => {
  const nsDir = mkdirSecrets("rotate-dryrun");
  makeSecret(nsDir, "already-current", "current-value", SECRET_NEW);
  makeSecret(nsDir, "needs-rotation", "old-value", SECRET_OLD);

  const output = runRotate(
    ["--namespace-id", "rotate-dryrun", "--old-secret", SECRET_OLD, "--dry-run"],
    { BETTER_AUTH_SECRET: SECRET_NEW }
  );

  assert(output.includes("rotate-dryrun/default: 1 need rotation, 1 already current"), `unexpected output: ${output.trim()}`);
  assert(output.includes("dry run complete, no changes made"), `expected completion message: ${output.trim()}`);
});

test("falls back to BETTER_AUTH_SECRET_OLD in non-interactive mode", () => {
  const nsDir = mkdirSecrets("fallback-old-env");
  const id = makeSecret(nsDir, "fallback-key", "fallback-value", SECRET_OLD);

  runRotate(
    ["--namespace-id", "fallback-old-env", "--yes"],
    {
      BETTER_AUTH_SECRET: SECRET_NEW,
      BETTER_AUTH_SECRET_OLD: SECRET_OLD,
    }
  );

  assert(readSecret(nsDir, id).keyId === keyIdFor(SECRET_NEW), "secret should rotate with fallback old env");
});

test("upgrades legacy v0 files in --same-key mode", () => {
  const nsDir = mkdirSecrets("samekey-upgrade");
  const id = makeV0Secret(nsDir, "v0-secret", "v0-value", SECRET_NEW);

  runRotate(
    ["--namespace-id", "samekey-upgrade", "--same-key", "--yes"],
    { BETTER_AUTH_SECRET: SECRET_NEW }
  );

  const rec = readSecret(nsDir, id);
  assert(rec.encryptedValue.startsWith("v1:"), `did not upgrade format: ${rec.encryptedValue}`);
  assert(rec.keyId === keyIdFor(SECRET_NEW), `wrong keyId: ${rec.keyId}`);
});

test("rotates all namespaces when --all-namespaces is used", () => {
  const nsA = mkdirSecrets("all-ns-a");
  const nsB = mkdirSecrets("all-ns-b");
  const idA = makeSecret(nsA, "a-key", "a-value", SECRET_OLD);
  const idB = makeSecret(nsB, "b-key", "b-value", SECRET_OLD);

  const output = runRotate(
    ["--all-namespaces", "--yes"],
    { BETTER_AUTH_SECRET: SECRET_NEW, BETTER_AUTH_SECRET_OLD: SECRET_OLD }
  );

  assert(output.includes("all-ns-a/default: 1/1 rotated, 0 failed"), `unexpected output: ${output.trim()}`);
  assert(output.includes("all-ns-b/default: 1/1 rotated, 0 failed"), `unexpected output: ${output.trim()}`);
  assert(readSecret(nsA, idA).keyId === keyIdFor(SECRET_NEW), "ns-a not rotated");
  assert(readSecret(nsB, idB).keyId === keyIdFor(SECRET_NEW), "ns-b not rotated");
});

test("reports parse errors as rotate failures", () => {
  const nsDir = mkdirSecrets("corrupt");
  const goodId = makeSecret(nsDir, "good-key", "good-value", SECRET_OLD);
  writeFileSync(join(nsDir, "broken.json"), "{not valid json", { encoding: "utf-8" });

  const result = runRotateFail(
    ["--namespace-id", "corrupt", "--old-secret", SECRET_OLD, "--yes"],
    { BETTER_AUTH_SECRET: SECRET_NEW }
  );

  assert(result !== null, "expected non-zero exit");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(result.stdout.includes("1/2 rotated, 1 failed"), `unexpected output: ${result.stdout}`);
  assert(readSecret(nsDir, goodId).keyId === keyIdFor(SECRET_NEW), "good secret should rotate before failure");
});

test("keeps metadata identity after rotation", () => {
  const nsDir = mkdirSecrets("metadata");
  const id = makeSecret(nsDir, "meta-key", "meta-value", SECRET_OLD);
  const before = readSecret(nsDir, id);

  runRotate(
    ["--namespace-id", "metadata", "--old-secret", SECRET_OLD, "--yes"],
    { BETTER_AUTH_SECRET: SECRET_NEW }
  );

  const after = readSecret(nsDir, id);
  assert(after.id === before.id, `id changed`);
  assert(after.name === before.name, `name changed`);
  assert(after.updatedAt !== before.updatedAt, "updatedAt not rewritten");
});

test("allows dry-run without old secret env/arg", () => {
  const nsDir = mkdirSecrets("dryrun-no-old");
  makeSecret(nsDir, "old-key", "old-value", SECRET_OLD);
  makeSecret(nsDir, "current-key", "current-value", SECRET_NEW);
  const env = {
    BETTER_AUTH_SECRET: SECRET_NEW,
    MENTIKO_GLOBAL_ROOT: TMP,
    ...{ HOME: process.env.HOME },
    ...{ PATH: process.env.PATH },
  };
  delete env.SECRET_KEY;
  delete env.VAULT_ENCRYPTION_KEY;

  const output = runRotate(
    ["--namespace-id", "dryrun-no-old", "--dry-run"],
    env
  );

  assert(output.includes("dryrun-no-old/default: 1 need rotation, 1 already current"), `unexpected output: ${output.trim()}`);
});

test("aborts when confirmation is rejected", () => {
  const nsDir = mkdirSecrets("abort-prompt");
  const id = makeSecret(nsDir, "ask-key", "value", SECRET_OLD);

  // abort exits 0 (normal), so runRotate returns normally — no throw
  const output = runRotate(
    ["--namespace-id", "abort-prompt", "--old-secret", SECRET_OLD],
    { BETTER_AUTH_SECRET: SECRET_NEW },
    "n\n"
  );
  assert(output.includes("aborted"), `missing abort message: ${output}`);
  assert(readSecret(nsDir, id).keyId === keyIdFor(SECRET_OLD), "secret should not rotate after abort");
});

test("returns code 2 when no secrets found to rotate", () => {
  // create a namespace with a secret already on current key
  const nsDir = mkdirSecrets("skip-all");
  makeSecret(nsDir, "already-current", "value", SECRET_NEW);

  const result = runRotateFail(
    ["--namespace-id", "skip-all", "--same-key", "--yes"],
    { BETTER_AUTH_SECRET: SECRET_NEW },
  );
  assert(result !== null, "expected non-zero exit");
  assert(result.status === 2, `expected exit 2, got ${result.status}`);
  assert(result.stdout.includes("no secrets found to rotate"), `unexpected output: ${result.stdout.trim()}`);
});

test("returns code 1 when BETTER_AUTH_SECRET is missing entirely", () => {
  const nsDir = mkdirSecrets("no-auth");
  makeSecret(nsDir, "old-key", "secret-value", SECRET_OLD);

  const result = runRotateFail(
    ["--namespace-id", "no-auth", "--old-secret", SECRET_OLD, "--yes"],
    { PATH: process.env.PATH, HOME: process.env.HOME }
  );
  assert(result !== null, "expected failure");
  assert(result.status === 1, `expected exit 1, got ${result.status}`);
  assert(result.stderr.includes("BETTER_AUTH_SECRET is required"), `stderr missing message: ${result.stderr}`);
});

test("returns code 2 when all-namespaces has no namespaces", () => {
  const emptyRoot = `/tmp/test-secrets-rotate-empty-${process.pid}`;
  mkdirSync(emptyRoot, { recursive: true });
  const result = runRotateFail(
    ["--all-namespaces", "--dry-run"],
    { MENTIKO_GLOBAL_ROOT: emptyRoot, BETTER_AUTH_SECRET: SECRET_NEW }
  );
  assert(result !== null, "expected failure");
  assert(result.status === 2, `expected exit 2, got ${result.status}`);
  assert(result.stdout.includes("no namespaces found"), `unexpected output: ${result.stdout.trim()}`);
});

rmSync(TMP, { recursive: true, force: true });

console.log(`\nresults: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
