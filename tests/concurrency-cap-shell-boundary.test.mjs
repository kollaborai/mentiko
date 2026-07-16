import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "lib", "concurrency-cap.sh"), "utf8");
const chainRunner = readFileSync(join(root, "lib", "chain-runner.sh"), "utf8");
const executableSource = source.replace(/^\s*#.*$/gm, "");

test("concurrency cap is an invocation-only shell boundary", () => {
  assert.match(source, /runner-concurrency-admission\.js/);
  assert.match(source, /wait-chain/);
  assert.match(source, /wait-agent/);
  assert.match(source, /block-agent/);
  assert.match(source, /PTY_CMD/);
  assert.doesNotMatch(source, /cap_wait_for_agent_slot[^\n]*\|\|\s*true/, "invalid typed admission must not be swallowed");
  for (const pattern of [/\bwhile\s+(?:true|\[\[)/, /\bfor\s+(?:\w+\s+)?in\b/, /\bsleep\b/, /\bdate\b/, /\bawk\b/, /\bjq\b/, /\bgrep\b/, /update-run-status/, /transport_list_sessions/]) {
    assert.doesNotMatch(executableSource, pattern, `shell cap must not own admission behavior: ${pattern}`);
  }
  assert.doesNotMatch(chainRunner, /cap_wait_for_agent_slot[^\n]*\|\|\s*true/, "invalid typed admission must not be swallowed");
  assert.match(chainRunner, /cap_wait_exit/);
  const invalidAdmissionBranch = chainRunner.slice(
    chainRunner.indexOf("agent not started: invalid concurrency admission evidence"),
    chainRunner.indexOf("    # create session", chainRunner.indexOf("agent not started: invalid concurrency admission evidence")),
  );
  assert.doesNotMatch(invalidAdmissionBranch, /update-run-(?:agent|status)/, "shell must not own invalid-admission state mutation");
});

test("typed cap command failures are hard failures, not advisory timeouts", () => {
  const probe = `
    source ${JSON.stringify(join(root, "lib", "concurrency-cap.sh"))}
    RUNS_DIR=/tmp
    _cap_admission_cli(){ return 1; }
    cap_wait_for_agent_slot run-1 agent
    printf 'rc=%s\\n' "$?"
  `;
  const output = execFileSync("bash", ["-lc", probe], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /rc=2/);
});

test("invalid typed admission delegates the block mutation to the typed command", () => {
  const probe = `
    source ${JSON.stringify(join(root, "lib", "concurrency-cap.sh"))}
    RUNS_DIR=/tmp/runs
    block_file=$(mktemp)
    _cap_admission_cli(){
      if [[ "$1" == "wait-agent" ]]; then
        printf 'invalid\\n'
        return 0
      fi
      if [[ "$1" == "block-agent" ]]; then
        printf 'block-args=%s\\n' "$*" > "$block_file"
        return 0
      fi
      return 1
    }
    cap_wait_for_agent_slot run-42 writer
    printf 'rc=%s\\n' "$?"
    cat "$block_file"
    rm -f "$block_file"
  `;
  const output = execFileSync("bash", ["-lc", probe], { encoding: "utf8" });
  assert.match(output, /block-args=block-agent --runs-dir \/tmp\/runs --run-id run-42 --agent-id writer/);
  assert.doesNotMatch(output, /--reason/);
  assert.match(output, /rc=2/);
});
