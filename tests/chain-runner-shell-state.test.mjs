#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const runLib = join(repoRoot, "lib", "run-lib.sh");
const chainRunner = join(repoRoot, "lib", "chain-runner.sh");
const agentFunctions = join(repoRoot, "lib", "agent-functions.sh");
const errorHandling = join(repoRoot, "lib", "error-handling.sh");
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

test("chain runner scopes shell bootstrap state and delegates completion to runner-v2", () => {
  const runnerSource = readFileSync(chainRunner, "utf8");
  const agentFunctionsSource = readFileSync(agentFunctions, "utf8");
  const errorSource = readFileSync(errorHandling, "utf8");

  assert(
    runnerSource.includes('state_id="$(run-scoped-state-id "$s_prefix" "${RUN_ID:-}")"'),
    "chain-runner.sh should scope agent state by run id"
  );
  assert(agentFunctionsSource.includes("runner-v2-completion-launch.js"), "completion should invoke the compiled typed PTY launcher");
  assert(agentFunctionsSource.includes("runner-v2-completion-launch.cjs"), "completion should retain the typed development PTY launcher");
  assert(!agentFunctionsSource.includes("MENTIKO_AI_GATEWAY_LOCAL_TOKEN="), "completion should not put the gateway token in PTY argv");
  assert(!agentFunctionsSource.includes("chain-runner-complete.sh"), "completion must not invoke the removed shell handler");
  assert(!agentFunctionsSource.includes("complete-agent.sh"), "completion must not invoke the removed standalone shell handler");
  assert(
    errorSource.includes('state_id="$(run-scoped-state-id "$s_prefix" "${RUN_ID:-}")"'),
    "error-handling.sh should resolve the same run-scoped state file"
  );
});

test("chain runner marks startup exits failed before sending instructions", () => {
  const runnerSource = readFileSync(chainRunner, "utf8");
  const activeCheck = 'if ! session_has_active_command "$session"; then';
  const sendInstructions = 'instruction_send_capture="$(send-message "$session_name" "$instruction_pointer")"';

  assert(
    runnerSource.includes("session_has_active_command()"),
    "chain-runner.sh should know how to detect exited startup commands"
  );
  assert(
    runnerSource.includes('mark_state_failed "$STATE_DIR/${state_id}.state" "$startup_failed_reason"'),
    "chain-runner.sh should mark shell state failed on startup exit"
  );
  assert(
    runnerSource.includes('mark_run_agent_failed "${RUN_ID:-}" "$agent_id" "$startup_failed_reason"'),
    "chain-runner.sh should mark run.json failed on startup exit"
  );
  assert(
    runnerSource.indexOf(activeCheck) > -1,
    "chain-runner.sh should check the startup command before instructions"
  );
  assert(
    runnerSource.indexOf(activeCheck) < runnerSource.indexOf(sendInstructions),
    "chain-runner.sh should not paste instructions into a shell after the CLI exits"
  );
});

test("startup blocked and failed state use only the compiled typed Run Record boundary", () => {
  const source = readFileSync(chainRunner, "utf8");
  assert(
    source.includes('_run_record_cli mark-agent-blocked'),
    "blocked startup state should invoke the named typed operation"
  );
  assert(
    source.includes('_run_record_cli mark-agent-failed'),
    "failed startup state should invoke the named typed operation"
  );
  const blocked = source.slice(source.indexOf("mark_run_agent_blocked()"), source.indexOf("mark_run_agent_failed()"));
  const failed = source.slice(source.indexOf("mark_run_agent_failed()"), source.indexOf('echo ""', source.indexOf("mark_run_agent_failed()")));
  assert(!blocked.includes("curl"), "blocked state must not use an HTTP-then-shell fallback");
  assert(!blocked.includes("jq"), "blocked state must not parse or mutate run.json in shell");
  assert(!failed.includes("jq"), "failed state must not parse or mutate run.json in shell");
  assert(!source.includes("_rmw_mark_run_agent_"), "chain runner must not retain shell Run Record writers");
});

test("agent run context exposes the mentiko CLI on PATH", () => {
  const command = `
    set -euo pipefail
    eval "$(sed -n '/^agent_run_context_export_command()/,/^}/p' ${JSON.stringify(chainRunner)})"
    RUN_ID=run-ctx
    EVENTS_DIR="$MENTIKO_GLOBAL_ROOT/events"
    ARTIFACTS_DIR="$MENTIKO_GLOBAL_ROOT/artifacts"
    MENTIKO_SESSION_ID=session-ctx
    MENTIKO_SESSION_TOKEN=token-ctx
    MENTIKO_WEB_URL=http://localhost:3333
    KOLLABOR_ENGINE_URL=http://localhost:4444
    eval "$(agent_run_context_export_command chain-recommender chain-recommendation-complete)"
    printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s' "$MENTIKO_BIN" "$(command -v mentiko)" "$MENTIKO_SESSION_ID" "$MENTIKO_SESSION_TOKEN" "$MENTIKO_WEB_URL" "$KOLLABOR_ENGINE_URL"
  `;
  const lines = runBash(command).split("\n");

  assert(lines[0] === `${repoRoot}/bin/mentiko`, `MENTIKO_BIN should point at repo CLI: ${lines[0]}`);
  assert(lines[1] === `${repoRoot}/bin/mentiko`, `mentiko should resolve from PATH: ${lines[1]}`);
  assert(lines[2] === "session-ctx", `MENTIKO_SESSION_ID should survive run context: ${lines[2]}`);
  assert(lines[3] === "token-ctx", `MENTIKO_SESSION_TOKEN should survive run context: ${lines[3]}`);
  assert(lines[4] === "http://localhost:3333", `MENTIKO_WEB_URL should survive run context: ${lines[4]}`);
  assert(lines[5] === "http://localhost:4444", `KOLLABOR_ENGINE_URL should survive run context: ${lines[5]}`);
  assert(!readFileSync(chainRunner, "utf8").includes("KOLLAB_NO_HUB"), "chain runner should not disable Kollab hub mode");
  assert(!readFileSync(chainRunner, "utf8").includes("KOLLAB_HUB_DISABLED"), "chain runner should not disable Kollab hub mode");
});

test("instruction pointer stays cli agnostic", () => {
  const source = readFileSync(chainRunner, "utf8");

  assert(
    !source.includes("Use Kollab native file_read"),
    "instruction pointer must not hardcode Kollab file-read wording"
  );
  assert(
    !source.includes("Mentiko MCP file tools"),
    "instruction pointer must not hardcode Mentiko MCP file-tool wording"
  );
  assert(
    !source.includes("MENTIKO_SESSION_TOKEN is missing"),
    "instruction pointer must not hardcode token-specific recovery wording"
  );
  assert(
    source.includes("Start with a local shell read"),
    "instruction pointer should make shell reads the first path"
  );
  assert(
    source.includes("cat \"$instruction_file\""),
    "instruction pointer should include a CLI-agnostic shell fallback"
  );
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
