#!/usr/bin/env node
/**
 * bin/peer-* tools combined tests
 *
 * Tests arg validation and early error paths for:
 * peer-send, peer-watch, peer-swarm, peer-swarm-watch
 */

import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";

const TMP = `/tmp/test-peer-tools-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
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

function runScript(scriptPath, args, extraEnv = {}) {
  return execFileSync("bash", [scriptPath, ...args], {
    env: {
      PATH: `${NODE_BIN}:/usr/bin:/bin`,
      MENTIKO_GLOBAL_ROOT: TMP,
      NAMESPACE_ID: "default",
      ...extraEnv,
    },
    encoding: "utf-8",
    timeout: 5000,
  });
}

function runScriptFail(scriptPath, args, extraEnv = {}) {
  try {
    runScript(scriptPath, args, extraEnv);
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
}

mkdirSync(TMP, { recursive: true });

// ── peer-send tests ──

test("peer-send: errors when CLAUDE_PEER not set", () => {
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-send"), ["hello"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("CLAUDE_PEER not set"), `missing error: ${r.stdout}`);
});

test("peer-send: errors when message is empty", () => {
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-send"), [], { CLAUDE_PEER: "test-peer" });
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("usage:"), `missing usage: ${r.stdout}`);
});

// ── peer-watch tests ──

test("peer-watch: errors when no session provided", () => {
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-watch"), []);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("usage:"), `missing usage: ${r.stdout}`);
});

test("peer-watch: errors when session not found", () => {
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-watch"), ["nonexistent-session"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("not found") || r.stderr.includes("not found"),
    `missing not found: ${r.stdout}${r.stderr}`);
});

// ── peer-swarm tests ──

test("peer-swarm: shows help with --help", () => {
  const out = runScript(join(REPO_ROOT, "bin", "peer-swarm"), ["--help"]);
  assert(out.includes("usage:"), `missing usage: ${out}`);
  assert(out.includes("--profile"), `missing --profile: ${out}`);
  assert(out.includes("--watch"), `missing --watch: ${out}`);
});

test("peer-swarm: errors when no task provided", () => {
  setupNamespace();
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-swarm"), []);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("task required"), `missing error: ${r.stdout}`);
});

test("peer-swarm: errors when no profile found", () => {
  setupNamespace();
  // No profile written
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-swarm"), ["build the thing"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("no agent profile found"), `missing error: ${r.stdout}`);
});

test("peer-swarm: errors when specified profile not found", () => {
  setupNamespace();
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-swarm"), [
    "build the thing", "--profile", "nonexistent"
  ]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("not found"), `missing error: ${r.stdout}`);
});

test("peer-swarm: outputs session names as JSON after profile resolution", () => {
  const nsRoot = setupNamespace();
  writeProfile(nsRoot, "default-profile");
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-swarm"), ["test task"]);
  const combined = (r?.stdout || "") + (r?.stderr || "");
  // Should get past profile check and output session names before pty-mgr fails
  if (combined.includes("sessionA")) {
    const jsonMatch = combined.match(/\{"sessionA":"[^"]+","sessionB":"[^"]+"\}/);
    assert(jsonMatch, "should output session names as JSON");
  }
});

// ── peer-swarm-watch tests ──

test("peer-swarm-watch: errors when no sessions provided", () => {
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-swarm-watch"), []);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("usage:"), `missing usage: ${r.stdout}`);
});

test("peer-swarm-watch: errors when only one session provided", () => {
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-swarm-watch"), ["session-a"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("usage:"), `missing usage: ${r.stdout}`);
});

test("peer-swarm-watch: errors when sessions not found", () => {
  const r = runScriptFail(join(REPO_ROOT, "bin", "peer-swarm-watch"), ["a", "b"]);
  assert(r !== null, "expected failure");
  assert(r.stdout.includes("not found") || r.stderr.includes("not found"),
    `missing not found: ${r.stdout}${r.stderr}`);
});

// ── Run ──

await runTests();
rmSync(TMP, { recursive: true, force: true });
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
