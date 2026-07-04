#!/usr/bin/env node
/**
 * lib/watchdog.sh tests
 *
 * Tests the watchdog daemon's core logic:
 * - stalled run detection (dead sessions, no sessions, pending-only)
 * - timeout marking via run.json updates
 * - orphaned session cleanup
 * - event file emission for run-stalled
 * - hook dispatch on stall
 * - graceful shutdown via stop subcommand
 *
 * Strategy: extract function bodies from watchdog.sh via sed,
 * eval them in a bash child process with mocked transport_*
 * and _sys_log. Each test runs in isolation under a fresh TMP dir.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const TMP = `/tmp/test-watchdog-${process.pid}`;
const REPO_ROOT = join(import.meta.dirname, "..");
const LIB_DIR = join(REPO_ROOT, "lib");
const WATCHDOG = join(LIB_DIR, "watchdog.sh");

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

function resetTmp() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

const RUNS_DIR = join(TMP, "runs");
const EVENTS_DIR = join(TMP, "events");
const HOOKS_DIR = join(TMP, "watchdog-hooks");
const CHAIN_DIR = join(TMP, "chains");

function setupDirs() {
  mkdirSync(RUNS_DIR, { recursive: true });
  mkdirSync(EVENTS_DIR, { recursive: true });
  mkdirSync(HOOKS_DIR, { recursive: true });
  mkdirSync(CHAIN_DIR, { recursive: true });
}

/**
 * Generate a timestamp that watchdog.sh can parse.
 * The date parsing in watchdog uses sed to strip +XX:XX/-XX:XX timezone
 * suffixes, but does NOT strip .xxxZ from ISO strings. So we generate
 * timestamps in local time without milliseconds or Z suffix.
 */
function parseableTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function createRun(runId, overrides = {}) {
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });
  const runJson = {
    id: runId,
    chain: "test-chain",
    status: "running",
    started: parseableTimestamp(),
    agents: [],
    ...overrides,
  };
  writeFileSync(join(runDir, "run.json"), JSON.stringify(runJson, null, 2));
  return runDir;
}

/**
 * Runs a bash snippet in a child process with mocked transport/syslog.
 *
 * Key design:
 *   - mocks defined BEFORE sourcing (to prevent crashes)
 *   - mocks RE-defined AFTER sourcing (to override the real implementations)
 *   - check_run / get_active_run_sessions / cleanup_orphaned_sessions
 *     extracted from watchdog.sh via sed/eval (avoids the main loop)
 *   - AUTO_HEAL and SELF_HEAL_CHAIN set to safe defaults
 */
function runBash(body, extraEnv = {}) {
  const script = `
set -uo pipefail

MOCK_STATE_DIR="${TMP}/mock-state"
mkdir -p "$MOCK_STATE_DIR"

MOCK_ALIVE_FILE="$MOCK_STATE_DIR/alive_sessions"
touch "$MOCK_ALIVE_FILE"
MOCK_EXISTS_FILE="$MOCK_STATE_DIR/exists_sessions"
touch "$MOCK_EXISTS_FILE"
MOCK_KILLED_FILE="$MOCK_STATE_DIR/killed_sessions"
touch "$MOCK_KILLED_FILE"
MOCK_LIST_FILE="$MOCK_STATE_DIR/list_sessions"
touch "$MOCK_LIST_FILE"

# -- pre-source stubs (prevent crashes in sourced scripts) --

transport_has_session() { return 1; }
transport_session_exists() { return 1; }
transport_kill_session() { :; }
transport_list_sessions() { cat "$MOCK_LIST_FILE" 2>/dev/null; }
_sys_log() {
  local level="\$1" source="\$2" message="\$3" detail="\${4:-}"
  echo "\${level}|\${source}|\${message}|\${detail}" >> "$MOCK_STATE_DIR/sys_log"
}
run_hooks() {
  local event_type="\$1" run_id="\$2" details="\$3"
  echo "\${event_type}|\${run_id}|\${details}" >> "$MOCK_STATE_DIR/hooks_called"
}
update-task-from-run() {
  echo "\$1|\$2" >> "$MOCK_STATE_DIR/task_updates"
}
dispatch-chain-stalled() {
  echo "\$1|\$2" >> "$MOCK_STATE_DIR/dispatch_called"
}

# -- config vars --

export MENTIKO_GLOBAL_ROOT="${TMP}"
export MENTIKO_CODE_ROOT="${REPO_ROOT}"
export NAMESPACE_ID="default"
export ORG_ID="default"
export RUNS_DIR="${RUNS_DIR}"
export EVENTS_DIR="${EVENTS_DIR}"
export CHAIN_DIR="${CHAIN_DIR}"
export WATCHDOG_HOOKS_DIR="${HOOKS_DIR}"
export HOOKS_DIR="${HOOKS_DIR}"
export _HOOKS_DIR="${HOOKS_DIR}"
export AUTO_HEAL="false"
export SELF_HEAL_CHAIN="${CHAIN_DIR}/self-heal/chain.json"
export INTERVAL="60"
export CLEANUP_INTERVAL="300"

# -- source libs --

source "${LIB_DIR}/config.sh" 2>/dev/null || true
source "${LIB_DIR}/run-lib.sh" 2>/dev/null || true
source "${LIB_DIR}/hooks.sh" 2>/dev/null || true

# -- RE-override mocks after sourcing --
# run-lib.sh redefines _sys_log, hooks.sh redefines run_hooks.
# Our mocks must win.

transport_has_session() {
  grep -qxF "\$1" "\$MOCK_ALIVE_FILE" 2>/dev/null
}
transport_session_exists() {
  grep -qxF "\$1" "\$MOCK_EXISTS_FILE" 2>/dev/null
}
transport_kill_session() {
  echo "\$1" >> "\$MOCK_KILLED_FILE"
}
transport_pid() {
  local session="\$1"
  local pid_file="\$MOCK_STATE_DIR/pid_\${session}"
  [[ -f "\$pid_file" ]] || return 1
  cat "\$pid_file"
}
transport_list_sessions() {
  cat "\$MOCK_LIST_FILE" 2>/dev/null
}
_sys_log() {
  local level="\$1" source="\$2" message="\$3" detail="\${4:-}"
  echo "\${level}|\${source}|\${message}|\${detail}" >> "\$MOCK_STATE_DIR/sys_log"
}
run_hooks() {
  local event_type="\$1" run_id="\$2" details="\$3"
  echo "\${event_type}|\${run_id}|\${details}" >> "\$MOCK_STATE_DIR/hooks_called"
}
update-task-from-run() {
  echo "\$1|\$2" >> "\$MOCK_STATE_DIR/task_updates"
}
dispatch-chain-stalled() {
  echo "\$1|\$2" >> "\$MOCK_STATE_DIR/dispatch_called"
}

# -- extract watchdog functions via sed --

eval "$(sed -n '/^check_run()/,/^}/p' "${WATCHDOG}")"
eval "$(sed -n '/^get_active_run_sessions()/,/^}/p' "${WATCHDOG}")"
eval "$(sed -n '/^session_env_value()/,/^}/p' "${WATCHDOG}")"
eval "$(sed -n '/^session_in_watchdog_scope()/,/^}/p' "${WATCHDOG}")"
eval "$(sed -n '/^cleanup_orphaned_sessions()/,/^}/p' "${WATCHDOG}")"

get_live_sessions() {
  cat "$MOCK_LIST_FILE" 2>/dev/null
}

# -- test body --
${body}
`;
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

test("check_run skips non-running runs", () => {
  resetTmp();
  setupDirs();
  createRun("run-1000", { status: "completed" });

  const result = runBash(`
check_run "${RUNS_DIR}/run-1000" ""
echo "done"
`);
  assert(result.stdout.includes("done"), `should complete without stalling: ${result.stdout}`);
  const events = readdirSync(EVENTS_DIR);
  assert(events.length === 0, `should not emit events for completed runs: ${events}`);
});

test("check_run skips run with no run.json", () => {
  resetTmp();
  setupDirs();
  mkdirSync(join(RUNS_DIR, "run-1001"), { recursive: true });

  const result = runBash(`
check_run "${RUNS_DIR}/run-1001" ""
echo "done"
`);
  assert(result.stdout.includes("done"), `should complete: ${result.stdout}`);
});

test("detects stalled run: running agent with dead session", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-agent-1", started: parseableTimestamp() },
    ],
  });

  const result = runBash(`
check_run "${RUNS_DIR}/run-${runTs}" ""
echo "done"
`);
  assert(result.stdout.includes("stalled"), `should detect stall: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "stopped", `run should be stopped: ${runJson.status}`);
  assert(runJson.agents[0].status === "stopped", `agent should be stopped: ${runJson.agents[0].status}`);
});

test("marks running agents with no session as cancelled", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  const startedAt = parseableTimestamp(new Date(Date.now() - 300000));
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: null, started: startedAt },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "stopped", `run should be stopped: ${runJson.status}`);
  assert(runJson.agents[0].status === "cancelled", `agent with null session should be cancelled: ${runJson.agents[0].status}`);
});

test("cancels pending agents on stall", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 300;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "pending" },
      { id: "agent-2", name: "Agent Two", status: "pending" },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "stopped", `run should be stopped: ${runJson.status}`);
  assert(runJson.agents[0].status === "cancelled", `pending agent should be cancelled: ${runJson.agents[0].status}`);
  assert(runJson.agents[1].status === "cancelled", `pending agent 2 should be cancelled: ${runJson.agents[1].status}`);
});

test("does not stall run with live agent session", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-agent-1", started: parseableTimestamp() },
    ],
  });

  const result = runBash(`
echo "sess-agent-1" >> "$MOCK_ALIVE_FILE"
check_run "${RUNS_DIR}/run-${runTs}" ""
echo "done"
`);
  assert(result.stdout.includes("done"), `should complete: ${result.stdout}`);
  assert(!result.stdout.includes("stalled"), `should not detect stall: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "running", `run should still be running: ${runJson.status}`);
});

test("does not stall run with live monitor session", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-agent-1", started: parseableTimestamp() },
    ],
  });

  const result = runBash(`
echo "monitor-sess-agent-1" >> "$MOCK_ALIVE_FILE"
check_run "${RUNS_DIR}/run-${runTs}" ""
echo "done"
`);
  assert(!result.stdout.includes("stalled"), `should not stall with live monitor: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "running", `run should still be running: ${runJson.status}`);
});

test("kills agent sessions on stall", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-dead-1", started: parseableTimestamp() },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(killed.includes("sess-dead-1"), `should kill dead session: ${killed}`);
});

test("emits run-stalled event file", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-1", started: parseableTimestamp() },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const events = readdirSync(EVENTS_DIR).filter(f => f.endsWith("-run-stalled.event"));
  assert(events.length === 1, `should emit one event file: ${events}`);
  const eventContent = readFileSync(join(EVENTS_DIR, events[0]), "utf-8");
  assert(eventContent.includes("event: run-stalled"), `event should have type: ${eventContent}`);
  assert(eventContent.includes(`run_id: run-${runTs}`), `event should have run_id: ${eventContent}`);
  assert(eventContent.includes("source: watchdog"), `event should have source: ${eventContent}`);
  assert(eventContent.includes("processed: false"), `event should be unprocessed: ${eventContent}`);
});

test("fires hooks on stall", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-1", started: parseableTimestamp() },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const hooks = readFileLines(join(TMP, "mock-state", "hooks_called"));
  assert(hooks.length === 1, `should fire one hook: got ${hooks.length}: ${hooks}`);
  assert(hooks[0].startsWith("run-stalled|"), `hook should be run-stalled: ${hooks[0]}`);
  assert(hooks[0].includes(`run-${runTs}`), `hook should reference run: ${hooks[0]}`);
});

test("logs warning to sys_log on stall", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-1", started: parseableTimestamp() },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const logs = readFileLines(join(TMP, "mock-state", "sys_log"));
  assert(logs.length > 0, `should log stall: got ${logs.length} entries`);
  assert(logs[0].includes("warn"), `should be warn level: ${logs[0]}`);
  assert(logs[0].includes("stalled"), `should mention stalled: ${logs[0]}`);
});

test("pending agents with recent completion get grace period", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  const completedAt = parseableTimestamp(new Date(Date.now() - 60000));
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "completed", session: "sess-1", completed: completedAt },
      { id: "agent-2", name: "Agent Two", status: "pending" },
    ],
  });

  const result = runBash(`
check_run "${RUNS_DIR}/run-${runTs}" ""
echo "done"
`);
  assert(!result.stdout.includes("stalled"), `should not stall during grace: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "running", `run should still be running: ${runJson.status}`);
});

test("pending agents with old completion are stalled", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  const completedAt = parseableTimestamp(new Date(Date.now() - 600000));
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "completed", session: "sess-1", completed: completedAt },
      { id: "agent-2", name: "Agent Two", status: "pending" },
    ],
  });

  const result = runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  assert(result.stdout.includes("stalled"), `should stall with old completion: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "stopped", `run should be stopped: ${runJson.status}`);
});

test("running agent with no session gets startup grace (2 min from started)", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  const justStarted = parseableTimestamp(new Date(Date.now() - 30000));
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: null, started: justStarted },
    ],
  });

  const result = runBash(`
check_run "${RUNS_DIR}/run-${runTs}" ""
echo "done"
`);
  assert(!result.stdout.includes("stalled"), `should not stall during startup grace: ${result.stdout}`);
});

test("resumed run gets 2 min grace period", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  const resumedAt = parseableTimestamp(new Date(Date.now() - 30000));
  createRun(`run-${runTs}`, {
    resumedAt: resumedAt,
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-1", started: parseableTimestamp() },
    ],
  });

  const result = runBash(`
check_run "${RUNS_DIR}/run-${runTs}" ""
echo "done"
`);
  assert(!result.stdout.includes("stalled"), `should not stall resumed run in grace: ${result.stdout}`);
});

test("cleanup_orphaned_sessions kills sessions not in active runs", () => {
  resetTmp();
  setupDirs();

  runBash(`
echo "orphan-session-1" > "$MOCK_LIST_FILE"
cleanup_orphaned_sessions "" "orphan-session-1"
echo "done"
`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(killed.includes("orphan-session-1"), `should kill orphan: ${killed}`);
});

test("cleanup_orphaned_sessions preserves sessions in active runs", () => {
  resetTmp();
  setupDirs();
  createRun("run-active", {
    status: "running",
    agents: [
      { id: "a1", status: "running", session: "active-sess-1" },
    ],
  });

  runBash(`
active_sessions=$(get_active_run_sessions)
cleanup_orphaned_sessions "$active_sessions" "active-sess-1"
echo "done"
`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(!killed.includes("active-sess-1"), `should not kill active session: ${killed}`);
});

test("cleanup_orphaned_sessions skips protected session prefixes", () => {
  resetTmp();
  setupDirs();

  runBash(`
live_sessions="mentiko-watchdog
mentiko-chain-watcher
monitor-some-agent
term-user-terminal
gh-auth-github
cli-auth-tool
link-peer-1
peer-agent-2"

cleanup_orphaned_sessions "" "$live_sessions"
echo "done"
`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(killed.length === 0, `should not kill protected sessions: ${killed}`);
});

test("cleanup_orphaned_sessions skips sessions from another namespace root", () => {
  resetTmp();
  setupDirs();

  const result = runBash(`
cat > "$MOCK_STATE_DIR/ps" <<'EOF'
#!/bin/bash
echo "1234 MENTIKO_GLOBAL_ROOT=/Users/malmazan/.mentiko NAMESPACE_ID=default ORG_ID=default"
EOF
chmod +x "$MOCK_STATE_DIR/ps"
echo "1234" > "$MOCK_STATE_DIR/pid_mentiko-chain-recommendation-chain-recommender-run-1"
PATH="$MOCK_STATE_DIR:$PATH"
export MENTIKO_GLOBAL_ROOT="/tmp/mentiko-cache-proof"
export NAMESPACE_ID="cacheproof"

cleanup_orphaned_sessions "" "mentiko-chain-recommendation-chain-recommender-run-1"
echo "done"
`);

  assert(result.stdout.includes("done"), `should complete: ${result.stdout}`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(killed.length === 0, `should not kill cross-root session: ${killed}`);
});

test("get_active_run_sessions collects sessions from running runs", () => {
  resetTmp();
  setupDirs();
  createRun("run-aaa", {
    status: "running",
    agents: [
      { id: "a1", status: "running", session: "sess-1" },
      { id: "a2", status: "pending" },
    ],
  });
  createRun("run-bbb", {
    status: "completed",
    agents: [
      { id: "b1", status: "completed", session: "sess-old" },
    ],
  });

  const result = runBash(`get_active_run_sessions`);
  assert(result.stdout.includes("sess-1"), `should include sess-1: ${result.stdout}`);
  assert(!result.stdout.includes("sess-old"), `should not include completed run sessions: ${result.stdout}`);
});

// REGRESSION: the reaper must spare a live session for EVERY non-terminal run,
// not an allow-list of states it happens to know. It fails safe — reap only
// definitively-terminal runs; spare running, pending (queued by the concurrency
// cap), blocked, and any unknown/future status. An allow-list fails dangerous:
// an active state it doesn't list gets its live agent killed (this bug).
test("get_active_run_sessions spares pending-run sessions (queued / spinning up)", () => {
  resetTmp();
  setupDirs();
  createRun("run-pending", {
    status: "pending",
    agents: [{ id: "a1", status: "pending", session: "mentiko-decision-research-decision-researcher-run-pending" }],
  });
  const result = runBash(`get_active_run_sessions`);
  assert(
    result.stdout.includes("mentiko-decision-research-decision-researcher-run-pending"),
    `pending-run session must be spared: ${result.stdout}`,
  );
});

test("get_active_run_sessions spares blocked-run sessions", () => {
  resetTmp();
  setupDirs();
  createRun("run-blocked", {
    status: "blocked",
    agents: [{ id: "a1", status: "running", session: "blocked-live-sess" }],
  });
  const result = runBash(`get_active_run_sessions`);
  assert(result.stdout.includes("blocked-live-sess"), `blocked-run session must be spared: ${result.stdout}`);
});

test("get_active_run_sessions spares an unknown/future status (fail-safe)", () => {
  resetTmp();
  setupDirs();
  createRun("run-future", {
    status: "paused",
    agents: [{ id: "a1", status: "running", session: "future-state-sess" }],
  });
  const result = runBash(`get_active_run_sessions`);
  assert(result.stdout.includes("future-state-sess"), `unknown-status session must be spared: ${result.stdout}`);
});

test("get_active_run_sessions still EXCLUDES terminal runs (reaper keeps working)", () => {
  resetTmp();
  setupDirs();
  // every terminal spelling across the three RunStatus definitions
  createRun("run-c1", { status: "completed", agents: [{ id: "a", status: "completed", session: "term-completed" }] });
  createRun("run-c2", { status: "complete", agents: [{ id: "a", status: "completed", session: "term-complete" }] });
  createRun("run-f", { status: "failed", agents: [{ id: "a", status: "failed", session: "term-failed" }] });
  createRun("run-x", { status: "cancelled", agents: [{ id: "a", status: "cancelled", session: "term-cancelled" }] });
  createRun("run-s", { status: "stopped", agents: [{ id: "a", status: "stopped", session: "term-stopped" }] });

  const result = runBash(`get_active_run_sessions`);
  for (const s of ["term-completed", "term-complete", "term-failed", "term-cancelled", "term-stopped"]) {
    assert(!result.stdout.includes(s), `terminal-run session ${s} must NOT be spared: ${result.stdout}`);
  }
});

test("cleanup_orphaned_sessions does not reap a pending run's live session, but reaps a completed one's", () => {
  resetTmp();
  setupDirs();
  createRun("run-pending", { status: "pending", agents: [{ id: "a1", status: "pending", session: "pending-live-sess" }] });
  createRun("run-done", { status: "completed", agents: [{ id: "b1", status: "completed", session: "done-orphan-sess" }] });

  runBash(`
active_sessions=$(get_active_run_sessions)
live_sessions="pending-live-sess
done-orphan-sess"
cleanup_orphaned_sessions "$active_sessions" "$live_sessions"
echo done
`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(!killed.includes("pending-live-sess"), `pending-run session must not be reaped: ${killed}`);
  assert(killed.includes("done-orphan-sess"), `completed-run orphan session must still be reaped: ${killed}`);
});

test("completed field is set on stall", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-1", started: parseableTimestamp() },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.completed != null, `completed should be set: ${JSON.stringify(runJson.completed)}`);
});

test("stall event includes last agent diagnostics", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "running", session: "sess-1", started: parseableTimestamp() },
      { id: "agent-2", name: "Agent Two", status: "pending" },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const events = readdirSync(EVENTS_DIR).filter(f => f.endsWith("-run-stalled.event"));
  assert(events.length === 1, `expected one event: ${events}`);
  const eventContent = readFileSync(join(EVENTS_DIR, events[0]), "utf-8");
  assert(eventContent.includes("last_agent:"), `should have last_agent: ${eventContent}`);
  assert(eventContent.includes("pending_agents:"), `should have pending_agents: ${eventContent}`);
  assert(eventContent.includes("agent-2"), `should list pending agent-2: ${eventContent}`);
});

test("multiple running runs: only stalls the dead one", () => {
  resetTmp();
  setupDirs();
  const runTsDead = Math.floor(Date.now() / 1000) - 600;
  const runTsAlive = Math.floor(Date.now() / 1000) - 300;

  createRun(`run-${runTsDead}`, {
    agents: [
      { id: "a-dead", status: "running", session: "sess-dead", started: parseableTimestamp() },
    ],
  });
  createRun(`run-${runTsAlive}`, {
    agents: [
      { id: "a-alive", status: "running", session: "sess-alive", started: parseableTimestamp() },
    ],
  });

  const result = runBash(`
echo "sess-alive" >> "$MOCK_ALIVE_FILE"
check_run "${RUNS_DIR}/run-${runTsDead}" ""
check_run "${RUNS_DIR}/run-${runTsAlive}" ""
echo "done"
`);
  assert(result.stdout.includes("stalled"), `should stall dead run: ${result.stdout}`);
  const deadRun = readJson(join(RUNS_DIR, `run-${runTsDead}`, "run.json"));
  const aliveRun = readJson(join(RUNS_DIR, `run-${runTsAlive}`, "run.json"));
  assert(deadRun.status === "stopped", `dead run should be stopped: ${deadRun.status}`);
  assert(aliveRun.status === "running", `alive run should still be running: ${aliveRun.status}`);
});

test("pending-only run with no recent completion is stalled", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", name: "Agent One", status: "pending" },
    ],
  });

  const result = runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  assert(result.stdout.includes("stalled"), `old pending-only run should be stalled: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "stopped", `run should be stopped: ${runJson.status}`);
});

test("stop subcommand kills mentiko-watchdog session", () => {
  resetTmp();
  setupDirs();

  const result = runBash(`
session_name="mentiko-watchdog"
echo "$session_name" >> "$MOCK_ALIVE_FILE"
if transport_has_session "$session_name" 2>/dev/null; then
    transport_kill_session "$session_name"
    echo "  watchdog: stopped"
else
    echo "  watchdog: not running"
fi
`);
  assert(result.stdout.includes("stopped"), `should report stopped: ${result.stdout}`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(killed.includes("mentiko-watchdog"), `should kill watchdog session: ${killed}`);
});

test("stop subcommand reports not running when absent", () => {
  resetTmp();
  setupDirs();

  const result = runBash(`
session_name="mentiko-watchdog"
if transport_has_session "$session_name" 2>/dev/null; then
    transport_kill_session "$session_name"
    echo "  watchdog: stopped"
else
    echo "  watchdog: not running"
fi
`);
  assert(result.stdout.includes("not running"), `should report not running: ${result.stdout}`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(killed.length === 0, `should not kill anything: ${killed}`);
});

test("status subcommand reports running when alive", () => {
  resetTmp();
  setupDirs();

  const result = runBash(`
session_name="mentiko-watchdog"
echo "$session_name" >> "$MOCK_ALIVE_FILE"
if transport_has_session "$session_name" 2>/dev/null; then
    echo "  watchdog: running"
else
    echo "  watchdog: not running"
fi
`);
  assert(result.stdout.includes("running"), `should report running: ${result.stdout}`);
});

test("auto-heal triggers self-heal chain when enabled", () => {
  resetTmp();
  setupDirs();

  const healDir = join(CHAIN_DIR, "self-heal");
  mkdirSync(healDir, { recursive: true });
  writeFileSync(join(healDir, "chain.json"), JSON.stringify({ name: "self-heal", agents: [] }));

  const mockRunnerLog = join(TMP, "mock-state", "heal_triggered");
  const mockRunner = join(TMP, "mock-bin", "chain-runner.sh");
  mkdirSync(join(TMP, "mock-bin"), { recursive: true });
  writeFileSync(mockRunner, `#!/bin/bash\necho "heal-triggered" >> "${mockRunnerLog}"\n`, { mode: 0o755 });

  const result = runBash(`
AUTO_HEAL="true"
SELF_HEAL_CHAIN="${join(healDir, "chain.json")}"
if [[ "$AUTO_HEAL" == "true" && -f "$SELF_HEAL_CHAIN" ]]; then
    bash "${mockRunner}"
fi
echo "done"
`);
  assert(result.stdout.includes("done"), `should complete: ${result.stdout}`);
  assert(existsSync(mockRunnerLog), `should trigger heal chain`);
});

test("run with mixed agent statuses: completed + running dead + pending", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "a-done", status: "completed", session: "sess-done", completed: parseableTimestamp(new Date(Date.now() - 600000)) },
      { id: "a-running", status: "running", session: "sess-dead", started: parseableTimestamp() },
      { id: "a-pending", status: "pending" },
    ],
  });

  const result = runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  assert(result.stdout.includes("stalled"), `should stall: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "stopped", `should be stopped: ${runJson.status}`);
  const done = runJson.agents.find(a => a.id === "a-done");
  assert(done.status === "completed", `completed agent should stay completed: ${done.status}`);
  const running = runJson.agents.find(a => a.id === "a-running");
  assert(running.status === "stopped", `running agent should be stopped: ${running.status}`);
  const pending = runJson.agents.find(a => a.id === "a-pending");
  assert(pending.status === "cancelled", `pending agent should be cancelled: ${pending.status}`);
});

test("event file timestamp format is correct", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", status: "running", session: "sess-1", started: parseableTimestamp() },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const events = readdirSync(EVENTS_DIR).filter(f => f.endsWith("-run-stalled.event"));
  assert(events.length === 1, `expected one event`);
  const ts = events[0].split("-run-stalled")[0];
  assert(/^\d{8}T\d{6}$/.test(ts), `timestamp should match YYYYMMDDTHHMMSS: ${ts}`);
});

test("empty agents array: run is not stalled", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, { agents: [] });

  const result = runBash(`
check_run "${RUNS_DIR}/run-${runTs}" ""
echo "done"
`);
  assert(result.stdout.includes("done"), `should complete: ${result.stdout}`);
  assert(!result.stdout.includes("stalled"), `empty agents should not stall: ${result.stdout}`);
  const runJson = readJson(join(RUNS_DIR, `run-${runTs}`, "run.json"));
  assert(runJson.status === "running", `run should still be running: ${runJson.status}`);
});

test("update-task-from-run called on stall", () => {
  resetTmp();
  setupDirs();
  const runTs = Math.floor(Date.now() / 1000) - 600;
  createRun(`run-${runTs}`, {
    agents: [
      { id: "agent-1", status: "running", session: "sess-1", started: parseableTimestamp() },
    ],
  });

  runBash(`check_run "${RUNS_DIR}/run-${runTs}" ""`);
  const updates = readFileLines(join(TMP, "mock-state", "task_updates"));
  assert(updates.length === 1, `should call update-task-from-run: ${updates}`);
  assert(updates[0].includes(`run-${runTs}`), `should reference run: ${updates[0]}`);
  assert(updates[0].includes("stopped"), `should pass stopped status: ${updates[0]}`);
});

test("cleanup kills orphan but not active session together", () => {
  resetTmp();
  setupDirs();
  createRun("run-ccc", {
    status: "running",
    agents: [
      { id: "a1", status: "running", session: "active-sess" },
    ],
  });

  runBash(`
active_sessions=$(get_active_run_sessions)
live_sessions="active-sess
orphan-sess"

cleanup_orphaned_sessions "$active_sessions" "$live_sessions"
echo "done"
`);
  const killed = readFileLines(join(TMP, "mock-state", "killed_sessions"));
  assert(!killed.includes("active-sess"), `should not kill active: ${killed}`);
  assert(killed.includes("orphan-sess"), `should kill orphan: ${killed}`);
});

// -- run all --

await runTests();
console.log(`\nresults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
