#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const runLib = join(repoRoot, "lib", "run-lib.sh");
const chainRunner = join(repoRoot, "lib", "chain-runner.sh");
const chainComplete = join(repoRoot, "lib", "chain-runner-complete.sh");
const errorHandling = join(repoRoot, "lib", "error-handling.sh");
const watchdog = join(repoRoot, "lib", "watchdog.sh");
const tmp = mkdtempSync(join(tmpdir(), "mentiko-shell-state-"));

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runBash(script, env = {}) {
  return execFileSync("bash", ["-lc", script], {
    env: {
      ...process.env,
      MENTIKO_GLOBAL_ROOT: tmp,
      MENTIKO_CODE_ROOT: repoRoot,
      NAMESPACE_ID: "default",
      ORG_ID: "default",
      ...env,
    },
    encoding: "utf8",
  }).trim();
}

test("run-scoped-state-id prevents same chain agent from sharing state across runs", () => {
  const first = runBash(`source ${JSON.stringify(runLib)}; RUN_ID=run-111; run-scoped-state-id decision-research-decision-researcher`);
  const second = runBash(`source ${JSON.stringify(runLib)}; RUN_ID=run-222; run-scoped-state-id decision-research-decision-researcher`);

  assert(first !== second, `state ids should differ: ${first} vs ${second}`);
  assert(first.includes("run_111"), `first state id missing run id: ${first}`);
  assert(second.includes("run_222"), `second state id missing run id: ${second}`);
});

test("chain runner and completion handler both use run-scoped state files", () => {
  const runnerSource = readFileSync(chainRunner, "utf8");
  const completeSource = readFileSync(chainComplete, "utf8");
  const errorSource = readFileSync(errorHandling, "utf8");

  assert(
    runnerSource.includes('state_id="$(run-scoped-state-id "$s_prefix" "${RUN_ID:-}")"'),
    "chain-runner.sh should scope agent state by run id"
  );
  assert(
    completeSource.includes('STATE_ID="$(run-scoped-state-id "$SESSION_PREFIX" "${RUN_ID:-}")"'),
    "chain-runner-complete.sh should update the same run-scoped state file"
  );
  assert(
    completeSource.includes('retry_state_file="$STATE_DIR/retry_${STATE_ID}.count"'),
    "completion retry state should be scoped by run"
  );
  assert(
    errorSource.includes('state_id="$(run-scoped-state-id "$s_prefix" "${RUN_ID:-}")"'),
    "error-handling.sh should resolve the same run-scoped state file"
  );
});

test("watchdog does not reap completion sessions as orphans", () => {
  const source = readFileSync(watchdog, "utf8");

  assert(
    source.includes('[[ "$session" == complete-* ]] && continue'),
    "watchdog should skip chain-runner-complete pty sessions"
  );
});

test("agent run context exposes the mentiko CLI on PATH", () => {
  const command = `
    set -euo pipefail
    eval "$(sed -n '/^agent_run_context_export_command()/,/^}/p' ${JSON.stringify(chainRunner)})"
    RUN_ID=run-ctx
    EVENTS_DIR="$MENTIKO_GLOBAL_ROOT/events"
    ARTIFACTS_DIR="$MENTIKO_GLOBAL_ROOT/artifacts"
    eval "$(agent_run_context_export_command chain-recommender chain-recommendation-complete)"
    printf '%s\\n%s' "$MENTIKO_BIN" "$(command -v mentiko)"
  `;
  const lines = runBash(command).split("\n");

  assert(lines[0] === `${repoRoot}/bin/mentiko`, `MENTIKO_BIN should point at repo CLI: ${lines[0]}`);
  assert(lines[1] === `${repoRoot}/bin/mentiko`, `mentiko should resolve from PATH: ${lines[1]}`);
});

for (const item of tests) {
  try {
    item.fn();
    console.log(`  ✔ ${item.name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✖ ${item.name}`);
    console.log(`    ${err.message}`);
    failed += 1;
  }
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
