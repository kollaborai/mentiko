#!/usr/bin/env node
/**
 * lib/profiler.sh tests
 *
 * Tests the profiler's core logic:
 * - profiler-start creates JSON profile with correct fields
 * - profiler-end sets status, calculates duration
 * - profiler-get returns json or text format
 * - profiler-list lists all profiles
 * - profiler-snapshot adds snapshot with metrics
 * - profiler-record-tokens tracks API call token usage
 * - profiler-compare compares multiple sessions
 * - profiler-aggregate aggregates stats across sessions
 * - profiler-export bundles all profiles to JSON
 * - profiler-cleanup removes old profiles
 * - profiler-format-text formats profile as readable text
 *
 * Strategy: source profiler.sh directly in a bash child process with
 * mocked transport_* and overridden PROFILER_DIR. Pre-source mocks
 * prevent crashes; post-source overrides ensure our mocks win.
 * Each test runs in isolation under a fresh TMP dir.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const TMP = `/tmp/test-profiler-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const LIB_DIR = join(REPO_ROOT, "lib");
const PROFILER_SH = join(LIB_DIR, "profiler.sh");

const tests = [];
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function test(name, fn) {
  tests.push({ name, fn });
}

async function runTests() {
  for (const t of tests) {
    try {
      const out = t.fn();
      if (out && typeof out.then === "function") await out;
      console.log(`  + ${t.name}`);
      passed += 1;
    } catch (err) {
      console.log(`  x ${t.name}`);
      console.log(`    ${err.message}`);
      if (err.stderr) console.log(`    stderr: ${err.stderr.slice(0, 500)}`);
      failed += 1;
    }
  }
}

// -- helpers --

const PROFILER_DIR = join(TMP, "profiling");

function resetTmp() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(PROFILER_DIR, { recursive: true });
}

/**
 * Runs a bash snippet in a child process with mocked transport/syslog.
 *
 * Key design:
 *   - mocks defined BEFORE sourcing (to prevent crashes in transport)
 *   - source profiler.sh directly (profiler-start uses heredoc, sed breaks)
 *   - mocks RE-defined AFTER sourcing (our mocks win over real impls)
 *   - PROFILER_DIR overridden to TMP/profiling before AND after source
 */
function runBash(body, extraEnv = {}) {
  const script = [
    'set -uo pipefail',
    '',
    // -- pre-source stubs (prevent crashes in session-transport.sh) --
    'transport_has_session() { return 1; }',
    'transport_pid() { echo ""; }',
    'transport_session_exists() { return 1; }',
    'transport_kill_session() { :; }',
    'transport_list_sessions() { echo ""; }',
    'transport_new_session() { :; }',
    'transport_send_keys() { :; }',
    'transport_send_raw() { :; }',
    'transport_capture() { echo ""; }',
    'transport_init() { :; }',
    '_sys_log() { :; }',
    'run_hooks() { :; }',
    '',
    // -- config vars --
    `export MENTIKO_GLOBAL_ROOT="${TMP}"`,
    `export MENTIKO_CODE_ROOT="${REPO_ROOT}"`,
    `export MENTIKO_NAMESPACE_ROOT="${TMP}/namespaces/default"`,
    `export MENTIKO_ORG_ROOT="${TMP}/namespaces/default"`,
    `export MENTIKO_PROJECT_ROOT="${TMP}/namespaces/default"`,
    `export NAMESPACE_ID="default"`,
    `export ORG_ID="default"`,
    `export PROFILES_DIR="${PROFILER_DIR}"`,
    `export PROFILER_DIR="${PROFILER_DIR}"`,
    `mkdir -p "${PROFILER_DIR}"`,
    '',
    // -- source profiler.sh directly --
    // profiler-start has a heredoc so sed extraction breaks it
    // sourcing is safe because our pre-stubs prevent transport crashes
    // redirect stdout to /dev/null to suppress "session-transport: loaded" msg
    `source "${PROFILER_SH}" >/dev/null`,
    '',
    // -- RE-override after sourcing --
    // config.sh may have changed PROFILER_DIR, so force it back
    `PROFILER_DIR="${PROFILER_DIR}"`,
    '',
    // re-stub transport (profiler.sh sources session-transport.sh)
    'transport_has_session() { return 1; }',
    'transport_pid() { echo ""; }',
    '_sys_log() { :; }',
    '',
    // -- test body --
    body,
  ].join('\n');

  try {
    const result = execFileSync("bash", ["-c", script], {
      encoding: "utf-8",
      timeout: 8000,
      env: {
        ...process.env,
        HOME: process.env.HOME || "/tmp",
        ...extraEnv,
      },
    });
    return { stdout: result, stderr: "", status: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      status: err.status || 1,
    };
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

function readFileLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
}

// -- tests --

test("profiler-start creates profile file with correct fields", () => {
  resetTmp();

  const result = runBash([
    'profiler-start sess-001 agent-001 "Test Agent" run-100',
    'echo "done"',
  ].join('\n'));

  assert(result.status === 0, `should succeed: status=${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert(result.stdout.includes("done"), `should complete: ${result.stdout}`);

  const profileFile = join(PROFILER_DIR, "sess-001.json");
  assert(existsSync(profileFile), `profile file should exist: ${profileFile}`);

  const profile = readJson(profileFile);
  assert(profile.session === "sess-001", `session should be sess-001: ${profile.session}`);
  assert(profile.agent_id === "agent-001", `agent_id should be agent-001: ${profile.agent_id}`);
  assert(profile.agent_name === "Test Agent", `agent_name should be Test Agent: ${profile.agent_name}`);
  assert(profile.run_id === "run-100", `run_id should be run-100: ${profile.run_id}`);
  assert(profile.status === "running", `status should be running: ${profile.status}`);
  assert(profile.started_at != null, `started_at should be set: ${profile.started_at}`);
  assert(typeof profile.start_epoch === "number", `start_epoch should be a number: ${profile.start_epoch}`);
  assert(Array.isArray(profile.snapshots), `snapshots should be an array`);
  assert(Array.isArray(profile.api_calls), `api_calls should be an array`);
  assert(profile.tokens.total_input === 0, `tokens.total_input should be 0`);
  assert(profile.tokens.total_output === 0, `tokens.total_output should be 0`);
  assert(profile.tokens.total === 0, `tokens.total should be 0`);
});

test("profiler-start returns profile file path", () => {
  resetTmp();

  const result = runBash('profiler-start sess-002 agent-002 "Agent Two"');
  const returnedPath = result.stdout.trim();
  const expected = join(PROFILER_DIR, "sess-002.json");
  assert(returnedPath === expected, `should return path: got ${returnedPath}, expected ${expected}`);
});

test("profiler-start uses agent_id as default agent_name", () => {
  resetTmp();

  runBash('profiler-start sess-003 agent-003');
  const profile = readJson(join(PROFILER_DIR, "sess-003.json"));
  assert(profile.agent_name === "agent-003", `agent_name should default to agent_id: ${profile.agent_name}`);
});

test("profiler-start with no run_id sets empty string", () => {
  resetTmp();

  runBash('profiler-start sess-004 agent-004 "Named"');
  const profile = readJson(join(PROFILER_DIR, "sess-004.json"));
  assert(profile.run_id === "", `run_id should be empty: ${profile.run_id}`);
});

test("profiler-start sets started_at as ISO format", () => {
  resetTmp();

  runBash('profiler-start sess-005 agent-005 "Timestamp"');
  const profile = readJson(join(PROFILER_DIR, "sess-005.json"));
  assert(profile.started_at != null, `started_at should be set`);
  assert(profile.started_at.includes("T"), `started_at should be ISO format: ${profile.started_at}`);
});

test("profiler-start sets start_epoch as positive integer", () => {
  resetTmp();

  runBash('profiler-start sess-006 agent-006 "Epoch"');
  const profile = readJson(join(PROFILER_DIR, "sess-006.json"));
  assert(Number.isInteger(profile.start_epoch), `start_epoch should be integer: ${profile.start_epoch}`);
  assert(profile.start_epoch > 0, `start_epoch should be positive: ${profile.start_epoch}`);
});

test("profiler-end sets status and calculates duration", () => {
  resetTmp();

  const result = runBash([
    'profiler-start sess-010 agent-010 "Duration Agent"',
    'profiler-end sess-010 complete',
    'echo "done"',
  ].join('\n'));

  assert(result.status === 0, `should succeed: status=${result.status}\nstderr: ${result.stderr}`);
  assert(result.stdout.includes("done"), `should complete: ${result.stdout}`);

  const profile = readJson(join(PROFILER_DIR, "sess-010.json"));
  assert(profile.status === "complete", `status should be complete: ${profile.status}`);
  assert(profile.ended_at != null, `ended_at should be set: ${profile.ended_at}`);
  assert(profile.end_epoch != null, `end_epoch should be set`);
  assert(typeof profile.duration_ms === "number", `duration_ms should be a number: ${profile.duration_ms}`);
  assert(profile.duration_ms >= 0, `duration_ms should be non-negative: ${profile.duration_ms}`);
  assert(profile.final_snapshot != null, `final_snapshot should be set`);
});

test("profiler-end returns profile file path", () => {
  resetTmp();

  const result = runBash([
    'profiler-start sess-011 agent-011 "Return Agent"',
    'profiler-end sess-011 complete',
  ].join('\n'));

  // stdout has two lines: start path and end path
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const endPath = lines[lines.length - 1];
  const expected = join(PROFILER_DIR, "sess-011.json");
  assert(endPath === expected, `should return path: got ${endPath}, expected ${expected}`);
});

test("profiler-end with error message sets error field", () => {
  resetTmp();

  runBash([
    'profiler-start sess-012 agent-012 "Error Agent"',
    'profiler-end sess-012 failed "out of memory"',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-012.json"));
  assert(profile.status === "failed", `status should be failed: ${profile.status}`);
  assert(profile.error === "out of memory", `error should be set: ${profile.error}`);
});

test("profiler-end without error message omits error field", () => {
  resetTmp();

  runBash([
    'profiler-start sess-012b agent-012b "NoErr Agent"',
    'profiler-end sess-012b complete',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-012b.json"));
  assert(profile.error === undefined, `error should be omitted: ${profile.error}`);
});

test("profiler-end defaults status to complete", () => {
  resetTmp();

  runBash([
    'profiler-start sess-013 agent-013 "Default Status"',
    'profiler-end sess-013',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-013.json"));
  assert(profile.status === "complete", `status should default to complete: ${profile.status}`);
});

test("profiler-end on non-existent profile returns 1", () => {
  resetTmp();

  const result = runBash('profiler-end nonexistent-session complete; echo "exit=$?"');
  assert(result.stdout.includes("exit=1"), `should fail for non-existent profile: ${result.stdout}`);
});

test("profiler-end stores final_snapshot with peak memory and avg cpu", () => {
  resetTmp();

  runBash([
    'profiler-start sess-400 agent-400 "Snapshot Agent"',
    'profiler-snapshot sess-400 "t1"',
    'profiler-end sess-400 complete',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-400.json"));
  assert(profile.final_snapshot != null, `final_snapshot should exist`);
  assert(profile.final_snapshot.timestamp != null, `final_snapshot timestamp should be set`);
  assert(typeof profile.final_snapshot.memory_mb === "number", `final_snapshot memory_mb should be number`);
  assert(typeof profile.final_snapshot.cpu_pct === "number", `final_snapshot cpu_pct should be number`);
});

test("profiler-get returns JSON by default", () => {
  resetTmp();

  runBash('profiler-start sess-020 agent-020 "Get Agent"');
  const result = runBash('profiler-get sess-020');

  assert(result.status === 0, `should succeed: status=${result.status}\nstderr: ${result.stderr}`);
  const profile = JSON.parse(result.stdout);
  assert(profile.session === "sess-020", `session should match: ${profile.session}`);
  assert(profile.agent_name === "Get Agent", `agent_name should match: ${profile.agent_name}`);
});

test("profiler-get returns text format when requested", () => {
  resetTmp();

  runBash([
    'profiler-start sess-021 agent-021 "Text Agent"',
    'profiler-end sess-021 complete',
  ].join('\n'));

  const result = runBash('profiler-get sess-021 text');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("profile:"), `should contain profile label: ${result.stdout}`);
  assert(result.stdout.includes("sess-021"), `should contain session: ${result.stdout}`);
  assert(result.stdout.includes("Text Agent"), `should contain agent name: ${result.stdout}`);
  assert(result.stdout.includes("status:"), `should contain status label: ${result.stdout}`);
  assert(result.stdout.includes("duration:"), `should contain duration label: ${result.stdout}`);
  assert(result.stdout.includes("tokens:"), `should contain tokens label: ${result.stdout}`);
});

test("profiler-get returns error for non-existent session", () => {
  resetTmp();

  const result = runBash('profiler-get nonexistent-session; echo "exit=$?"');
  assert(result.stdout.includes("exit=1"), `should fail: ${result.stdout}`);
  assert(result.stdout.includes("profile not found"), `should report not found: ${result.stdout}`);
});

test("profiler-record-tokens tracks API call and updates totals", () => {
  resetTmp();

  runBash([
    'profiler-start sess-030 agent-030 "Token Agent"',
    'profiler-record-tokens sess-030 gpt-4 100 50 1200',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-030.json"));
  assert(profile.tokens.total_input === 100, `total_input should be 100: ${profile.tokens.total_input}`);
  assert(profile.tokens.total_output === 50, `total_output should be 50: ${profile.tokens.total_output}`);
  assert(profile.tokens.total === 150, `total should be 150: ${profile.tokens.total}`);
  assert(profile.api_calls.length === 1, `should have 1 api call: ${profile.api_calls.length}`);

  const call = profile.api_calls[0];
  assert(call.model === "gpt-4", `model should be gpt-4: ${call.model}`);
  assert(call.input_tokens === 100, `input_tokens should be 100: ${call.input_tokens}`);
  assert(call.output_tokens === 50, `output_tokens should be 50: ${call.output_tokens}`);
  assert(call.total_tokens === 150, `total_tokens should be 150: ${call.total_tokens}`);
  assert(call.duration_ms === 1200, `duration_ms should be 1200: ${call.duration_ms}`);
});

test("profiler-record-tokens tracks by_model breakdown", () => {
  resetTmp();

  runBash([
    'profiler-start sess-031 agent-031 "Model Agent"',
    'profiler-record-tokens sess-031 gpt-4 100 50',
    'profiler-record-tokens sess-031 gpt-4 200 80',
    'profiler-record-tokens sess-031 claude-3 300 60',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-031.json"));
  assert(profile.tokens.total === 790, `total should be 790: ${profile.tokens.total}`);
  assert(profile.tokens.by_model["gpt-4"].input === 300, `gpt-4 input should be 300: ${profile.tokens.by_model["gpt-4"].input}`);
  assert(profile.tokens.by_model["gpt-4"].output === 130, `gpt-4 output should be 130: ${profile.tokens.by_model["gpt-4"].output}`);
  assert(profile.tokens.by_model["gpt-4"].total === 430, `gpt-4 total should be 430: ${profile.tokens.by_model["gpt-4"].total}`);
  assert(profile.tokens.by_model["claude-3"].total === 360, `claude-3 total should be 360: ${profile.tokens.by_model["claude-3"].total}`);
  assert(profile.api_calls.length === 3, `should have 3 api calls: ${profile.api_calls.length}`);
});

test("profiler-record-tokens on non-existent profile returns 1", () => {
  resetTmp();

  const result = runBash('profiler-record-tokens nonexistent gpt-4 100 50; echo "exit=$?"');
  assert(result.stdout.includes("exit=1"), `should fail: ${result.stdout}`);
});

test("profiler-record-tokens with no duration defaults to 0", () => {
  resetTmp();

  runBash([
    'profiler-start sess-032 agent-032 "NoDur Agent"',
    'profiler-record-tokens sess-032 gpt-4 100 50',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-032.json"));
  assert(profile.api_calls[0].duration_ms === 0, `duration_ms should be 0: ${profile.api_calls[0].duration_ms}`);
});

test("profiler-record-tokens accumulates same model across calls", () => {
  resetTmp();

  runBash([
    'profiler-start sess-033 agent-033 "Accum Agent"',
    'profiler-record-tokens sess-033 gpt-4 100 50',
    'profiler-record-tokens sess-033 gpt-4 200 80',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-033.json"));
  assert(profile.tokens.by_model["gpt-4"].input === 300, `same model input accumulates: ${profile.tokens.by_model["gpt-4"].input}`);
  assert(profile.tokens.by_model["gpt-4"].output === 130, `same model output accumulates: ${profile.tokens.by_model["gpt-4"].output}`);
  assert(profile.tokens.by_model["gpt-4"].total === 430, `same model total accumulates: ${profile.tokens.by_model["gpt-4"].total}`);
});

test("profiler-snapshot adds snapshot with label", () => {
  resetTmp();

  // transport_has_session returns false, so pid will be empty
  // snapshot will have mem=0, cpu=0
  runBash([
    'profiler-start sess-040 agent-040 "Snap Agent"',
    'profiler-snapshot sess-040 "after-init"',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-040.json"));
  assert(profile.snapshots.length === 1, `should have 1 snapshot: ${profile.snapshots.length}`);
  assert(profile.snapshots[0].label === "after-init", `label should be after-init: ${profile.snapshots[0].label}`);
  assert(profile.snapshots[0].memory_mb === 0, `memory_mb should be 0 (no pid): ${profile.snapshots[0].memory_mb}`);
  assert(profile.snapshots[0].cpu_pct === 0, `cpu_pct should be 0 (no pid): ${profile.snapshots[0].cpu_pct}`);
  assert(profile.snapshots[0].timestamp != null, `timestamp should be set`);
  assert(profile.memory_samples.length === 1, `memory_samples should have 1 entry`);
  assert(profile.cpu_samples.length === 1, `cpu_samples should have 1 entry`);
});

test("profiler-snapshot default label is 'snapshot'", () => {
  resetTmp();

  runBash([
    'profiler-start sess-041 agent-041 "Default Label"',
    'profiler-snapshot sess-041',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-041.json"));
  assert(profile.snapshots[0].label === "snapshot", `label should default to snapshot: ${profile.snapshots[0].label}`);
});

test("profiler-snapshot accumulates multiple snapshots", () => {
  resetTmp();

  runBash([
    'profiler-start sess-042 agent-042 "Multi Snap"',
    'profiler-snapshot sess-042 "first"',
    'profiler-snapshot sess-042 "second"',
    'profiler-snapshot sess-042 "third"',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "sess-042.json"));
  assert(profile.snapshots.length === 3, `should have 3 snapshots: ${profile.snapshots.length}`);
  assert(profile.snapshots[0].label === "first", `first label: ${profile.snapshots[0].label}`);
  assert(profile.snapshots[1].label === "second", `second label: ${profile.snapshots[1].label}`);
  assert(profile.snapshots[2].label === "third", `third label: ${profile.snapshots[2].label}`);
  assert(profile.memory_samples.length === 3, `should have 3 memory samples`);
  assert(profile.cpu_samples.length === 3, `should have 3 cpu samples`);
});

test("profiler-snapshot on non-existent profile returns 1", () => {
  resetTmp();

  const result = runBash('profiler-snapshot nonexistent "test"; echo "exit=$?"');
  assert(result.stdout.includes("exit=1"), `should fail: ${result.stdout}`);
});

test("profiler-list lists all profiles in short format", () => {
  resetTmp();

  runBash([
    'profiler-start sess-050 agent-050 "List Agent A"',
    'profiler-end sess-050 complete',
    'profiler-start sess-051 agent-051 "List Agent B"',
    'profiler-end sess-051 failed',
  ].join('\n'));

  const result = runBash('profiler-list short');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("profiles:"), `should have header: ${result.stdout}`);
  assert(result.stdout.includes("sess-050"), `should list sess-050: ${result.stdout}`);
  assert(result.stdout.includes("sess-051"), `should list sess-051: ${result.stdout}`);
  assert(result.stdout.includes("List Agent A"), `should show agent name A: ${result.stdout}`);
  assert(result.stdout.includes("List Agent B"), `should show agent name B: ${result.stdout}`);
  assert(result.stdout.includes("complete"), `should show complete status: ${result.stdout}`);
  assert(result.stdout.includes("failed"), `should show failed status: ${result.stdout}`);
});

test("profiler-list long format shows detailed output", () => {
  resetTmp();

  runBash([
    'profiler-start sess-060 agent-060 "Long Agent"',
    'profiler-end sess-060 complete',
  ].join('\n'));

  const result = runBash('profiler-list long');
  assert(result.stdout.includes("agent:"), `should have agent label: ${result.stdout}`);
  assert(result.stdout.includes("status:"), `should have status label: ${result.stdout}`);
  assert(result.stdout.includes("duration:"), `should have duration label: ${result.stdout}`);
  assert(result.stdout.includes("tokens:"), `should have tokens label: ${result.stdout}`);
});

test("profiler-list with no profiles still shows header", () => {
  resetTmp();

  const result = runBash('profiler-list');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("profiles:"), `should have header: ${result.stdout}`);
});

test("profiler-compare shows comparison table", () => {
  resetTmp();

  runBash([
    'profiler-start sess-070 agent-070 "Compare A"',
    'profiler-record-tokens sess-070 gpt-4 500 200 1000',
    'profiler-end sess-070 complete',
    'profiler-start sess-071 agent-071 "Compare B"',
    'profiler-record-tokens sess-071 claude-3 1000 300 2000',
    'profiler-end sess-071 complete',
  ].join('\n'));

  const result = runBash('profiler-compare sess-070 sess-071');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("comparison:"), `should have header: ${result.stdout}`);
  assert(result.stdout.includes("sess-070"), `should show sess-070: ${result.stdout}`);
  assert(result.stdout.includes("sess-071"), `should show sess-071: ${result.stdout}`);
  assert(result.stdout.includes("complete"), `should show status: ${result.stdout}`);
  assert(result.stdout.includes("700"), `should show token count for A: ${result.stdout}`);
  assert(result.stdout.includes("1300"), `should show token count for B: ${result.stdout}`);
});

test("profiler-compare skips non-existent sessions", () => {
  resetTmp();

  runBash([
    'profiler-start sess-072 agent-072 "Existing"',
    'profiler-end sess-072 complete',
  ].join('\n'));

  const result = runBash('profiler-compare sess-072 nonexistent-session');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("sess-072"), `should show existing session: ${result.stdout}`);
  assert(!result.stdout.includes("nonexistent-session"), `should skip missing session: ${result.stdout}`);
});

test("profiler-aggregate with no profiles shows 0 counts", () => {
  resetTmp();

  const result = runBash('profiler-aggregate');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("aggregate stats:"), `should have header: ${result.stdout}`);
  assert(result.stdout.includes("sessions:     0"), `should show 0 sessions: ${result.stdout}`);
  assert(result.stdout.includes("total tokens: 0"), `should show 0 tokens: ${result.stdout}`);
});

test("profiler-aggregate sums across all profiles", () => {
  resetTmp();

  runBash([
    'profiler-start sess-080 agent-080 "Agg A"',
    'profiler-record-tokens sess-080 gpt-4 100 50 1000',
    'profiler-end sess-080 complete',
    'profiler-start sess-081 agent-081 "Agg B"',
    'profiler-record-tokens sess-081 gpt-4 200 100 2000',
    'profiler-end sess-081 complete',
  ].join('\n'));

  const result = runBash('profiler-aggregate');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("aggregate stats:"), `should have header: ${result.stdout}`);
  assert(result.stdout.includes("sessions:"), `should show session count: ${result.stdout}`);
  assert(result.stdout.includes("total tokens:"), `should show total tokens: ${result.stdout}`);
  assert(result.stdout.includes("total calls:"), `should show total calls: ${result.stdout}`);
  assert(result.stdout.includes("avg tokens:"), `should show avg tokens: ${result.stdout}`);
});

test("profiler-aggregate filters by run_id", () => {
  resetTmp();

  runBash([
    'profiler-start sess-090 agent-090 "Run A" run-abc',
    'profiler-record-tokens sess-090 gpt-4 100 50',
    'profiler-end sess-090 complete',
    'profiler-start sess-091 agent-091 "Run B" run-xyz',
    'profiler-record-tokens sess-091 gpt-4 200 100',
    'profiler-end sess-091 complete',
  ].join('\n'));

  const result = runBash('profiler-aggregate run-abc');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("sessions:     1"), `should show 1 session: ${result.stdout}`);
  assert(result.stdout.includes("total tokens: 150"), `should show filtered tokens: ${result.stdout}`);
});

test("profiler-aggregate shows averages when profiles exist", () => {
  resetTmp();

  runBash([
    'profiler-start agg-avg agent-1 "a"',
    'profiler-record-tokens agg-avg gpt-4 200 100',
    'profiler-end agg-avg complete',
  ].join('\n'));

  const result = runBash('profiler-aggregate');
  assert(result.stdout.includes("avg tokens:"), `should show avg tokens: ${result.stdout}`);
  assert(result.stdout.includes("avg time:"), `should show avg time: ${result.stdout}`);
});

test("profiler-export bundles all profiles into JSON", () => {
  resetTmp();

  runBash([
    'profiler-start sess-100 agent-100 "Export A"',
    'profiler-end sess-100 complete',
    'profiler-start sess-101 agent-101 "Export B"',
    'profiler-end sess-101 complete',
  ].join('\n'));

  const exportPath = join(TMP, "export.json");
  const result = runBash(`profiler-export "${exportPath}"`);
  assert(result.status === 0, `should succeed: status=${result.status}`);

  const returnedPath = result.stdout.trim().split("\n").pop();
  assert(returnedPath === exportPath, `should return export path: ${returnedPath}`);
  assert(existsSync(exportPath), `export file should exist`);

  const exported = readJson(exportPath);
  assert(Array.isArray(exported.profiles), `profiles should be an array`);
  assert(exported.profiles.length === 2, `should have 2 profiles: ${exported.profiles.length}`);
  const sessions = exported.profiles.map(p => p.session);
  assert(sessions.includes("sess-100"), `should include sess-100`);
  assert(sessions.includes("sess-101"), `should include sess-101`);
});

test("profiler-export defaults to PROFILER_DIR/export.json", () => {
  resetTmp();

  runBash([
    'profiler-start sess-102 agent-102 "Default Export"',
    'profiler-end sess-102 complete',
  ].join('\n'));

  runBash('profiler-export');
  const defaultPath = join(PROFILER_DIR, "export.json");
  assert(existsSync(defaultPath), `default export file should exist at ${defaultPath}`);
});

test("profiler-export handles empty directory", () => {
  resetTmp();

  const exportPath = join(TMP, "empty-export.json");
  runBash(`profiler-export "${exportPath}"`);
  assert(existsSync(exportPath), `export file should exist`);
  const exported = readJson(exportPath);
  assert(exported.profiles.length === 0, `should have 0 profiles: ${exported.profiles.length}`);
});

test("profiler-format-text produces readable output", () => {
  resetTmp();

  runBash([
    'profiler-start sess-110 agent-110 "Format Agent"',
    'profiler-record-tokens sess-110 gpt-4 500 200 1500',
    'profiler-end sess-110 complete',
  ].join('\n'));

  const profileFile = join(PROFILER_DIR, "sess-110.json");
  const result = runBash(`profiler-format-text "${profileFile}"`);
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("profile:"), `should have profile label: ${result.stdout}`);
  assert(result.stdout.includes("sess-110"), `should show session: ${result.stdout}`);
  assert(result.stdout.includes("Format Agent"), `should show agent name: ${result.stdout}`);
  assert(result.stdout.includes("complete"), `should show status: ${result.stdout}`);
  assert(result.stdout.includes("700"), `should show token total: ${result.stdout}`);
  assert(result.stdout.includes("api calls:"), `should show api calls count: ${result.stdout}`);
  assert(result.stdout.includes("peak memory:"), `should show peak memory: ${result.stdout}`);
  assert(result.stdout.includes("avg cpu:"), `should show avg cpu: ${result.stdout}`);
});

test("full lifecycle: start, snapshot, record-tokens, end, get", () => {
  resetTmp();

  const result = runBash([
    'profiler-start sess-200 agent-200 "Lifecycle Agent" run-full',
    'profiler-snapshot sess-200 "init"',
    'profiler-record-tokens sess-200 gpt-4 1000 500 2000',
    'profiler-snapshot sess-200 "midway"',
    'profiler-record-tokens sess-200 claude-3 800 400 1500',
    'profiler-end sess-200 complete',
    'profiler-get sess-200',
  ].join('\n'));

  assert(result.status === 0, `should succeed: status=${result.status}\nstderr: ${result.stderr}`);

  // profiler-get outputs multi-line JSON, preceded by path lines from
  // profiler-start/profiler-end. find the JSON by locating the first {
  const firstBrace = result.stdout.indexOf("{");
  assert(firstBrace >= 0, `should find JSON start in output`);
  const jsonStr = result.stdout.slice(firstBrace);

  const profile = JSON.parse(jsonStr);
  assert(profile.session === "sess-200", `session: ${profile.session}`);
  assert(profile.status === "complete", `status: ${profile.status}`);
  assert(profile.snapshots.length === 2, `snapshots: ${profile.snapshots.length}`);
  assert(profile.api_calls.length === 2, `api_calls: ${profile.api_calls.length}`);
  assert(profile.tokens.total === 2700, `total tokens: ${profile.tokens.total}`);
  assert(profile.tokens.total_input === 1800, `total_input: ${profile.tokens.total_input}`);
  assert(profile.tokens.total_output === 900, `total_output: ${profile.tokens.total_output}`);
  assert(profile.duration_ms != null, `duration_ms should be set`);
  assert(profile.ended_at != null, `ended_at should be set`);
  assert(profile.run_id === "run-full", `run_id: ${profile.run_id}`);
});

test("full lifecycle with text output format", () => {
  resetTmp();

  const result = runBash([
    'profiler-start life-text agent-1 "text-lifecycle"',
    'profiler-record-tokens life-text gpt-4 1000 500',
    'profiler-end life-text complete',
    'profiler-get life-text text',
  ].join('\n'));

  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("profile: life-text"), `text lifecycle session`);
  assert(result.stdout.includes("agent:   text-lifecycle"), `text lifecycle agent`);
  assert(result.stdout.includes("status:  complete"), `text lifecycle status`);
  assert(result.stdout.includes("tokens:"), `text lifecycle tokens`);
  assert(result.stdout.includes("api calls:   1"), `text lifecycle api calls`);
});

test("multiple independent sessions maintain separate profiles", () => {
  resetTmp();

  runBash([
    'profiler-start conc-1 agent-1 "first"',
    'profiler-start conc-2 agent-2 "second"',
    'profiler-record-tokens conc-1 gpt-4 100 50',
    'profiler-record-tokens conc-2 claude-3 200 100',
    'profiler-end conc-1 complete',
    'profiler-end conc-2 failed',
  ].join('\n'));

  const p1 = readJson(join(PROFILER_DIR, "conc-1.json"));
  const p2 = readJson(join(PROFILER_DIR, "conc-2.json"));

  assert(p1.session === "conc-1", `session 1 id`);
  assert(p2.session === "conc-2", `session 2 id`);
  assert(p1.tokens.total === 150, `session 1 tokens isolated`);
  assert(p2.tokens.total === 300, `session 2 tokens isolated`);
  assert(p1.status === "complete", `session 1 status`);
  assert(p2.status === "failed", `session 2 status`);
});

test("profiler-cleanup removes old profiles", () => {
  resetTmp();

  // create a profile
  runBash('profiler-start sess-300 agent-300 "Old Agent"');

  // make it old by modifying mtime
  const profileFile = join(PROFILER_DIR, "sess-300.json");
  assert(existsSync(profileFile), `profile should exist before cleanup`);

  // touch it to be 31 days old
  runBash(`touch -t $(date -v-31d +%Y%m%d%H%M 2>/dev/null || date -d "31 days ago" +%Y%m%d%H%M) "${profileFile}" 2>/dev/null || touch -d "31 days ago" "${profileFile}"`);

  const result = runBash('profiler-cleanup 30');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(result.stdout.includes("cleaned"), `should report cleaned: ${result.stdout}`);

  // the old file should be gone
  assert(!existsSync(profileFile), `old profile should be deleted`);
});

test("profiler-cleanup preserves recent profiles", () => {
  resetTmp();

  runBash('profiler-start sess-301 agent-301 "Recent Agent"');
  const profileFile = join(PROFILER_DIR, "sess-301.json");

  const result = runBash('profiler-cleanup 30');
  assert(result.status === 0, `should succeed: status=${result.status}`);
  assert(existsSync(profileFile), `recent profile should be preserved`);
});

test("overwriting a session with same name replaces the profile", () => {
  resetTmp();

  runBash([
    'profiler-start overwrite agent-1 "first"',
    'profiler-record-tokens overwrite gpt-4 100 50',
    'profiler-end overwrite complete',
    // start again with same session name
    'profiler-start overwrite agent-2 "second"',
    'profiler-record-tokens overwrite gpt-4 999 1',
  ].join('\n'));

  const profile = readJson(join(PROFILER_DIR, "overwrite.json"));
  assert(profile.agent_id === "agent-2", `profile overwritten with new agent`);
  assert(profile.agent_name === "second", `profile overwritten with new name`);
  assert(profile.tokens.total === 1000, `tokens from new session only: ${profile.tokens.total}`);
  assert(profile.status === "running", `new session is running`);
});

test("profile survives special characters in agent name", () => {
  resetTmp();

  runBash("profiler-start special-chars agent-1 'agent (v2.0-final)'");
  const profile = readJson(join(PROFILER_DIR, "special-chars.json"));
  assert(profile.agent_name.includes("v2.0-final"), `special chars in agent name preserved: ${profile.agent_name}`);
});

// -- run all --

await runTests();
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
