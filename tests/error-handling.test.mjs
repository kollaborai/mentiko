#!/usr/bin/env node
/**
 * lib/error-handling.sh tests
 *
 * Covers:
 *   detect-agent-error  - error/timeout detection from agent output
 *   get-agent-retry-count / increment-retry-count - retry state tracking
 *   calculate-retry-delay - backoff strategies (fixed, linear, exponential)
 *   handle-agent-error - error routing, retry scheduling, handler dispatch
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const TMP = `/tmp/test-error-handling-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "lib", "error-handling.sh");
const RUN_ID = "run-error-test";

const tests = [];
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
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
  console.log("");
  console.log(`results: ${passed} passed, ${failed} failed, ${tests.length} total`);
  if (failed > 0) process.exit(1);
}

function resetTmp() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

/**
 * Run a bash snippet that sources error-handling.sh and executes code.
 * Returns { stdout, stderr, status }.
 */
function runBash(snippet, opts = {}) {
  const env = { ...process.env, MENTIKO_CODE_ROOT: REPO_ROOT, RUN_ID, ...opts.env };
  try {
    const stdout = execFileSync("bash", ["-c", snippet], {
      encoding: "utf-8",
      timeout: 10000,
      env,
    });
    return { stdout: stdout.trim(), stderr: "", status: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout || "").trim(),
      stderr: (err.stderr || "").trim(),
      status: err.status || 1,
    };
  }
}

function statePath(stateDir, sessionPrefix) {
  const normalize = (value) => value.replaceAll("-", "_").replaceAll(/[^a-zA-Z0-9_]/g, "_");
  return join(stateDir, `${normalize(sessionPrefix)}_${normalize(RUN_ID)}.state`);
}

function writeState(stateDir, sessionPrefix, retryAttempt = "0", fields = {}) {
  const state = {
    status: "running",
    session: `${sessionPrefix}-${RUN_ID}`,
    agent_id: sessionPrefix,
    retry_attempt: String(retryAttempt),
    ...fields,
  };
  writeFileSync(statePath(stateDir, sessionPrefix), Object.entries(state)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n") + "\n");
}

// ============================================================
// detect-agent-error
// ============================================================

test("detect-agent-error returns 0 when file does not exist", () => {
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "/nonexistent/file.txt"
    echo $?
  `);
  assert(result.status === 0, `expected exit 0, got ${result.status}`);
  // last line is the exit code echo
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "0", `expected "0", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 0 for clean output", () => {
  const file = join(TMP, "clean-report.txt");
  resetTmp();
  writeFileSync(file, "agent completed successfully\nno issues found\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "0", `expected "0", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 2 for timeout markers", () => {
  const file = join(TMP, "timeout-report.txt");
  resetTmp();
  writeFileSync(file, "operation timed out after 60 seconds\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "2", `expected "2", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 2 for 'deadline exceeded'", () => {
  const file = join(TMP, "deadline-report.txt");
  resetTmp();
  writeFileSync(file, "deadline exceeded\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "2", `expected "2", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 1 for 'error' marker", () => {
  const file = join(TMP, "error-report.txt");
  resetTmp();
  writeFileSync(file, "error: something went wrong\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "1", `expected "1", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 1 for 'failed' marker", () => {
  const file = join(TMP, "failed-report.txt");
  resetTmp();
  writeFileSync(file, "task failed to complete\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "1", `expected "1", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 1 for 'exception' marker", () => {
  const file = join(TMP, "exception-report.txt");
  resetTmp();
  writeFileSync(file, "unhandled exception in module\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "1", `expected "1", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 1 for 'traceback' marker", () => {
  const file = join(TMP, "traceback-report.txt");
  resetTmp();
  writeFileSync(file, "traceback (most recent call last)\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "1", `expected "1", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 1 for 'fatal' marker", () => {
  const file = join(TMP, "fatal-report.txt");
  resetTmp();
  writeFileSync(file, "fatal: cannot continue\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "1", `expected "1", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error prioritizes timeout (2) over error (1)", () => {
  const file = join(TMP, "both-report.txt");
  resetTmp();
  writeFileSync(file, "error: timeout while processing\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  // timeout check runs first in the function, so it should return 2
  assert(lines[lines.length - 1] === "2", `expected "2", got "${lines[lines.length - 1]}"`);
});

test("detect-agent-error returns 0 for empty file", () => {
  const file = join(TMP, "empty-report.txt");
  resetTmp();
  writeFileSync(file, "");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "0", `expected "0", got "${lines[lines.length - 1]}"`);
});

// ============================================================
// get-agent-retry-count / increment-retry-count
// ============================================================

test("get-agent-retry-count returns 0 when state file missing", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    get-agent-retry-count "test_agent"
  `);
  assert(result.stdout === "0", `expected "0", got "${result.stdout}"`);
});

test("get-agent-retry-count reads retry_attempt from state file", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  writeState(stateDir, "my_agent", "3");
  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    get-agent-retry-count "my_agent"
  `);
  assert(result.stdout === "3", `expected "3", got "${result.stdout}"`);
});

test("get-agent-retry-count returns zero when retry metadata is absent", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath(stateDir, "agent"), "status: running\nsession: agent-run-error-test\nagent_id: agent\n");
  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    get-agent-retry-count "agent"
  `);
  assert(result.stdout === "0", `expected "0", got "${result.stdout}"`);
});

test("increment-retry-count bumps retry_attempt and outputs new value", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  writeState(stateDir, "worker", "2");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    increment-retry-count "worker"
  `);
  assert(result.stdout === "3", `expected "3", got "${result.stdout}"`);

  // verify the file was actually updated
  const contents = readFileSync(statePath(stateDir, "worker"), "utf-8");
  assert(contents.includes("retry_attempt: 3"), `file should contain "retry_attempt: 3", got: ${contents}`);
});

test("increment-retry-count fails closed when state file is missing", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    increment-retry-count "nonexistent"
  `);
  assert(result.status !== 0, `expected a missing-state failure, got ${result.status}`);
  assert(result.stderr.includes("does not exist"), `expected missing-state error, got "${result.stderr}"`);
});

test("increment-retry-count preserves other state fields", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  writeState(stateDir, "preserve", "1", { emits: "preserved-event" });

  runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    increment-retry-count "preserve"
  `);

  const contents = readFileSync(statePath(stateDir, "preserve"), "utf-8");
  assert(contents.includes("status: running"), `should preserve "status: running"`);
  assert(contents.includes("emits: preserved-event"), `should preserve "emits: preserved-event"`);
  assert(contents.includes("retry_attempt: 2"), `should update retry_attempt to 2`);
});

test("increment-retry-count works sequentially from 0 to 3", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  writeState(stateDir, "seq", "0");

  for (let i = 1; i <= 3; i++) {
    const result = runBash(`
      source "${SCRIPT}"
      STATE_DIR="${stateDir}"
      increment-retry-count "seq"
    `);
    assert(result.stdout === String(i), `expected "${i}", got "${result.stdout}"`);
  }

  const finalContents = readFileSync(statePath(stateDir, "seq"), "utf-8");
  assert(finalContents.includes("retry_attempt: 3"), `final should be retry_attempt: 3`);
});

// ============================================================
// calculate-retry-delay
// ============================================================

test("calculate-retry-delay fixed returns initial_delay regardless of attempt", () => {
  for (const attempt of [0, 1, 5, 10]) {
    const result = runBash(`
      source "${SCRIPT}"
      calculate-retry-delay ${attempt} fixed 10 300 2.0
    `);
    assert(result.stdout === "10", `attempt ${attempt}: expected "10", got "${result.stdout}"`);
  }
});

test("calculate-retry-delay linear scales with attempt", () => {
  const cases = [
    { attempt: 0, initial: 5, expected: 5 },   // 5 * (0+1) = 5
    { attempt: 1, initial: 5, expected: 10 },  // 5 * (1+1) = 10
    { attempt: 2, initial: 5, expected: 15 },  // 5 * (2+1) = 15
    { attempt: 3, initial: 5, expected: 20 },  // 5 * (3+1) = 20
  ];
  for (const { attempt, initial, expected } of cases) {
    const result = runBash(`
      source "${SCRIPT}"
      calculate-retry-delay ${attempt} linear ${initial} 300 2.0
    `);
    assert(result.stdout === String(expected), `attempt ${attempt}: expected "${expected}", got "${result.stdout}"`);
  }
});

test("calculate-retry-delay exponential grows by multiplier", () => {
  const cases = [
    { attempt: 0, expected: 5 },    // 5 * 2^0 = 5
    { attempt: 1, expected: 10 },   // 5 * 2^1 = 10
    { attempt: 2, expected: 20 },   // 5 * 2^2 = 20
    { attempt: 3, expected: 40 },   // 5 * 2^3 = 40
  ];
  for (const { attempt, expected } of cases) {
    const result = runBash(`
      source "${SCRIPT}"
      calculate-retry-delay ${attempt} exponential 5 300 2.0
    `);
    assert(result.stdout === String(expected), `attempt ${attempt}: expected "${expected}", got "${result.stdout}"`);
  }
});

test("calculate-retry-delay respects max_delay cap", () => {
  // attempt 10 with exponential: 5 * 2^10 = 5120, capped at 100
  const result = runBash(`
    source "${SCRIPT}"
    calculate-retry-delay 10 exponential 5 100 2.0
  `);
  assert(result.stdout === "100", `expected "100", got "${result.stdout}"`);
});

test("calculate-retry-delay uses defaults when only attempt given", () => {
  // defaults: backoff=exponential, initial=5, max=300, multiplier=2.0
  const result = runBash(`
    source "${SCRIPT}"
    calculate-retry-delay 0
  `);
  assert(result.stdout === "5", `expected "5", got "${result.stdout}"`);
});

test("calculate-retry-delay exponential with custom multiplier", () => {
  // 10 * 3^2 = 90
  const result = runBash(`
    source "${SCRIPT}"
    calculate-retry-delay 2 exponential 10 300 3.0
  `);
  assert(result.stdout === "90", `expected "90", got "${result.stdout}"`);
});

test("calculate-retry-delay exponential with multiplier 1.5", () => {
  // 10 * 1.5^2 = 22.5 -> 22 (rounded)
  const result = runBash(`
    source "${SCRIPT}"
    calculate-retry-delay 2 exponential 10 300 1.5
  `);
  // awk printf %.0f rounds, 22.5 -> 22 (platform dependent, accept 22 or 23)
  const val = parseInt(result.stdout, 10);
  assert(val >= 22 && val <= 23, `expected ~22, got "${result.stdout}"`);
});

// ============================================================
// handle-agent-error
// ============================================================

test("handle-agent-error outputs error header with retry info", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [{
      id: "agent-1",
      name: "Test Agent",
      retry: { max_retries: 3, backoff: "fixed", initial_delay: 1, max_delay: 10 },
    }],
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "error: something broke\n");

  writeState(stateDir, "agent-1", "0");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "error" "${reportFile}" "${chainFile}" "/dev/null"
  `);

  assert(result.stdout.includes("error detected in agent agent-1"), `expected error header, got: ${result.stdout}`);
  assert(result.stdout.includes("retry: 0 / 3"), `expected retry info, got: ${result.stdout}`);
});

test("handle-agent-error schedules retry when under max_retries", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [{
      id: "agent-1",
      retry: { max_retries: 2, backoff: "fixed", initial_delay: 1, max_delay: 10 },
    }],
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "error: transient failure\n");
  writeState(stateDir, "agent-1", "0");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "error" "${reportFile}" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  assert(result.status === 0, `expected exit 0 (retry scheduled), got ${result.status}`);
  assert(result.stdout.includes("scheduling retry"), `expected "scheduling retry", got: ${result.stdout}`);

  // verify retry count was incremented
  const stateContents = readFileSync(statePath(stateDir, "agent-1"), "utf-8");
  assert(stateContents.includes("retry_attempt: 1"), `expected retry_attempt: 1, got: ${stateContents}`);
});

test("handle-agent-error routes to on_error handler when max retries reached", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [
      {
        id: "agent-1",
        retry: { max_retries: 1, backoff: "fixed", initial_delay: 1, max_delay: 10 },
        on_error: "error-handler-agent",
      },
      { id: "error-handler-agent" },
    ],
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "fatal: unrecoverable\n");
  writeState(stateDir, "agent-1", "1");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "error" "${reportFile}" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  assert(result.status === 0, `expected exit 0 (handler dispatched), got ${result.status}`);
  assert(result.stdout.includes("max retries reached"), `expected "max retries reached", got: ${result.stdout}`);
  assert(result.stdout.includes("error-handler-agent"), `expected handler agent name, got: ${result.stdout}`);

  // verify state was marked failed
  const stateContents = readFileSync(statePath(stateDir, "agent-1"), "utf-8");
  assert(stateContents.includes("status: failed"), `expected "status: failed", got: ${stateContents}`);
  assert(stateContents.includes("failed_reason: error"), `expected "failed_reason: error", got: ${stateContents}`);
});

test("handle-agent-error returns 1 when no handler configured and retries exhausted", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [{
      id: "agent-1",
      retry: { max_retries: 1, backoff: "fixed", initial_delay: 1, max_delay: 10 },
    }],
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "error: total failure\n");
  writeState(stateDir, "agent-1", "1");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "error" "${reportFile}" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  assert(result.stdout.includes("no error handler configured"), `expected "no error handler configured", got: ${result.stdout}`);
  // check exit code from the last line
  const lines = result.stdout.split("\n");
  const lastLine = lines[lines.length - 1];
  assert(lastLine === "EXIT:1", `expected "EXIT:1", got "${lastLine}"`);
});

test("handle-agent-error uses on_timeout for timeout error type", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [
      {
        id: "agent-1",
        retry: { max_retries: 1, backoff: "fixed", initial_delay: 1, max_delay: 10 },
        on_error: "generic-handler",
        on_timeout: "timeout-handler",
      },
      { id: "timeout-handler" },
    ],
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "timeout: operation exceeded limit\n");
  writeState(stateDir, "agent-1", "1");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "timeout" "${reportFile}" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  assert(result.stdout.includes("timeout detected in agent agent-1"), `expected timeout header, got: ${result.stdout}`);
  assert(result.stdout.includes("timeout-handler"), `expected timeout handler name, got: ${result.stdout}`);
});

test("handle-agent-error falls back to on_error when on_timeout not set", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [
      {
        id: "agent-1",
        retry: { max_retries: 0, backoff: "fixed", initial_delay: 1, max_delay: 10 },
        on_error: "fallback-handler",
      },
      { id: "fallback-handler" },
    ],
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "timeout: deadline exceeded\n");
  writeState(stateDir, "agent-1", "0");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "timeout" "${reportFile}" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  assert(result.stdout.includes("fallback-handler"), `expected fallback handler name, got: ${result.stdout}`);
});

test("handle-agent-error uses chain-level default error handler", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [{
      id: "agent-1",
      retry: { max_retries: 0, backoff: "fixed", initial_delay: 1, max_delay: 10 },
    }],
    routing: { error_handler: "chain-error-handler" },
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "error: chain level\n");
  writeState(stateDir, "agent-1", "0");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "error" "${reportFile}" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  assert(result.stdout.includes("chain-error-handler"), `expected chain-level handler name, got: ${result.stdout}`);
});

test("handle-agent-error handles missing report file gracefully", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [{
      id: "agent-1",
      retry: { max_retries: 2, backoff: "fixed", initial_delay: 1, max_delay: 10 },
    }],
  }));

  writeState(stateDir, "agent-1", "0");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "error" "/nonexistent/report.txt" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  assert(result.status === 0, `expected exit 0, got ${result.status}`);
  assert(result.stdout.includes("error detected in agent agent-1"), `expected error header, got: ${result.stdout}`);
});

test("handle-agent-error defaults to 0 max retries when retry config missing", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  const chainsDir = join(TMP, "chains");
  mkdirSync(chainsDir, { recursive: true });

  const chainFile = join(chainsDir, "chain.json");
  writeFileSync(chainFile, JSON.stringify({
    agents: [{ id: "agent-1" }],
  }));

  const reportFile = join(TMP, "report.txt");
  writeFileSync(reportFile, "error: no retry config\n");
  writeState(stateDir, "agent-1", "0");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    handle-agent-error "agent-1" "error" "${reportFile}" "${chainFile}" "/dev/null"
    echo "EXIT:$?"
  `);

  // max_retries defaults to 0, retry_count is 0, so 0 < 0 is false -> no retry
  // no handler configured -> chain stops (return 1)
  assert(result.stdout.includes("no error handler configured"), `expected "no error handler configured", got: ${result.stdout}`);
  const lines = result.stdout.split("\n");
  const lastLine = lines[lines.length - 1];
  assert(lastLine === "EXIT:1", `expected "EXIT:1", got "${lastLine}"`);
});

// ============================================================
// edge cases
// ============================================================

test("detect-agent-error returns 1 for file with mixed error/no-error lines", () => {
  resetTmp();
  const file = join(TMP, "mixed-report.txt");
  writeFileSync(file, "task started\ncompleted step 1\nerror on step 2\nmoving on\n");
  const result = runBash(`
    source "${SCRIPT}"
    detect-agent-error "${file}"
    echo $?
  `);
  const lines = result.stdout.split("\n");
  assert(lines[lines.length - 1] === "1", `expected "1", got "${lines[lines.length - 1]}"`);
});

test("calculate-retry-delay linear capped by max_delay", () => {
  // attempt 50, initial 10, linear: 10 * 51 = 510, capped at 200
  const result = runBash(`
    source "${SCRIPT}"
    calculate-retry-delay 50 linear 10 200 2.0
  `);
  assert(result.stdout === "200", `expected "200", got "${result.stdout}"`);
});

test("typed state key normalizes a dash-containing session prefix", () => {
  resetTmp();
  const stateDir = join(TMP, "state");
  mkdirSync(stateDir, { recursive: true });
  writeState(stateDir, "my-cool-agent", "5");

  const result = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    get-agent-retry-count "my-cool-agent"
  `);
  assert(result.stdout === "5", `expected "5", got "${result.stdout}"`);

  // The historical normalized spelling resolves the same TypeScript-owned key.
  const result2 = runBash(`
    source "${SCRIPT}"
    STATE_DIR="${stateDir}"
    get-agent-retry-count "my_cool_agent"
  `);
  assert(result2.stdout === "5", `expected "5", got "${result2.stdout}"`);
});

// ============================================================
// run
// ============================================================

resetTmp();
runTests().then(() => {
  rmSync(TMP, { recursive: true, force: true });
});
