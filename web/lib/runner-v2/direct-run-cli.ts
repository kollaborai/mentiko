#!/usr/bin/env node
import "@/lib/runner-v2/entry-code-root-anchor";
import { parseDirectRunArgs, runTypedDirect } from "@/lib/runner-v2/direct-run";

async function main(): Promise<void> {
  const result = await runTypedDirect(parseDirectRunArgs(process.argv.slice(2)));
  console.log(JSON.stringify({ status: "launched", runId: result.runId, runDir: result.runDir, agentId: result.agentId, mode: result.launch.mode }));
}

main().catch((error) => {
  console.error(`mentiko typed direct run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
