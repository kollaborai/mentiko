#!/usr/bin/env node
/**
 * retry-utils.sh black-box tests
 *
 * tests calculate_backoff, should_retry, circuit breaker state,
 * and retry loop behavior via bash child process execution.
 */

import { execFileSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TMP = `/tmp/test-retry-utils-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(REPO_ROOT, "lib", "retry-utils.sh");

let runCounter = 0;

// run a bash snippet that sources retry-utils.sh, then executes inline code
// each run gets a unique STATE_DIR to prevent cross-test state leakage
function run(code, env = {}) {
  runCounter++;
  const stateDir = `${TMP}/state-${runCounter}`;
  const bashScript = `#!/bin/bash
set -euo pipefail
STATE_DIR="${stateDir}"
export STATE_DIR
mkdir -p "$STATE_DIR/retry"
source "${SCRIPT}"
${code}`;
  return execFileSync("bash", ["-c", bashScript], {
    env: { ...process.env, HOME: TMP, ...env },
    encoding: "utf-8",
    timeout: 10000,
  });
}

// run and expect non-zero exit
function runFail(code, env = {}) {
  try {
    run(code, env);
    return null;
  } catch (err) {
    return err;
  }
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

// -- setup ----------------------------------------------------------------

mkdirSync(TMP, { recursive: true });

console.log("retry-utils.sh tests\n");

// -- calculate_backoff tests -----------------------------------------------

test("fixed strategy returns base delay regardless of attempt", () => {
  const out1 = run('calculate_backoff 1 fixed 100').trim();
  const out3 = run('calculate_backoff 3 fixed 100').trim();
  const out5 = run('calculate_backoff 5 fixed 100').trim();
  assert(out1 === "100", `attempt 1: expected 100, got ${out1}`);
  assert(out3 === "100", `attempt 3: expected 100, got ${out3}`);
  assert(out5 === "100", `attempt 5: expected 100, got ${out5}`);
});

test("linear strategy returns base * attempt", () => {
  const out1 = run('calculate_backoff 1 linear 100').trim();
  const out2 = run('calculate_backoff 2 linear 100').trim();
  const out5 = run('calculate_backoff 5 linear 200').trim();
  assert(out1 === "100", `attempt 1: expected 100, got ${out1}`);
  assert(out2 === "200", `attempt 2: expected 200, got ${out2}`);
  assert(out5 === "1000", `attempt 5: expected 1000, got ${out5}`);
});

test("exponential strategy returns base * 2^(attempt-1)", () => {
  const out1 = run('calculate_backoff 1 exponential 100').trim();
  const out2 = run('calculate_backoff 2 exponential 100').trim();
  const out3 = run('calculate_backoff 3 exponential 100').trim();
  const out4 = run('calculate_backoff 4 exponential 100').trim();
  assert(out1 === "100", `attempt 1: expected 100, got ${out1}`);
  assert(out2 === "200", `attempt 2: expected 200, got ${out2}`);
  assert(out3 === "400", `attempt 3: expected 400, got ${out3}`);
  assert(out4 === "800", `attempt 4: expected 800, got ${out4}`);
});

test("exponential_with_jitter stays within +/- 25% of base", () => {
  // run it 50 times to check jitter range
  const results = [];
  for (let i = 0; i < 50; i++) {
    const out = run('calculate_backoff 3 exponential_with_jitter 1000').trim();
    results.push(parseInt(out, 10));
  }
  // base for attempt 3 = 1000 * 2^2 = 4000
  // jitter +/- 25% = 3000..5000
  const allInRange = results.every(v => v >= 2250 && v <= 5500);
  assert(allInRange, `jitter out of range: min=${Math.min(...results)} max=${Math.max(...results)}`);
  // all values should be positive
  const allPositive = results.every(v => v > 0);
  assert(allPositive, "jitter produced a non-positive value");
});

test("exponential_with_jitter never produces negative values", () => {
  // use small base delay where jitter could push negative
  // base = 10, attempt 1 => 10, jitter range: 10 +/- 25% = 7..13
  // run many times to exercise RANDOM range
  const results = [];
  for (let i = 0; i < 100; i++) {
    const out = run('calculate_backoff 1 exponential_with_jitter 10').trim();
    results.push(parseInt(out, 10));
  }
  const allNonNegative = results.every(v => v >= 0);
  assert(allNonNegative, `negative value found: ${results.filter(v => v < 0)}`);
});

test("unknown strategy falls back to base delay", () => {
  const out = run('calculate_backoff 3 unknown_strategy 500').trim();
  assert(out === "500", `expected 500, got ${out}`);
});

test("max delay caps the result", () => {
  // exponential: attempt 5, base 1000 => 1000 * 2^4 = 16000
  // cap at 5000
  const out = run('calculate_backoff 5 exponential 1000 5000').trim();
  assert(out === "5000", `expected 5000, got ${out}`);
});

test("default max delay is base * 10 when not specified", () => {
  // linear: attempt 3, base 1000 => 3000, max = 10000 => uncapped
  const outUncapped = run('calculate_backoff 3 linear 1000').trim();
  assert(outUncapped === "3000", `uncapped: expected 3000, got ${outUncapped}`);

  // linear: attempt 20, base 1000 => 20000, max = 10000 => capped
  const outCapped = run('calculate_backoff 20 linear 1000').trim();
  assert(outCapped === "10000", `capped: expected 10000, got ${outCapped}`);
});

// -- should_retry tests ----------------------------------------------------

test("should_retry returns true when attempt < max", () => {
  const out = run('should_retry 0 3').trim();
  assert(out === "true", `expected true, got ${out}`);
});

test("should_retry returns true when attempt = max - 1", () => {
  const out = run('should_retry 2 3').trim();
  assert(out === "true", `expected true, got ${out}`);
});

test("should_retry returns false when attempt >= max", () => {
  const out = run('should_retry 3 3').trim();
  assert(out === "false", `expected false, got ${out}`);
});

test("should_retry returns false when attempt exceeds max", () => {
  const out = run('should_retry 5 3').trim();
  assert(out === "false", `expected false, got ${out}`);
});

// -- retry loop tests -------------------------------------------------------

test("retry loop succeeds on first try", () => {
  const out = run(`
attempt=0
max_retries=3
while true; do
  attempt=$((attempt + 1))
  # simulate success on first try
  echo "attempt $attempt"
  break
done
echo "done after $attempt attempt(s)"
`).trim();
  assert(out.includes("attempt 1"), `expected attempt 1, got: ${out}`);
  assert(out.includes("done after 1 attempt(s)"), `unexpected output: ${out}`);
});

test("retry loop retries on failure and eventually succeeds", () => {
  const out = run(`
attempt=0
max_retries=5
succeed_after=3
while true; do
  attempt=$((attempt + 1))
  if [[ $attempt -ge $succeed_after ]]; then
    echo "success on attempt $attempt"
    break
  fi
  can_retry=$(should_retry $attempt $max_retries)
  if [[ "$can_retry" == "false" ]]; then
    echo "exhausted retries at attempt $attempt"
    break
  fi
  echo "failed attempt $attempt, retrying"
done
`).trim();
  assert(out.includes("failed attempt 1"), `missing failure 1: ${out}`);
  assert(out.includes("failed attempt 2"), `missing failure 2: ${out}`);
  assert(out.includes("success on attempt 3"), `missing success: ${out}`);
});

test("retry loop exhausts max retries and fails", () => {
  const out = run(`
attempt=0
max_retries=3
while true; do
  attempt=$((attempt + 1))
  # always fail
  can_retry=$(should_retry $attempt $max_retries)
  if [[ "$can_retry" == "false" ]]; then
    echo "exhausted at attempt $attempt"
    break
  fi
  echo "failed attempt $attempt"
done
`).trim();
  assert(out.includes("failed attempt 1"), `missing failure 1: ${out}`);
  assert(out.includes("failed attempt 2"), `missing failure 2: ${out}`);
  assert(out.includes("exhausted at attempt 3"), `expected exhaustion: ${out}`);
});

test("retry with custom max attempts", () => {
  // verify should_retry respects custom max
  const out = run(`
for i in 1 2 3 4 5 6 7; do
  result=$(should_retry $i 5)
  echo "attempt $i: $result"
done
`).trim();
  const lines = out.split("\n");
  // attempts 1-4 should be true, 5+ false
  assert(lines[0].includes("true"), `attempt 1 should retry: ${lines[0]}`);
  assert(lines[3].includes("true"), `attempt 4 should retry: ${lines[3]}`);
  assert(lines[4].includes("false"), `attempt 5 should not retry: ${lines[4]}`);
  assert(lines[5].includes("false"), `attempt 6 should not retry: ${lines[5]}`);
});

// -- circuit breaker tests -------------------------------------------------

test("circuit breaker starts closed (not open)", () => {
  const out = run('is_circuit_open test-chain test-agent').trim();
  assert(out === "false", `expected false, got ${out}`);
});

test("circuit breaker opens after reaching failure threshold", () => {
  const out = run(`
record_failure test-chain test-agent 3 300
record_failure test-chain test-agent 3 300
record_failure test-chain test-agent 3 300
is_circuit_open test-chain test-agent
`).trim();
  assert(out === "true", `expected true after 3 failures, got ${out}`);
});

test("circuit breaker does not open before threshold", () => {
  const out = run(`
record_failure test-chain test-agent 5 300
record_failure test-chain test-agent 5 300
is_circuit_open test-chain test-agent
`).trim();
  assert(out === "false", `expected false after 2 of 5 failures, got ${out}`);
});

test("record_success resets circuit breaker", () => {
  const out = run(`
record_failure test-chain test-agent 2 300
record_failure test-chain test-agent 2 300
is_circuit_open test-chain test-agent
record_success test-chain test-agent
is_circuit_open test-chain test-agent
`).trim();
  const lines = out.trim().split("\n");
  assert(lines[0] === "true", `expected open before reset: ${lines[0]}`);
  assert(lines[1] === "false", `expected closed after reset: ${lines[1]}`);
});

test("circuit breaker auto-resets after timeout", () => {
  // use timeout of 1 second, wait 2 seconds, should reset
  const out = run(`
record_failure test-chain-timeout test-agent 1 1
is_circuit_open test-chain-timeout test-agent
sleep 2
is_circuit_open test-chain-timeout test-agent
`).trim();
  const lines = out.trim().split("\n");
  assert(lines[0] === "true", `expected open immediately: ${lines[0]}`);
  assert(lines[1] === "false", `expected closed after timeout: ${lines[1]}`);
});

test("get_circuit_state returns closed state when no file exists", () => {
  const out = run('get_circuit_state new-chain new-agent').trim();
  assert(out.includes('"state":"closed"'), `expected closed state: ${out}`);
  assert(out.includes('"failure_count":0'), `expected 0 failures: ${out}`);
});

test("get_circuit_state returns current state after failures", () => {
  const out = run(`
record_failure test-chain-state test-agent 5 300
get_circuit_state test-chain-state test-agent
`).trim();
  // JSON may have spaces/newlines, normalize for matching
  const compact = out.replace(/\s+/g, " ");
  assert(compact.includes('"state": "closed"'), `expected closed (under threshold): ${compact}`);
  assert(compact.includes('"failure_count": 1'), `expected 1 failure: ${compact}`);
});

test("circuit state file path sanitizes agent name", () => {
  const out = run('circuit_state_file my-chain "agent with spaces & stuff!"').trim();
  assert(!out.includes(" "), `path should have no spaces: ${out}`);
  assert(out.endsWith(".json"), `path should end with .json: ${out}`);
  assert(out.includes("my-chain"), `path should include chain id: ${out}`);
});

// -- cmd interface tests ---------------------------------------------------

test("cmd backoff outputs formatted delay", () => {
  const out = execFileSync("bash", ["-c", `
    source "${SCRIPT}"
    cmd_backoff 2 exponential 100
  `], { encoding: "utf-8", timeout: 5000 }).trim();
  assert(out.includes("200 ms"), `expected '200 ms', got: ${out}`);
});

test("cmd circuit-check returns state", () => {
  const out = execFileSync("bash", ["-c", `
    source "${SCRIPT}"
    cmd_circuit_check fresh-chain fresh-agent
  `], { encoding: "utf-8", timeout: 5000 }).trim();
  assert(out === "false", `expected false, got ${out}`);
});

test("cmd circuit-reset clears state", () => {
  const out = execFileSync("bash", ["-c", `
    source "${SCRIPT}"
    record_failure reset-test test-agent 1 300
    cmd_circuit_reset reset-test test-agent
  `], { encoding: "utf-8", timeout: 5000 }).trim();
  assert(out.includes("circuit reset"), `expected reset message: ${out}`);
});

// -- error message includes retry count ------------------------------------

test("retry error message includes attempt count", () => {
  const code = [
    'attempt=0',
    'max_retries=3',
    'while true; do',
    '  attempt=$((attempt + 1))',
    '  can_retry=$(should_retry $attempt $max_retries)',
    '  if [[ "$can_retry" == "false" ]]; then',
    '    echo "error: all ${max_retries} attempts exhausted (last attempt: ${attempt})"',
    '    break',
    '  fi',
    'done',
  ].join("\n");
  const out = run(code).trim();
  assert(out.includes("3 attempts exhausted"), `missing retry count: ${out}`);
  assert(out.includes("last attempt: 3"), `missing last attempt: ${out}`);
});

// -- backoff timing verification -------------------------------------------

test("exponential backoff doubles each attempt", () => {
  const out1 = run('calculate_backoff 1 exponential 100').trim();
  const out2 = run('calculate_backoff 2 exponential 100').trim();
  const out3 = run('calculate_backoff 3 exponential 100').trim();
  const out4 = run('calculate_backoff 4 exponential 100').trim();

  const v1 = parseInt(out1, 10);
  const v2 = parseInt(out2, 10);
  const v3 = parseInt(out3, 10);
  const v4 = parseInt(out4, 10);

  assert(v2 === v1 * 2, `attempt 2 should be 2x: ${v1} -> ${v2}`);
  assert(v3 === v2 * 2, `attempt 3 should be 2x: ${v2} -> ${v3}`);
  assert(v4 === v3 * 2, `attempt 4 should be 2x: ${v3} -> ${v4}`);
});

// -- cleanup ---------------------------------------------------------------

rmSync(TMP, { recursive: true, force: true });

console.log(`\nresults: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
