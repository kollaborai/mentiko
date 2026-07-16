#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import config from "@/lib/config";
import { launchExistingTypedRun, parseExistingRunLaunchArgs } from "@/lib/runner-v2/existing-run-launch";

async function main(): Promise<void> {
  const result = await launchExistingTypedRun({ ...parseExistingRunLaunchArgs(process.argv.slice(2)), runsDir: config.runsDir, env: process.env });
  if (result.launch.support !== "supported") throw new Error(result.launch.reason);
  console.log(JSON.stringify({ status: "launched", runId: result.runId, runDir: result.runDir, agentId: result.agentId, mode: result.launch.mode }));
}

main().catch((error) => {
  console.error(`typed existing-run launch failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
