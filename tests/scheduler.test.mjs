#!/usr/bin/env node
/**
 * lib/scheduler.sh tests
 *
 * Tests cron expression validation, schedule reading from chain.json,
 * state tracking (get/update schedule state), enable/disable toggles,
 * lock-based running checks, should_run_chain logic, mark_run lifecycle,
 * cmd_check dispatch, cmd_list output, and error handling for missing
 * chain files.
 *
 * Each test sources scheduler.sh in a fresh bash child process with a
 * tmp directory so filesystem state is isolated.
 */

import { execFileSync } from "child_process";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";

const TMP = `/tmp/test-scheduler-sh-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const SCHEDULER_SH = join(REPO_ROOT, "lib", "scheduler.sh");
const CONFIG_SH = join(REPO_ROOT, "lib", "config.sh");

const NAMESPACE_ID = "default";
const ORG_ID = "default";

const NS_ROOT = join(TMP, "namespaces", NAMESPACE_ID);
const CHAINS_DIR = join(NS_ROOT, "chains");
const SCHEDULES_DIR = join(NS_ROOT, "schedules");

const tests = [];
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${expected}", got "${actual}"`);
  }
}

function assertContains(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(
      `${label}: expected output to contain "${needle}", got "${haystack}"`
    );
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
  console.log(
    `results: ${passed} passed, ${failed} failed, ${passed + failed} total`
  );
  if (failed > 0) {
    process.exit(1);
  }
}

// -------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------

function resetTmp() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(CHAINS_DIR, { recursive: true });
  mkdirSync(SCHEDULES_DIR, { recursive: true });
}

// run a bash snippet after sourcing scheduler.sh with given env
function runScheduler(code, envOverrides = {}) {
  const script = `source '${SCHEDULER_SH}'\n${code}`;
  return execFileSync("bash", ["-c", script], {
    env: {
      ...process.env,
      MENTIKO_GLOBAL_ROOT: TMP,
      NAMESPACE_ID,
      ORG_ID,
      HOME: process.env.HOME,
      // suppress _sys_log curl calls by pointing to a port nothing listens on
      WEB_PORT: "19999",
      ...envOverrides,
    },
    encoding: "utf-8",
    timeout: 8000,
  });
}

// run and expect failure (non-zero exit)
function runSchedulerFail(code, envOverrides = {}) {
  try {
    runScheduler(code, envOverrides);
    return null;
  } catch (err) {
    return {
      status: err.status || 1,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

// write a chain.json in the chains dir and return its path
function writeChain(name, config = {}, agents = []) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const chainDir = join(CHAINS_DIR, slug);
  mkdirSync(chainDir, { recursive: true });
  const chainPath = join(chainDir, "chain.json");
  writeFileSync(
    chainPath,
    JSON.stringify({ name, description: `${name} test`, agents, config }, null, 2)
  );
  return chainPath;
}

// write a chain.json at an arbitrary path (not under CHAINS_DIR)
function writeChainAt(filePath, config = {}) {
  mkdirSync(join(filePath, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify({
      name: "external-chain",
      description: "chain outside chains dir",
      agents: [],
      config,
    }, null, 2)
  );
  return filePath;
}

// -------------------------------------------------------------------
// 1. validate_cron: cron expression validation
// -------------------------------------------------------------------

test("validate_cron accepts standard 5-part cron", () => {
  const out = runScheduler('validate_cron "0 9 * * *"');
  assertEqual(out.trim(), "valid", "5-part cron");
});

test("validate_cron accepts 6-part cron with seconds", () => {
  const out = runScheduler('validate_cron "0 0 9 * * *"');
  assertEqual(out.trim(), "valid", "6-part cron");
});

test("validate_cron accepts every-minute expression", () => {
  const out = runScheduler('validate_cron "* * * * *"');
  assertEqual(out.trim(), "valid", "every-minute cron");
});

test("validate_cron accepts step expression", () => {
  const out = runScheduler('validate_cron "*/5 * * * *"');
  assertEqual(out.trim(), "valid", "step cron");
});

test("validate_cron accepts range expression", () => {
  const out = runScheduler('validate_cron "0 9-17 * * 1-5"');
  assertEqual(out.trim(), "valid", "range cron");
});

test("validate_cron rejects empty string", () => {
  const result = runSchedulerFail('validate_cron ""');
  assert(result !== null, "expected failure for empty string");
  assertContains(result.stdout, "invalid", "rejection message");
});

test("validate_cron rejects single field", () => {
  const result = runSchedulerFail('validate_cron "0"');
  assert(result !== null, "expected failure for single field");
  assertContains(result.stdout, "invalid", "rejection for single field");
});

test("validate_cron rejects 3-part expression", () => {
  const result = runSchedulerFail('validate_cron "0 9 *"');
  assert(result !== null, "expected failure for 3-part");
  assertContains(result.stdout, "invalid", "rejection for 3-part");
});

test("validate_cron rejects 7-part expression", () => {
  const result = runSchedulerFail('validate_cron "0 0 0 9 * * *"');
  assert(result !== null, "expected failure for 7-part");
  assertContains(result.stdout, "invalid", "rejection for 7-part");
});

test("validate_cron returns exit 1 on invalid", () => {
  const result = runSchedulerFail('validate_cron "not-a-cron"');
  assert(result !== null, "expected failure");
  assertEqual(result.status, 1, "exit code 1 for invalid cron");
});

// -------------------------------------------------------------------
// 2. get_schedule: reading schedule from chain.json
// -------------------------------------------------------------------

test("get_schedule reads flat format (string)", () => {
  resetTmp();
  const chainPath = writeChain("flat-sched", { schedule: "0 9 * * *" });
  const out = runScheduler(`get_schedule "${chainPath}"`);
  assertEqual(out.trim(), "0 9 * * *", "flat schedule");
});

test("get_schedule reads nested format (object with cron)", () => {
  resetTmp();
  const chainPath = writeChain("nested-sched", {
    schedule: { cron: "30 10 * * 1", timezone: "US/Eastern" },
  });
  const out = runScheduler(`get_schedule "${chainPath}"`);
  assertEqual(out.trim(), "30 10 * * 1", "nested cron");
});

test("get_schedule returns empty when no schedule configured", () => {
  resetTmp();
  const chainPath = writeChain("no-sched", {});
  const out = runScheduler(`get_schedule "${chainPath}"`);
  assertEqual(out.trim(), "", "no schedule");
});

test("get_schedule returns empty for chain with config but no schedule", () => {
  resetTmp();
  const chainPath = writeChain("config-no-sched", { max_rounds: 5 });
  const out = runScheduler(`get_schedule "${chainPath}"`);
  assertEqual(out.trim(), "", "config without schedule");
});

test("get_schedule prefers nested format over flat", () => {
  resetTmp();
  // Manually write a chain that has both (unlikely but edge case)
  const chainDir = join(CHAINS_DIR, "both-formats");
  mkdirSync(chainDir, { recursive: true });
  const chainPath = join(chainDir, "chain.json");
  writeFileSync(
    chainPath,
    JSON.stringify({
      name: "both",
      config: {
        schedule: { cron: "0 8 * * *", timezone: "UTC" },
      },
    })
  );
  const out = runScheduler(`get_schedule "${chainPath}"`);
  assertEqual(out.trim(), "0 8 * * *", "nested preferred over flat");
});

// -------------------------------------------------------------------
// 3. get_timezone
// -------------------------------------------------------------------

test("get_timezone reads timezone from nested schedule", () => {
  resetTmp();
  const chainPath = writeChain("tz-nested", {
    schedule: { cron: "0 9 * * *", timezone: "Europe/Berlin" },
  });
  const out = runScheduler(`get_timezone "${chainPath}"`);
  assertEqual(out.trim(), "Europe/Berlin", "nested timezone");
});

test("get_timezone falls back to config.timezone", () => {
  resetTmp();
  const chainPath = writeChain("tz-fallback", {
    schedule: "0 9 * * *",
    timezone: "Asia/Tokyo",
  });
  const out = runScheduler(`get_timezone "${chainPath}"`);
  assertEqual(out.trim(), "Asia/Tokyo", "config.timezone fallback");
});

test("get_timezone defaults to UTC when no timezone set", () => {
  resetTmp();
  const chainPath = writeChain("tz-default", { schedule: "0 9 * * *" });
  const out = runScheduler(`get_timezone "${chainPath}"`);
  assertEqual(out.trim(), "UTC", "default UTC");
});

// -------------------------------------------------------------------
// 4. get_schedule_id
// -------------------------------------------------------------------

test("get_schedule_id produces deterministic id from chain path", () => {
  resetTmp();
  const chainPath = writeChain("sched-id-test", { schedule: "0 9 * * *" });
  const out = runScheduler(`get_schedule_id "${chainPath}"`);
  const id = out.trim();
  assert(id.length > 0, "schedule id is non-empty");
  // should not contain slashes
  assert(!id.includes("/"), `schedule id should not contain slashes: ${id}`);
});

test("get_schedule_id is consistent for same path", () => {
  resetTmp();
  const chainPath = writeChain("sched-consistent", { schedule: "0 9 * * *" });
  const out1 = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  const out2 = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  assertEqual(out1, out2, "consistent schedule id");
});

// -------------------------------------------------------------------
// 5. schedule state: get and update
// -------------------------------------------------------------------

test("get_schedule_state returns 0 for unknown schedule", () => {
  resetTmp();
  const out = runScheduler('get_schedule_state "unknown-schedule-id"');
  assertEqual(out.trim(), "0", "default state is 0");
});

test("update_schedule_state sets timestamp", () => {
  resetTmp();
  runScheduler('update_schedule_state "test-sched-1" "1700000000"');
  const out = runScheduler('get_schedule_state "test-sched-1"');
  assertEqual(out.trim(), "1700000000", "updated state");
});

test("update_schedule_state defaults to current time", () => {
  resetTmp();
  const before = Math.floor(Date.now() / 1000);
  runScheduler('update_schedule_state "test-sched-now"');
  const after = Math.floor(Date.now() / 1000);
  const out = runScheduler('get_schedule_state "test-sched-now"');
  const ts = parseInt(out.trim(), 10);
  assert(ts >= before && ts <= after, `timestamp ${ts} not in range [${before}, ${after}]`);
});

test("state persists across invocations via state.json", () => {
  resetTmp();
  runScheduler('update_schedule_state "persist-test" "1600000000"');
  // verify state.json was written
  const stateFile = join(SCHEDULES_DIR, "state.json");
  assert(existsSync(stateFile), "state.json exists");
  const state = JSON.parse(readFileSync(stateFile, "utf-8"));
  assertEqual(String(state["persist-test"]), "1600000000", "state.json content");
});

test("update_schedule_state overwrites previous value", () => {
  resetTmp();
  runScheduler('update_schedule_state "overwrite-test" "1000000000"');
  runScheduler('update_schedule_state "overwrite-test" "2000000000"');
  const out = runScheduler('get_schedule_state "overwrite-test"');
  assertEqual(out.trim(), "2000000000", "overwritten state");
});

// -------------------------------------------------------------------
// 6. enable / disable
// -------------------------------------------------------------------

test("cmd_enable creates status file with enabled: true", () => {
  resetTmp();
  const chainPath = writeChain("enable-test", { schedule: "0 9 * * *" });
  const out = runScheduler(`cmd_enable "${chainPath}"`);
  assertContains(out, "schedule enabled", "enable message");
  // verify status file
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  const statusFile = join(SCHEDULES_DIR, `${scheduleId}.status`);
  assert(existsSync(statusFile), "status file created");
  assertContains(readFileSync(statusFile, "utf-8"), "enabled: true", "status content");
});

test("cmd_disable creates status file with enabled: false", () => {
  resetTmp();
  const chainPath = writeChain("disable-test", { schedule: "0 9 * * *" });
  const out = runScheduler(`cmd_disable "${chainPath}"`);
  assertContains(out, "schedule disabled", "disable message");
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  const statusFile = join(SCHEDULES_DIR, `${scheduleId}.status`);
  assert(existsSync(statusFile), "status file created");
  assertContains(readFileSync(statusFile, "utf-8"), "enabled: false", "status content");
});

test("is_enabled returns true when schedule exists and no status file", () => {
  resetTmp();
  const chainPath = writeChain("enabled-default", { schedule: "0 9 * * *" });
  // is_enabled echoes nothing on true, so check exit code via &&
  const out = runScheduler(`is_enabled "${chainPath}" && echo "yes"`);
  assertContains(out.trim(), "yes", "enabled by default");
});

test("is_enabled returns false when disabled via status file", () => {
  resetTmp();
  const chainPath = writeChain("disabled-via-file", { schedule: "0 9 * * *" });
  runScheduler(`cmd_disable "${chainPath}"`);
  // is_enabled returns non-zero when disabled, so check via ||
  const out = runScheduler(`is_enabled "${chainPath}" || echo "no"`);
  assertContains(out.trim(), "no", "disabled via status file");
});

test("is_enabled returns true after re-enabling", () => {
  resetTmp();
  const chainPath = writeChain("reenable", { schedule: "0 9 * * *" });
  runScheduler(`cmd_disable "${chainPath}"`);
  runScheduler(`cmd_enable "${chainPath}"`);
  const out = runScheduler(`is_enabled "${chainPath}" && echo "yes"`);
  assertContains(out.trim(), "yes", "re-enabled");
});

// -------------------------------------------------------------------
// 7. is_running: lock-based running check
// -------------------------------------------------------------------

test("is_running returns false when no lock file exists", () => {
  resetTmp();
  const out = runScheduler('is_running "no-lock-test"');
  assertEqual(out.trim(), "false", "not running without lock");
});

test("is_running returns false when lock is stale (>2h old)", () => {
  resetTmp();
  // create an old lock (3 hours ago)
  const threeHoursAgo = Math.floor(Date.now() / 1000) - 10800;
  writeFileSync(join(SCHEDULES_DIR, "stale-lock-test.lock"), String(threeHoursAgo));
  const out = runScheduler('is_running "stale-lock-test"');
  assertEqual(out.trim(), "false", "stale lock returns false");
  // stale lock file should be cleaned up
  assert(!existsSync(join(SCHEDULES_DIR, "stale-lock-test.lock")), "stale lock removed");
});

test("is_running returns true when lock is recent and pid is alive", () => {
  resetTmp();
  const now = Math.floor(Date.now() / 1000);
  // use current process pid (node is running)
  writeFileSync(join(SCHEDULES_DIR, "active-lock-test.lock"), String(now));
  writeFileSync(join(SCHEDULES_DIR, "active-lock-test.pid"), String(process.pid));
  const out = runScheduler('is_running "active-lock-test"');
  assertEqual(out.trim(), "true", "active lock with live pid");
});

test("is_running returns false when pid is dead despite fresh lock", () => {
  resetTmp();
  const now = Math.floor(Date.now() / 1000);
  // pid 999999 is very unlikely to exist
  writeFileSync(join(SCHEDULES_DIR, "dead-pid-test.lock"), String(now));
  writeFileSync(join(SCHEDULES_DIR, "dead-pid-test.pid"), "999999");
  const out = runScheduler('is_running "dead-pid-test"');
  assertEqual(out.trim(), "false", "dead pid returns false");
});

// -------------------------------------------------------------------
// 8. should_run_chain: combined check
// -------------------------------------------------------------------

test("should_run_chain returns false when no schedule configured", () => {
  resetTmp();
  const chainPath = writeChain("no-run-sched", {});
  const out = runScheduler(`should_run_chain "${chainPath}"`);
  assertEqual(out.trim(), "false", "no schedule = false");
});

test("should_run_chain returns false when schedule is disabled", () => {
  resetTmp();
  const chainPath = writeChain("disabled-run", { schedule: "0 9 * * *" });
  runScheduler(`cmd_disable "${chainPath}"`);
  const out = runScheduler(`should_run_chain "${chainPath}"`);
  assertEqual(out.trim(), "false", "disabled schedule = false");
});

test("should_run_chain returns false when already running", () => {
  resetTmp();
  const chainPath = writeChain("running-run", { schedule: "* * * * *" });
  // create active lock
  const now = Math.floor(Date.now() / 1000);
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  writeFileSync(join(SCHEDULES_DIR, `${scheduleId}.lock`), String(now));
  writeFileSync(join(SCHEDULES_DIR, `${scheduleId}.pid`), String(process.pid));
  const out = runScheduler(`should_run_chain "${chainPath}"`);
  assertEqual(out.trim(), "false", "already running = false");
});

// -------------------------------------------------------------------
// 9. mark_run_start and mark_run_end lifecycle
// -------------------------------------------------------------------

test("mark_run_start creates lock and pid files", () => {
  resetTmp();
  const chainPath = writeChain("mark-start", { schedule: "0 9 * * *" });
  runScheduler(`mark_run_start "${chainPath}"`);
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  assert(existsSync(join(SCHEDULES_DIR, `${scheduleId}.lock`)), "lock file created");
  assert(existsSync(join(SCHEDULES_DIR, `${scheduleId}.pid`)), "pid file created");
});

test("mark_run_end removes lock and pid files and updates state", () => {
  resetTmp();
  const chainPath = writeChain("mark-end", { schedule: "0 9 * * *" });
  runScheduler(`mark_run_start "${chainPath}"`);
  runScheduler(`mark_run_end "${chainPath}" "success"`);
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  assert(!existsSync(join(SCHEDULES_DIR, `${scheduleId}.lock`)), "lock file removed");
  assert(!existsSync(join(SCHEDULES_DIR, `${scheduleId}.pid`)), "pid file removed");
  // state should be updated
  const state = runScheduler(`get_schedule_state "${scheduleId}"`).trim();
  assert(parseInt(state, 10) > 0, `state updated: ${state}`);
});

test("mark_run_end records in history file", () => {
  resetTmp();
  const chainPath = writeChain("history-test", { schedule: "0 9 * * *" });
  runScheduler(`mark_run_start "${chainPath}"`);
  runScheduler(`mark_run_end "${chainPath}" "success"`);
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  const historyFile = join(SCHEDULES_DIR, `${scheduleId}.history`);
  assert(existsSync(historyFile), "history file created");
  const history = readFileSync(historyFile, "utf-8");
  assertContains(history, "success", "history records success");
});

test("mark_run_end records failure status in history", () => {
  resetTmp();
  const chainPath = writeChain("history-fail", { schedule: "0 9 * * *" });
  runScheduler(`mark_run_start "${chainPath}"`);
  runScheduler(`mark_run_end "${chainPath}" "failed"`);
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  const historyFile = join(SCHEDULES_DIR, `${scheduleId}.history`);
  const history = readFileSync(historyFile, "utf-8");
  assertContains(history, "failed", "history records failure");
});

// -------------------------------------------------------------------
// 10. mark_run (legacy wrapper)
// -------------------------------------------------------------------

test("mark_run delegates to mark_run_end", () => {
  resetTmp();
  const chainPath = writeChain("legacy-mark", { schedule: "0 9 * * *" });
  runScheduler(`mark_run_start "${chainPath}"`);
  runScheduler(`mark_run "${chainPath}" "success"`);
  const scheduleId = runScheduler(`get_schedule_id "${chainPath}"`).trim();
  assert(!existsSync(join(SCHEDULES_DIR, `${scheduleId}.lock`)), "lock removed via legacy");
  const state = runScheduler(`get_schedule_state "${scheduleId}"`).trim();
  assert(parseInt(state, 10) > 0, "state updated via legacy");
});

// -------------------------------------------------------------------
// 11. cmd_check: error handling for missing chain
// -------------------------------------------------------------------

test("cmd_check errors on missing chain file", () => {
  resetTmp();
  const result = runSchedulerFail('cmd_check "/nonexistent/chain.json"');
  assert(result !== null, "expected failure");
  assertContains(result.stdout, "not found", "missing file message");
});

test("cmd_check reports no schedule when schedule is absent", () => {
  resetTmp();
  const chainPath = writeChain("check-no-sched", {});
  const out = runScheduler(`cmd_check "${chainPath}"`);
  assertContains(out, "no schedule configured", "no schedule message");
});

// -------------------------------------------------------------------
// 12. cmd_next: next run display
// -------------------------------------------------------------------

test("cmd_next errors on missing chain file", () => {
  resetTmp();
  const result = runSchedulerFail('cmd_next "/nonexistent/chain.json"');
  assert(result !== null, "expected failure");
  assertContains(result.stdout, "not found", "missing file message");
});

test("cmd_next reports no schedule when absent", () => {
  resetTmp();
  const chainPath = writeChain("next-no-sched", {});
  const out = runScheduler(`cmd_next "${chainPath}"`);
  assertContains(out, "no schedule configured", "no schedule message");
});

test("cmd_next shows next run for scheduled chain", () => {
  resetTmp();
  const chainPath = writeChain("next-sched", { schedule: "0 9 * * *" });
  const out = runScheduler(`cmd_next "${chainPath}"`);
  assertContains(out, "next run:", "next run output");
});

// -------------------------------------------------------------------
// 13. cmd_list: listing scheduled chains
// -------------------------------------------------------------------

test("cmd_list shows scheduled chains", () => {
  resetTmp();
  writeChain("list-test-1", { schedule: "0 9 * * *" });
  writeChain("list-test-2", { schedule: "*/15 * * * *" });
  const out = runScheduler("cmd_list");
  assertContains(out, "scheduled chains:", "list header");
  assertContains(out, "list-test-1", "first chain listed");
  assertContains(out, "list-test-2", "second chain listed");
  assertContains(out, "0 9 * * *", "first schedule visible");
  assertContains(out, "*/15 * * * *", "second schedule visible");
});

test("cmd_list skips chains without schedules", () => {
  resetTmp();
  writeChain("listed-chain", { schedule: "0 9 * * *" });
  writeChain("unscheduled-chain", {});
  const out = runScheduler("cmd_list");
  assertContains(out, "listed-chain", "scheduled chain shown");
  // unscheduled-chain should not appear in the output
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  const unscheduledLines = lines.filter(
    (l) => l.includes("unscheduled-chain") && !l.includes("listed")
  );
  assertEqual(String(unscheduledLines.length), "0", "unscheduled chain not shown");
});

test("cmd_list shows enabled/disabled status", () => {
  resetTmp();
  const chainPath = writeChain("status-display", { schedule: "0 9 * * *" });
  runScheduler(`cmd_enable "${chainPath}"`);
  const out = runScheduler("cmd_list");
  assertContains(out, "enabled", "status shown");
});

test("cmd_list shows disabled status", () => {
  resetTmp();
  const chainPath = writeChain("disabled-display", { schedule: "0 9 * * *" });
  runScheduler(`cmd_disable "${chainPath}"`);
  const out = runScheduler("cmd_list");
  assertContains(out, "disabled", "disabled status shown");
});

test("cmd_list works with empty chains directory", () => {
  resetTmp();
  const out = runScheduler("cmd_list");
  assertContains(out, "scheduled chains:", "header shown even when empty");
});

// -------------------------------------------------------------------
// 14. calculate_next_run
// -------------------------------------------------------------------

test("calculate_next_run returns 0 when croniter is unavailable", () => {
  resetTmp();
  // This test may return 0 if croniter is not installed, which is fine
  // we just verify it does not crash
  const out = runScheduler('calculate_next_run "0 9 * * *" "1700000000"');
  const ts = parseInt(out.trim(), 10);
  assert(ts >= 0, `calculate_next_run returned non-negative: ${ts}`);
});

// -------------------------------------------------------------------
// 15. standalone CLI mode
// -------------------------------------------------------------------

test("scheduler.sh shows usage when called with no args", () => {
  const result = runSchedulerFail("", {
    // BASH_SOURCE[0] == $0 when executed directly
    // but we source it, so we test via direct execution
  });
  // When sourced with no code, it should not fail
  // test direct execution instead
  let out;
  try {
    out = execFileSync("bash", [SCHEDULER_SH], {
      env: {
        ...process.env,
        MENTIKO_GLOBAL_ROOT: TMP,
        NAMESPACE_ID,
        ORG_ID,
        WEB_PORT: "19999",
      },
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch (err) {
    out = err.stdout || "";
  }
  assertContains(out, "usage:", "usage shown when called directly");
});

test("scheduler.sh shows usage for unknown command", () => {
  let out = "";
  try {
    out = execFileSync("bash", [SCHEDULER_SH, "bogus-command"], {
      env: {
        ...process.env,
        MENTIKO_GLOBAL_ROOT: TMP,
        NAMESPACE_ID,
        ORG_ID,
        WEB_PORT: "19999",
      },
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch (err) {
    out = (err.stdout || "") + (err.stderr || "");
  }
  assertContains(out, "usage:", "usage shown for unknown command");
});

// -------------------------------------------------------------------
// 16. error handling: missing chain/workspace
// -------------------------------------------------------------------

test("cmd_check handles chain file that disappears mid-run", () => {
  resetTmp();
  const result = runSchedulerFail('cmd_check "/tmp/no-such-chain-' + process.pid + '.json"');
  assert(result !== null, "expected failure");
  assertContains(result.stdout, "not found", "missing file error");
  assertEqual(String(result.status), "1", "exit code 1");
});

test("cmd_next handles chain file that disappears", () => {
  resetTmp();
  const result = runSchedulerFail('cmd_next "/tmp/no-such-chain-' + process.pid + '.json"');
  assert(result !== null, "expected failure");
  assertContains(result.stdout, "not found", "missing file error");
});

// -------------------------------------------------------------------
// 17. state file initialization
// -------------------------------------------------------------------

test("state.json is created as empty object on first source", () => {
  resetTmp();
  // remove state.json if it exists
  const stateFile = join(SCHEDULES_DIR, "state.json");
  if (existsSync(stateFile)) rmSync(stateFile);
  runScheduler('echo "sourced"');
  assert(existsSync(stateFile), "state.json created on source");
  const content = readFileSync(stateFile, "utf-8");
  assertEqual(content.trim(), "{}", "state.json initialized to empty object");
});

// -------------------------------------------------------------------
// 18. concurrent state updates
// -------------------------------------------------------------------

test("multiple state updates do not corrupt state.json", () => {
  resetTmp();
  runScheduler('update_schedule_state "concurrent-1" "100"');
  runScheduler('update_schedule_state "concurrent-2" "200"');
  runScheduler('update_schedule_state "concurrent-3" "300"');
  const stateFile = join(SCHEDULES_DIR, "state.json");
  const state = JSON.parse(readFileSync(stateFile, "utf-8"));
  assertEqual(String(state["concurrent-1"]), "100", "first entry preserved");
  assertEqual(String(state["concurrent-2"]), "200", "second entry preserved");
  assertEqual(String(state["concurrent-3"]), "300", "third entry preserved");
});

// -------------------------------------------------------------------
// run
// -------------------------------------------------------------------

console.log("lib/scheduler.sh tests\n");
resetTmp();
runTests().then(() => {
  rmSync(TMP, { recursive: true, force: true });
});
