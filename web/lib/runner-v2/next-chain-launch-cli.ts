#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import { runTypedDirect } from "@/lib/runner-v2/direct-run";
import { parseNextChainLaunchArgs } from "@/lib/runner-v2/next-chain-launch";

async function main(): Promise<void> {
  const input = parseNextChainLaunchArgs(process.argv.slice(2));
  const result = await runTypedDirect({
    chainPath: input.chainPath,
    parentRunId: input.parentRunId,
    runsDir: input.runsDir,
    debug: false,
  });
  if (result.launch.support !== "supported") throw new Error(result.launch.reason);
  console.log(JSON.stringify({ status: "launched", runId: result.runId, runDir: result.runDir, agentId: result.agentId, mode: result.launch.mode }));
}

main().catch((error) => {
  console.error(`typed next-chain launch failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
