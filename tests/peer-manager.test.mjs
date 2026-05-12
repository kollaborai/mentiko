#!/usr/bin/env node
/**
 * bin/peer-manager tests
 *
 * Black-box CLI tests for peer manager arg parsing and validation.
 * Tests early error paths without needing pty-manager or CLI runtime.
 */

import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";

const TMP = `/tmp/test-peer-manager-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "bin", "peer-manager");
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

function runMgr(args, extraEnv = {}) {
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

function runMgrFail(args, extraEnv = {}) {
  try {
    runMgr(args, extraEnv);
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
  const dirs = ["agent-profiles", "chains", "runs", "events", "state", "logs", "lib"];
  for (const d of dirs) {
    mkdirSync(join(nsRoot, d), { recursive: true });
  }
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
}

mkdirSync(TMP, { recursive: true });

// ── Tests ──

test("shows help with --help", () => {
  const out = runMgr(["--help"]);
  assert(out.includes("usage:"), `missing usage: ${out}`);
  assert(out.includes("--profile"), `missing --profile: ${out}`);
  assert(out.includes("--rounds"), `missing --rounds: ${out}`);
  assert(out.includes("--watch"), `missing --watch: ${out}`);
  assert(out.includes("--resume"), `missing --resume: ${out}`);
});

test("errors when no task or --resume provided", () => {
  const r = runMgrFail([]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("task required"), `missing error: ${r.stdout}`);
});

test("errors when no profile found", () => {
  setupNamespace();
  const r = runMgrFail(["build the feature"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("no agent profile found"), `missing error: ${r.stdout}`);
});

test("errors when specified profile not found", () => {
  setupNamespace();
  const r = runMgrFail(["build the feature", "--profile", "nonexistent"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("not found"), `missing error: ${r.stdout}`);
});

test("errors on invalid profile id characters", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");
  const r = runMgrFail(["build", "--profile", "../../../etc/passwd"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("invalid profile id"), `missing error: ${r.stdout}`);
});

test("resolves default profile and gets past profile check", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");
  // Should get past profile check (may fail later on pty-mgr)
  const r = runMgrFail(["build the feature"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  assert(!combined.includes("no agent profile found"), `should not fail on profile: ${combined.slice(0, 300)}`);
});

test("--profile1 and --profile2 flags are parsed", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");
  writeProfile(nsRoot, "custom-p1");
  writeProfile(nsRoot, "custom-p2");

  const r = runMgrFail(["build", "--profile1", "custom-p1", "--profile2", "custom-p2"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  // Should get past profile checks (may fail on pty-mgr)
  assert(
    !combined.includes("not found") || combined.includes("pty") || combined.includes("p:"),
    `profiles should be resolved: ${combined.slice(0, 300)}`
  );
});

test("--rounds flag is parsed", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");

  const r = runMgrFail(["build", "--rounds", "5"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  // Should get past arg parsing
  assert(!combined.includes("task required"), `should parse --rounds: ${combined.slice(0, 200)}`);
});

test("--name1 and --name2 flags are parsed", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");

  const r = runMgrFail(["build", "--name1", "alice", "--name2", "bob"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  assert(!combined.includes("task required"), `should parse name flags: ${combined.slice(0, 200)}`);
});

test("--resume flag bypasses task requirement", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");

  // --resume should not require task arg
  const r = runMgrFail(["--resume", "meeting-123"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  assert(!combined.includes("task required"), `--resume should bypass task: ${combined.slice(0, 200)}`);
});

test("_safe_profile_id rejects path traversal", () => {
  // Test by passing a profile with path separators
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");

  const r = runMgrFail(["build", "--profile", "../hack"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("invalid profile id"), `should reject path: ${r.stdout}`);
});

// ── Run ──

await runTests();
rmSync(TMP, { recursive: true, force: true });
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
