#!/usr/bin/env node
import { consumeCompletionLaunchContext } from "@/lib/runner-v2/completion-launch-context";

async function main(): Promise<void> {
  const sessionName = process.argv[2];
  const chainPath = process.argv[3];
  const contextPath = process.argv[4];
  if (!sessionName || !chainPath || !contextPath) {
    console.error("usage: runner-v2-complete <session-name> <chain.json> <context.json>");
    process.exitCode = 64;
    return;
  }
  consumeCompletionLaunchContext(contextPath);
  const { anchorCodeRootEnv } = await import("@/lib/runner-v2/entry-code-root");
  anchorCodeRootEnv(__dirname);
  const { runRunnerV2CompletionEntrypoint } = await import("@/lib/runner-v2/completion-entrypoint");
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
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if ((error as { code?: string })?.code === "RUNNER_V2_COMPLETION_UNSUPPORTED") {
    console.error(`runner-v2 completion unsupported: ${message}`);
    process.exitCode = 64;
    return;
  }
  console.error(`runner-v2 completion failed: ${message}`);
  process.exitCode = 1;
});
