#!/usr/bin/env node
// Keep this import first: routed completion sessions run from the data root.
import "@/lib/runner-v2/entry-code-root-anchor";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import { readRunnerV2AttemptState } from "@/lib/runner-v2/agent-attempt";
import { readRunJson } from "@/lib/runner-v2/run-state";
import { startLaunchCoordinatorHeartbeat } from "@/lib/runner-v2/launch-coordinator-state";

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
  if (process.env.MENTIKO_LAUNCH_COORDINATOR !== "1") {
    await dispatchCoordinator({ chainPath, runDir, runId, agentIds: uniqueAgentIds });
    console.log(JSON.stringify({ status: "launched", runId, agentIds: uniqueAgentIds }));
    return;
  }
  const stopHeartbeat = startLaunchCoordinatorHeartbeat({
    runJsonPath: join(runDir, "run.json"),
    pid: process.pid,
    agentIds: uniqueAgentIds,
  });
  try {
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
      env: {
        ...process.env,
        ...(process.env.AGENT_FAN_GROUP_ID ? { AGENT_FAN_GROUP_AGENT_ID: agentId } : {}),
      },
    })));

    const unsupported = results.find((result) => result.support === "unsupported");
    if (unsupported?.support === "unsupported") throw new Error(unsupported.reason);
    console.log(JSON.stringify({ status: "launched", runId, agentIds: uniqueAgentIds }));
  } finally {
    stopHeartbeat();
  }
}

async function dispatchCoordinator(input: {
  chainPath: string;
  runDir: string;
  runId: string;
  agentIds: string[];
}): Promise<void> {
  const runJsonPath = join(input.runDir, "run.json");
  const before = latestAttemptIds(runJsonPath, input.runId, input.agentIds);
  const coordinator = spawn(process.execPath, [process.argv[1], input.chainPath, ...input.agentIds], {
    detached: true,
    stdio: "inherit",
    env: {
      ...process.env,
      MENTIKO_LAUNCH_COORDINATOR: "1",
    },
  });
  if (!coordinator.pid) throw new Error("could not start routed launch coordinator");
  coordinator.unref();

  const timeoutMs = positiveInteger(process.env.MENTIKO_LAUNCH_QUEUE_ACCEPT_TIMEOUT_MS, 120_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (queuedLaunchAccepted(runJsonPath, input.runId, input.agentIds, before)) return;
    if (coordinator.exitCode !== null) {
      throw new Error(`routed launch coordinator exited before durable queue acceptance (${coordinator.exitCode})`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`routed launch coordinator did not persist queue acceptance within ${timeoutMs}ms`);
}

function latestAttemptIds(runJsonPath: string, runId: string, agentIds: string[]): Map<string, string> {
  const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
  return new Map(agentIds.flatMap((agentId) => {
    const attempt = [...attempts].reverse().find((candidate) =>
      candidate.runId === runId && candidate.agentId === agentId);
    return attempt ? [[agentId, attempt.id]] : [];
  }));
}

function queuedLaunchAccepted(
  runJsonPath: string,
  runId: string,
  agentIds: string[],
  before: Map<string, string>,
): boolean {
  const run = readRunJson(runJsonPath);
  const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
  return agentIds.every((agentId) => {
    const attempt = [...attempts].reverse().find((candidate) =>
      candidate.runId === runId && candidate.agentId === agentId);
    if (!attempt || attempt.id === before.get(agentId) || attempt.phase === "created") return false;
    const agent = (run.agents || []).find((candidate) => candidate.id === agentId);
    return Boolean(agent?.session)
      && (agent?.status === "pending" || agent?.status === "running" || agent?.status === "blocked");
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(`runner-v2 routed launch failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
