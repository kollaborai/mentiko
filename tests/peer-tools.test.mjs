#!/usr/bin/env node
/**
 * bin/peer-* tools combined tests
 *
 * Tests argument validation and early error paths for peer-send.
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

// ── Run ──

await runTests();
rmSync(TMP, { recursive: true, force: true });
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
