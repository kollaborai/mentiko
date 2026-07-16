import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
const source = readFileSync(join(root, "lib", "chain-runner.sh"), "utf8");

function localBranch(block) {
  const start = block.indexOf('if [[ "$WORKSPACE_TYPE" == "local" ]]');
  const end = block.indexOf("        else", start);
  return start >= 0 && end > start ? block.slice(start, end) : "";
}

test("chain runner delegates local agent-start provenance to the typed activity capture CLI", () => {
  const start = source.indexOf("# Persist completion-time activity provenance before the agent starts.");
  const end = source.indexOf("# update state before CLI launch", start);
  const launchBlock = source.slice(start, end);
  const localLaunch = localBranch(launchBlock);
  const laterStart = source.indexOf("# The local typed activity-start boundary above owns git-before and started-at");
  const laterEnd = source.indexOf('echo "  agent launched:', laterStart);
  const laterBlock = source.slice(laterStart, laterEnd);
  const localLater = localBranch(laterBlock);

  assert.ok(localLaunch.includes("runner-activity-capture.js"));
  assert.ok(localLaunch.includes('node "$activity_capture_cli" start'));
  for (const value of ["--agent-id \"$agent_id\"", "--run-id \"$RUN_ID\"", "--project-root \"$CHAIN_PROJECT_ROOT\"", "--runs-dir \"$RUNS_DIR\""]) {
    assert.ok(localLaunch.includes(value), `missing typed activity-start arg ${value}`);
  }
  assert.ok(!localLaunch.includes("date -Iseconds"));
  assert.ok(!localLaunch.includes('git -C "$CHAIN_PROJECT_ROOT" rev-parse HEAD'));
  assert.ok(!localLater.includes("date -Iseconds"));
  assert.ok(!localLater.includes('git -C "$CHAIN_PROJECT_ROOT" rev-parse HEAD'));
});
