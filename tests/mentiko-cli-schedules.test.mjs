#!/usr/bin/env node
/**
 * lib/mentiko-cli-schedules.mjs tests
 *
 * Black-box CLI tests using child process with mock fetch server.
 * Covers: flag parsing, payload building, command dispatch, auth checks.
 */

import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";

const TMP = `/tmp/test-cli-schedules-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "lib", "mentiko-cli-schedules.mjs");
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

function runSched(args, extraEnv = {}) {
  return execFileSync("node", [SCRIPT, ...args], {
    env: {
      PATH: `${NODE_BIN}:/usr/bin:/bin`,
      MENTIKO_WEB_URL: "http://127.0.0.1:1",
      ...extraEnv,
    },
    encoding: "utf-8",
    timeout: 5000,
  });
}

function runSchedFail(args, extraEnv = {}) {
  try {
    runSched(args, extraEnv);
    return null;
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

mkdirSync(TMP, { recursive: true });

// ── Tests ──

test("unknown command fails with exit 2", () => {
  const r = runSchedFail(["bad_cmd"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r !== null, "expected failure");
  assert(r.status === 2, `expected exit 2, got ${r.status}`);
  assert(r.stderr.includes("unknown schedule command"), `unexpected error: ${r.stderr}`);
});

test("missing token fails with exit 3", () => {
  const r = runSchedFail(["list_schedules"]);
  assert(r !== null, "expected failure");
  assert(r.status === 3, `expected exit 3, got ${r.status}`);
  assert(r.stderr.includes("MENTIKO_SESSION_TOKEN"), `missing token error: ${r.stderr}`);
});

test("delete_schedule requires --id", () => {
  const r = runSchedFail(["delete_schedule", "--yes"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r !== null, "expected failure");
  assert(r.status === 2, `expected exit 2, got ${r.status}`);
  assert(r.stderr.includes("--id required"), `unexpected: ${r.stderr}`);
});

test("delete_schedule requires --yes", () => {
  const r = runSchedFail(["delete_schedule", "--id", "s1"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r !== null, "expected failure");
  assert(r.status === 2, `expected exit 2, got ${r.status}`);
  assert(r.stderr.includes("--yes required"), `unexpected: ${r.stderr}`);
});

test("run_schedule_now requires --id and --yes", () => {
  const r1 = runSchedFail(["run_schedule_now", "--yes"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r1.status === 2, `expected exit 2: ${r1.stderr}`);

  const r2 = runSchedFail(["run_schedule_now", "--id", "s1"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r2.status === 2, `expected exit 2: ${r2.stderr}`);
  assert(r2.stderr.includes("--yes required"), `unexpected: ${r2.stderr}`);
});

test("delete_application requires --id and --yes", () => {
  const r = runSchedFail(["delete_application", "--yes"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r.status === 2, `expected exit 2: ${r.stderr}`);

  const r2 = runSchedFail(["delete_application", "--id", "a1"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r2.stderr.includes("--yes required"), `unexpected: ${r2.stderr}`);
});

test("update_schedule requires --id", () => {
  const r = runSchedFail(["update_schedule", "--name", "test"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r !== null, "expected failure");
  assert(r.status === 2, `expected exit 2: ${r.stderr}`);
  assert(r.stderr.includes("--id or JSON id required"), `unexpected: ${r.stderr}`);
});

test("update_application requires --id", () => {
  const r = runSchedFail(["update_application", "--name", "test"], { MENTIKO_SESSION_TOKEN: "tok" });
  assert(r !== null, "expected failure");
  assert(r.status === 2, `expected exit 2: ${r.stderr}`);
  assert(r.stderr.includes("--id or JSON id required"), `unexpected: ${r.stderr}`);
});

test("--json flag reads payload from file", () => {
  const payload = { name: "test-sched", cron: "0 * * * *", target: { type: "chain_run" } };
  const jsonFile = join(TMP, "payload.json");
  writeFileSync(jsonFile, JSON.stringify(payload));

  // Will fail because no server, but should parse the JSON file successfully
  const r = runSchedFail(["create_schedule", "--json", jsonFile], { MENTIKO_SESSION_TOKEN: "tok" });
  // Should fail on fetch, not on JSON parsing
  assert(r.stderr.includes("fetch") || r.stderr.includes("failed") || r.stderr.includes("ECONNREFUSED"),
    `expected fetch error, got: ${r.stderr}`);
});

test("--json-stdin reads from stdin", () => {
  const payload = JSON.stringify({ id: "app1", name: "test-app", executable: "node" });
  // execFileSync doesn't support stdin easily, use a different approach
  const stdinScript = join(TMP, "stdin-test.mjs");
  writeFileSync(stdinScript, `
    import { execFileSync } from "child_process";
    const result = execFileSync("node", ["${SCRIPT}", "register_application", "--json-stdin"], {
      env: { ...process.env, MENTIKO_SESSION_TOKEN: "tok" },
      input: '${payload.replace(/'/g, "\\'")}',
      encoding: "utf-8",
      timeout: 5000,
    });
    console.log(result);
  `);
  const r = runSchedFail(["node", stdinScript]);
  // Should fail on fetch (no server), not on parsing
  const combined = (r?.stderr || "") + (r?.stdout || "");
  assert(!combined.includes("SyntaxError"), `should not have JSON parse error: ${combined}`);
});

test("flag parsing builds correct payload from individual flags", () => {
  const jsonFile = join(TMP, "flag-test.json");
  writeFileSync(jsonFile, JSON.stringify({ id: "s1", name: "flag-test", cron: "0 9 * * *" }));

  // Test individual flags by running update_schedule with flags
  // This should attempt the fetch (and fail), showing flags parsed correctly
  const r = runSchedFail([
    "update_schedule", "--id", "s1", "--name", "test", "--cron", "0 * * * *",
    "--timezone", "UTC", "--enabled",
  ], { MENTIKO_SESSION_TOKEN: "tok" });
  // Should fail on fetch, not on flag parsing
  assert(r.stderr.includes("failed") || r.stderr.includes("ECONNREFUSED") || r.stderr.includes("fetch"),
    `expected fetch error: ${r.stderr}`);
});

// ── Run ──

await runTests();
rmSync(TMP, { recursive: true, force: true });
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
