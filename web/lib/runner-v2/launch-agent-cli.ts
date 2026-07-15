#!/usr/bin/env node
// Keep this import first: routed completion sessions run from the data root.
import "@/lib/runner-v2/entry-code-root-anchor";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";

interface ChainIdentity { id?: string; name?: string }

async function main(): Promise<void> {
  const [chainPath, ...agentIds] = process.argv.slice(2);
  const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID;
  const runDir = process.env.MENTIKO_RUN_DIR;
  if (!chainPath || agentIds.length === 0 || !runId || !runDir) {
    throw new Error("usage: runner-v2-launch-agent <chain.json> <agent-id>... (MENTIKO_RUN_ID and MENTIKO_RUN_DIR required)");
  }

  const chain = JSON.parse(readFileSync(chainPath, "utf8")) as ChainIdentity;
  const uniqueAgentIds = Array.from(new Set(agentIds.filter(Boolean)));
  const results = await Promise.all(uniqueAgentIds.map((agentId) => startRunnerV2Bootstrap({
    chainPath,
    runDir,
    runId,
    agentId,
    chainId: chain.id || basename(chainPath, ".json"),
    chainName: chain.name || chain.id || basename(chainPath, ".json"),
    workspacePath: process.env.MENTIKO_WORKSPACE_PATH,
    taskId: process.env.MENTIKO_TASK_ID,
    debug: process.env.MENTIKO_DEBUG === "1",
    logFd: 2,
    cwd: process.env.MENTIKO_WORKSPACE_PATH || process.cwd(),
    env: process.env,
  })));

  const unsupported = results.find((result) => result.support === "unsupported");
  if (unsupported?.support === "unsupported") throw new Error(unsupported.reason);
  console.log(JSON.stringify({ status: "launched", runId, agentIds: uniqueAgentIds }));
}

main().catch((error) => {
  console.error(`runner-v2 routed launch failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
