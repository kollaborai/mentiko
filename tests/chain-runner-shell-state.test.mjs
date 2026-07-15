#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const chainRunner = join(repoRoot, "lib", "chain-runner.sh");
const agentFunctions = join(repoRoot, "lib", "agent-functions.sh");
const errorHandling = join(repoRoot, "lib", "error-handling.sh");
const runspaceManifestClient = join(repoRoot, "lib", "runspace-manifest-client.sh");
const agentStateClient = join(repoRoot, "lib", "agent-state-client.sh");
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

test("chain runner invokes the typed state boundary and delegates completion to runner-v2", () => {
  const runnerSource = readFileSync(chainRunner, "utf8");
  const agentFunctionsSource = readFileSync(agentFunctions, "utf8");
  const errorSource = readFileSync(errorHandling, "utf8");
  const clientSource = readFileSync(agentStateClient, "utf8");

  assert(
    runnerSource.includes("state_start_args=(") && runnerSource.includes('    start'),
    "chain-runner.sh should invoke the typed state start operation through its validated argument vector"
  );
  assert(
    runnerSource.includes('_agent_state_cli "${state_start_args[@]}"'),
    "chain-runner.sh should pass the typed state command as an argv vector"
  );
  assert(clientSource.includes("runner-agent-state.js"), "state client should invoke the compiled typed bundle");
  assert(!clientSource.includes("npx"), "state client must not use a development fallback");
  assert(!runnerSource.includes('cat > "$STATE_DIR/${state_id}.state"'), "chain runner must not write state records in shell");
  assert(!errorSource.includes('grep "^retry_attempt:"'), "error handling must not parse state records in shell");
  assert(agentFunctionsSource.includes("runner-v2-completion-launch.js"), "completion should invoke the compiled typed PTY launcher");
  assert(agentFunctionsSource.includes("runner-v2-completion-launch.cjs"), "completion should retain the typed development PTY launcher");
  assert(!agentFunctionsSource.includes("MENTIKO_AI_GATEWAY_LOCAL_TOKEN="), "completion should not put the gateway token in PTY argv");
  assert(!agentFunctionsSource.includes("chain-runner-complete.sh"), "completion must not invoke the removed shell handler");
  assert(!agentFunctionsSource.includes("complete-agent.sh"), "completion must not invoke the removed standalone shell handler");
  assert(errorSource.includes("_agent_state_cli increment-retry"), "error handling should invoke typed retry mutation");
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
    runnerSource.includes('mark_state_failed "$s_prefix" "${RUN_ID:-}" "$startup_failed_reason"'),
    "chain-runner.sh should mark typed state failed on startup exit"
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

test("runspace manifest creation uses only the compiled typed boundary", () => {
  const source = readFileSync(chainRunner, "utf8");
  const client = readFileSync(runspaceManifestClient, "utf8");
  const runspaceSetup = source.slice(source.indexOf("# runspace:"), source.indexOf("AGENT_COUNT="));

  assert(source.includes('source "$SCRIPT_DIR/runspace-manifest-client.sh"'), "chain runner should load the typed runspace client");
  assert(runspaceSetup.includes("ensure-runspace-manifest --runs-dir"), "runspace setup should invoke the typed manifest operation");
  assert(!runspaceSetup.includes("manifest.json\""), "runspace setup must not write or parse the manifest in shell");
  assert(client.includes("runner-runspace-manifest.js"), "runspace client should invoke the compiled typed bundle");
  assert(!client.includes("npx"), "runspace client must not use a development fallback");
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
  const pointerStart = source.indexOf("build-instruction-pointer()");
  const pointerEnd = source.indexOf("mark_state_blocked()", pointerStart);
  const pointerSource = source.slice(pointerStart, pointerEnd);

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
    pointerSource.includes("Start with a local shell read"),
    "instruction pointer should make shell reads the first path"
  );
  assert(
    pointerSource.includes("cat %q"),
    "instruction pointer should include a CLI-agnostic local shell read"
  );
  assert(
    !pointerSource.includes("cat <<EOF"),
    "instruction pointer must remain one terminal submission, not a multiline heredoc"
  );

  const pointer = runBash(`
    eval "$(sed -n '/^build-instruction-pointer()/,/^}/p' ${JSON.stringify(chainRunner)})"
    build-instruction-pointer "writer" "/tmp/instruction files/writer.md"
  `);
  assert(!pointer.includes("\n"), "instruction pointer output must be one terminal input line");
  assert(pointer.includes("cat /tmp/instruction\\ files/writer.md"), "instruction pointer should carry the exact local instruction path");
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
