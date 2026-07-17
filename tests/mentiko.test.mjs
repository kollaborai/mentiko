#!/usr/bin/env node
/**
 * tests for bin/mentiko CLI parse and dispatch behavior
 * (mocking script dispatch with local bash/node shims).
 */

import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const TMP = `/tmp/test-mentiko-cli-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "bin", "mentiko");
const FIXTURES = join(REPO_ROOT, "tests", "fixtures", "mentiko");
const CHAIN_FIXTURE = join(FIXTURES, "dispatch-chain.json");
const CALL_LOG = join(TMP, "dispatch-calls.log");
const FAKE_BIN = join(TMP, "fake-bin");
const HOME_DIR = join(TMP, "home");
const MENTIKO_GLOBAL_ROOT = join(TMP, "mentiko-root");
const DEFAULT_ENV = {
  HOME: HOME_DIR,
  NODE_PATH: join(REPO_ROOT, "web", "node_modules"),
  MENTIKO_GLOBAL_ROOT,
  PATH: `${FAKE_BIN}:${process.env.PATH || ""}`,
  MENTIKO_TEST_CALL_LOG: CALL_LOG,
  MENTIKO_TEST_REAL_NODE: process.execPath,
};
const BASE_ASSERT = { passed: 0, failed: 0 };
const results = { ...BASE_ASSERT };

function logCallFixtureFiles(scriptName) {
  const script = join(FAKE_BIN, "bash");
  const nodeScript = join(FAKE_BIN, "node");
  const bashBody = `#!/usr/bin/env bash
set -euo pipefail
script="$1"
name="\${script##*/}"
case "$name" in
  chain-runner.sh|chain-generator.sh|validate.sh|launch-agent.sh)
    printf '%s\n' "bash:$*" >> "\${MENTIKO_TEST_CALL_LOG}"
    exit 0
    ;;
esac
exec /bin/bash "$@"
`;
  const nodeBody = `#!/usr/bin/env bash
set -euo pipefail
script="$1"
name="\${script##*/}"
if [[ "$name" == "mentiko-cli-schedules.mjs" || "$name" == "runner-manual-monitor.js" || "$name" == "runner-v2-direct-run.js" || "$name" == "runner-v2-standalone-agent-launch.js" ]]; then
  printf '%s\n' "node:$*" >> "\${MENTIKO_TEST_CALL_LOG}"
  exit 0
fi
exec "\${MENTIKO_TEST_REAL_NODE}" "$@"
`;

  writeFileSync(script, bashBody, { mode: 0o755 });
  writeFileSync(nodeScript, nodeBody, { mode: 0o755 });
}

function runMentiko(args, env = {}) {
  const childEnv = {
    ...process.env,
    ...DEFAULT_ENV,
    ...env,
  };
  try {
    const result = spawnSync("/bin/bash", [SCRIPT, ...args], {
      env: childEnv,
      encoding: "utf-8",
      timeout: 5000,
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✔ ${name}`);
    results.passed += 1;
  } catch (err) {
    console.log(`  ✖ ${name}`);
    console.log(`    ${err.message}`);
    results.failed += 1;
  }
}

function readCalls() {
  if (!existsSync(CALL_LOG)) return [];
  return readFileSync(CALL_LOG, "utf-8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clearCalls() {
  writeFileSync(CALL_LOG, "");
}

mkdirSync(TMP, { recursive: true });
mkdirSync(FAKE_BIN, { recursive: true });
mkdirSync(HOME_DIR, { recursive: true });
mkdirSync(MENTIKO_GLOBAL_ROOT, { recursive: true });
logCallFixtureFiles();

console.log("bin/mentiko cli dispatch tests");
console.log("");

test("defaults to help when no command is provided", () => {
  clearCalls();
  const res = runMentiko([]);
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(
    res.stdout.includes("mentiko - AI agent chain orchestration"),
    `missing usage output: ${res.stdout}`
  );
  assert(readCalls().length === 0, "did not dispatch without command");
});

test("dispatches supported direct run to the typed runtime without chain-runner", () => {
  clearCalls();
  const res = runMentiko(["run", CHAIN_FIXTURE, "--start", "researcher"]);
  const calls = readCalls();
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(calls.length === 1, `expected one dispatch, got ${calls.length}`);
  assert(calls[0].includes("runner-v2-direct-run.js"), `unexpected call: ${calls[0]}`);
  assert(!calls[0].includes("chain-runner.sh"), `shell runner must not be invoked: ${calls[0]}`);
  assert(calls[0].includes(CHAIN_FIXTURE), `typed runtime got wrong args: ${calls[0]}`);
});

test("dispatches generate command to chain-generator", () => {
  clearCalls();
  const res = runMentiko(["generate", "write this prompt", "--json"]);
  const calls = readCalls();
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(calls.length === 1, `expected one dispatch, got ${calls.length}`);
  assert(calls[0].startsWith("bash:"), `unexpected call prefix: ${calls[0]}`);
  assert(calls[0].includes("chain-generator.sh"), `missing chain-generator dispatch: ${calls[0]}`);
});

test("dispatches validate command to validate script", () => {
  clearCalls();
  const res = runMentiko(["validate", CHAIN_FIXTURE]);
  const calls = readCalls();
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(calls.length === 1, `expected one dispatch, got ${calls.length}`);
  assert(calls[0].includes("validate.sh"), `missing validate dispatch: ${calls[0]}`);
});

test("dispatches launch command to the typed standalone agent launcher", () => {
  clearCalls();
  const res = runMentiko(["launch", CHAIN_FIXTURE]);
  const calls = readCalls();
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(calls.length === 1, `expected one dispatch, got ${calls.length}`);
  assert(calls[0].includes("runner-v2-standalone-agent-launch.js"), `missing typed launch dispatch: ${calls[0]}`);
  assert(!calls[0].includes("launch-agent.sh"), `shell launcher must not be invoked: ${calls[0]}`);
});

test("graphs with no chain file show usage and fail", () => {
  clearCalls();
  const res = runMentiko(["graph"]);
  assert(res.status === 1, `expected status 1, got ${res.status}`);
  assert(
    res.stdout.includes("usage: mentiko graph <chain.json>"),
    `missing usage output: ${res.stdout}`
  );
  assert(readCalls().length === 0, "no dispatch expected for invalid graph");
});

test("graphs valid chain through chain-runner with --dry-run", () => {
  clearCalls();
  const res = runMentiko(["graph", CHAIN_FIXTURE]);
  const calls = readCalls();
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(calls.length === 1, `expected one dispatch, got ${calls.length}`);
  assert(calls[0].includes("chain-runner.sh"), `missing chain-runner dispatch: ${calls[0]}`);
  assert(calls[0].includes("--dry-run"), `missing --dry-run: ${calls[0]}`);
});

test("dispatches schedule family commands to mentiko-cli-schedules", () => {
  clearCalls();
  const res = runMentiko(["list_schedules"]);
  const calls = readCalls();
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(calls.length === 1, `expected one dispatch, got ${calls.length}`);
  assert(calls[0].includes("mentiko-cli-schedules.mjs"), `missing schedules dispatch: ${calls[0]}`);
  assert(calls[0].includes("list_schedules"), `missing subcommand: ${calls[0]}`);
});

test("dispatches monitor command to the typed manual monitor", () => {
  clearCalls();
  const res = runMentiko(["monitor", "agent-42", "healthy"]);
  const calls = readCalls();
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(calls.length === 1, `expected one dispatch, got ${calls.length}`);
  assert(calls[0].includes("runner-manual-monitor.js"), `missing typed monitor dispatch: ${calls[0]}`);
});

test("rejects audit clear without explicit confirmation", () => {
  clearCalls();
  const res = runMentiko(["audit", "clear"]);
  assert(res.status === 1, `expected status 1, got ${res.status}`);
  assert(
    res.stdout.includes("warning: this will delete all audit logs"),
    `missing warning: ${res.stdout}`
  );
  assert(
    res.stdout.includes("usage: mentiko audit clear --confirm"),
    `missing usage: ${res.stdout}`
  );
  assert(readCalls().length === 0, "no dispatch expected");
});

test("emits event file using provided event/source arguments", () => {
  const res = runMentiko(["emit", "task.completed", "agent-01"]);
  const eventsDir = join(MENTIKO_GLOBAL_ROOT, "namespaces", "default", "events");
  const eventFile = join(eventsDir, "agent-01-task.completed.event");
  assert(res.status === 0, `expected status 0, got ${res.status}`);
  assert(
    res.stdout.includes("emitted: task.completed from agent-01"),
    `missing emit output: ${res.stdout}`
  );
  assert(existsSync(eventFile), `expected event file: ${eventFile}`);
});

test("validate/peek/send/kill missing args show usage", () => {
  let res = runMentiko(["peek"]);
  assert(res.status === 1, `peek expected status 1, got ${res.status}`);
  assert(res.stdout.includes("usage: mentiko peek <session-name> [lines]"), `peek usage missing: ${res.stdout}`);

  res = runMentiko(["send"]);
  assert(res.status === 1, `send expected status 1, got ${res.status}`);
  assert(res.stdout.includes('usage: mentiko send <session-name> "message"'), `send usage missing: ${res.stdout}`);

  res = runMentiko(["kill"]);
  assert(res.status === 1, `kill expected status 1, got ${res.status}`);
  assert(res.stdout.includes("usage: mentiko kill <session-name>"), `kill usage missing: ${res.stdout}`);
});

rmSync(TMP, { recursive: true, force: true });

console.log(`\nresults: ${results.passed} passed, ${results.failed} failed`);
process.exit(results.failed > 0 ? 1 : 0);
