#!/usr/bin/env node
// Keep this import first: routed completion sessions run from the data root.
import "@/lib/runner-v2/entry-code-root-anchor";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  persistRoutedLaunchJob,
  routedLaunchJobId,
} from "@/lib/runner-v2/launch-job";
import { runRoutedLaunchJob } from "@/lib/runner-v2/launch-job-runner";

async function main(): Promise<void> {
  const [chainPath, ...requestedAgentIds] = process.argv.slice(2);
  const runId = process.env.MENTIKO_RUN_ID || process.env.RUN_ID;
  const runDir = process.env.MENTIKO_RUN_DIR;
  const occurrenceId = process.env.MENTIKO_COMPLETION_OCCURRENCE_ID;
  if (!chainPath || requestedAgentIds.length === 0 || !runId || !runDir || !occurrenceId) {
    throw new Error(
      "usage: runner-v2-launch-agent <chain.json> <agent-id>... "
      + "(MENTIKO_RUN_ID, MENTIKO_RUN_DIR, and MENTIKO_COMPLETION_OCCURRENCE_ID required)",
    );
  }

  const allAgentIds = configuredAgentIds(requestedAgentIds);
  const jobId = process.env.MENTIKO_LAUNCH_JOB_ID || routedLaunchJobId({
    occurrenceId,
    runId,
    targetAgentIds: allAgentIds,
  });
  const runJsonPath = join(runDir, "run.json");
  if (process.env.MENTIKO_LAUNCH_COORDINATOR !== "1") {
    const job = persistRoutedLaunchJob({
      runJsonPath,
      jobId,
      occurrenceId,
      runId,
      runDir,
      chainPath,
      targetAgentIds: allAgentIds,
      environment: process.env,
    });
    dispatchCoordinator({ chainPath, jobId: job.id, agentIds: allAgentIds });
    console.log(JSON.stringify({ status: "queued", runId, jobId: job.id, agentIds: allAgentIds }));
    return;
  }

  const ownerId = process.env.MENTIKO_LAUNCH_JOB_OWNER_ID
    || `coordinator:${process.pid}:${randomUUID()}`;
  const result = await runRoutedLaunchJob({ runJsonPath, jobId, ownerId });
  if (result.status === "requeued") {
    throw new Error(result.error || `routed launch job ${jobId} was requeued`);
  }
  console.log(JSON.stringify({ status: result.status, runId, jobId, agentIds: allAgentIds }));
}

function dispatchCoordinator(input: {
  chainPath: string;
  jobId: string;
  agentIds: string[];
}): void {
  const coordinator = spawn(process.execPath, [process.argv[1], input.chainPath, ...input.agentIds], {
    detached: true,
    stdio: "inherit",
    env: {
      ...process.env,
      MENTIKO_LAUNCH_COORDINATOR: "1",
      MENTIKO_LAUNCH_JOB_ID: input.jobId,
      MENTIKO_LAUNCH_JOB_TARGETS: JSON.stringify(input.agentIds),
    },
  });
  if (!coordinator.pid) {
    // The job is already durable and the background worker can reclaim it.
    console.error(`[runner-v2] immediate launch coordinator did not start; job ${input.jobId} remains queued`);
    return;
  }
  coordinator.unref();
}

function configuredAgentIds(requestedAgentIds: string[]): string[] {
  const configured = process.env.MENTIKO_LAUNCH_JOB_TARGETS;
  let values = requestedAgentIds;
  if (configured) {
    const parsed = JSON.parse(configured) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string" && value)) {
      throw new Error("MENTIKO_LAUNCH_JOB_TARGETS must be a non-empty JSON string array");
    }
    values = parsed;
  }
  const normalized = Array.from(new Set(values.filter(Boolean))).sort();
  if (normalized.length === 0) throw new Error("routed launch job requires at least one target");
  for (const requested of requestedAgentIds) {
    if (!normalized.includes(requested)) {
      throw new Error(`requested target ${requested} is absent from the routed launch job`);
    }
  }
  return normalized;
}

main().catch((error) => {
  console.error(`runner-v2 routed launch failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
