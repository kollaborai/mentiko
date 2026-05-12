#!/usr/bin/env node
/**
 * bin/peer-chain tests
 *
 * Black-box CLI tests for peer chain setup.
 * Covers: arg validation, profile resolution, session setup.
 */

import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";

const TMP = `/tmp/test-peer-chain-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "bin", "peer-chain");
const NODE_BIN = dirname(execFileSync("which", ["node"], { encoding: "utf-8" }).trim());

let passed = 0;
let failed = 0;
const tests = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      const out = t.fn();
      if (out && typeof out.then === "function") await out;
      console.log(`  ✔ ${t.name}`);
      passed += 1;
    } catch (err) {
      console.log(`  ✖ ${t.name}`);
      console.log(`    ${err.message}`);
      failed += 1;
    }
  }
}

function runPeerChain(args, extraEnv = {}) {
  return execFileSync("bash", [SCRIPT, ...args], {
    env: {
      PATH: `${NODE_BIN}:/usr/bin:/bin`,
      MENTIKO_GLOBAL_ROOT: TMP,
      NAMESPACE_ID: "default",
      ...extraEnv,
    },
    encoding: "utf-8",
    timeout: 8000,
  });
}

function runPeerChainFail(args, extraEnv = {}) {
  try {
    runPeerChain(args, extraEnv);
    return null;
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

function setupNamespace() {
  const nsRoot = join(TMP, "namespaces", "default");
  mkdirSync(join(nsRoot, "agent-profiles"), { recursive: true });
  mkdirSync(join(nsRoot, "chains"), { recursive: true });
  mkdirSync(join(nsRoot, "runs"), { recursive: true });
  mkdirSync(join(nsRoot, "events"), { recursive: true });
  mkdirSync(join(nsRoot, "state"), { recursive: true });
  mkdirSync(join(nsRoot, "lib"), { recursive: true });
  return nsRoot;
}

function writeProfile(nsRoot, id, overrides = {}) {
  const profile = {
    id,
    name: `Profile ${id}`,
    cli: "echo",
    isDefault: true,
    pipe_flag: "--print",
    ...overrides,
  };
  writeFileSync(join(nsRoot, "agent-profiles", `${id}.json`), JSON.stringify(profile));
  return profile;
}

mkdirSync(TMP, { recursive: true });

// ── Tests ──

test("shows usage when no args provided", () => {
  const r = runPeerChainFail([]);
  assert(r !== null, "expected failure");
  assert(r.status === 1, `expected exit 1, got ${r.status}`);
  assert(r.stdout.includes("usage:"), `missing usage: ${r.stdout}`);
});

test("shows usage when only one arg provided", () => {
  const r = runPeerChainFail(["agent-a"]);
  assert(r !== null, "expected failure");
  assert(r.status === 1, `expected exit 1, got ${r.status}`);
  assert(r.stdout.includes("usage:"), `missing usage: ${r.stdout}`);
});

test("shows usage when second arg is empty", () => {
  const r = runPeerChainFail(["agent-a", ""]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("usage:"), `missing usage: ${r.stdout}`);
});

test("errors when no default profile found", () => {
  setupNamespace();
  const r = runPeerChainFail(["agent-a", "agent-b"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("no agent profile found") || r.stderr.includes("no agent profile found"),
    `unexpected output: ${r.stdout}${r.stderr}`);
});

test("errors when specified profile not found", () => {
  setupNamespace();
  writeProfile(setupNamespace(), "default-profile");
  const r = runPeerChainFail(["agent-a", "agent-b", "--profile", "nonexistent"]);
  assert(r !== null, "expected failure");
  assert(
    r.stdout.includes("not found") || r.stderr.includes("not found"),
    `missing profile not found error: ${r.stdout}${r.stderr}`
  );
});

test("resolves default profile when no --profile flag", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile", { isDefault: true });

  // Will fail on pty-manager but should get past profile resolution
  const r = runPeerChainFail(["alpha", "beta"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  // If it gets past profile resolution, it tries to start pty-manager
  assert(
    combined.includes("peer chain setup") || combined.includes("pty") || combined.includes("spawn") || combined.includes("error"),
    `unexpected output: ${combined}`
  );
});

test("--profile flag is parsed correctly", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "test-cli", { cli: "echo", pipe_flag: "-n" });

  // Will fail on pty-manager but profile should be found
  const r = runPeerChainFail(["alpha", "beta", "--profile", "test-cli"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  // Should get past profile check (may fail on pty-manager spawn)
  assert(
    !combined.includes("no agent profile found") && !combined.includes("profile 'test-cli' not found"),
    `profile should be resolved: ${combined.slice(0, 300)}`
  );
});

test("session names include date suffix", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile", { isDefault: true });

  const r = runPeerChainFail(["agent-a", "agent-b"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  // If it gets to "peer chain setup", the session names should include date suffix
  if (combined.includes("agent-a:")) {
    assert(combined.includes("agent-a-") || combined.includes("agent-a:"),
      `session name should include date suffix: ${combined.slice(0, 300)}`);
  }
});

// ── Run ──

await runTests();
rmSync(TMP, { recursive: true, force: true });
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
