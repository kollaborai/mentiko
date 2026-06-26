#!/usr/bin/env node
import { runRunnerV2CompletionEntrypoint, RunnerV2CompletionUnsupportedError } from "@/lib/runner-v2/completion-entrypoint";

const sessionName = process.argv[2];
const chainPath = process.argv[3];

if (!sessionName || !chainPath) {
  console.error("usage: runner-v2-complete <session-name> <chain.json>");
  process.exit(64);
}

try {
  const result = runRunnerV2CompletionEntrypoint({
    sessionName,
    chainPath,
    dryRun: process.env.MENTIKO_RUNNER_V2_COMPLETION_DRY_RUN === "1",
  });
  console.log(JSON.stringify({
    status: result.status,
    runId: result.runId,
    agentId: result.agentId,
    decision: result.decision,
    effectsApplied: result.adapter.effectsApplied,
    launchesStarted: result.adapter.launchesStarted.length,
    runJsonPath: result.runJsonPath,
  }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RunnerV2CompletionUnsupportedError) {
    console.error(`runner-v2 completion unsupported: ${message}`);
    process.exit(64);
  }
  console.error(`runner-v2 completion failed: ${message}`);
  process.exit(1);
}
