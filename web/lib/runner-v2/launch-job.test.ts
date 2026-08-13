/** @jest-environment node */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindRoutedLaunchJobAttempt,
  claimRoutedLaunchJob,
  completeRoutedLaunchJob,
  persistRoutedLaunchJob,
  readRoutedLaunchJob,
  routedLaunchJobId,
  routedLaunchJobLeaseOwned,
} from "@/lib/runner-v2/launch-job";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

function fixture() {
  const runDir = mkdtempSync(join(tmpdir(), "routed-launch-job-"));
  const runJsonPath = join(runDir, "run.json");
  const chainPath = join(runDir, "chain.json");
  writeFileSync(chainPath, JSON.stringify({ id: "chain" }));
  updateRunJson(runJsonPath, () => createRunRecord({
    runId: "run-job",
    chainName: "chain",
    goal: "launch safely",
  }));
  return { runDir, runJsonPath, chainPath };
}

describe("durable routed launch jobs", () => {
  it("persists one occurrence-bound job without persisting secret environment values", () => {
    const paths = fixture();
    const input = {
      ...paths,
      occurrenceId: "run-job:writer:event-1",
      runId: "run-job",
      targetAgentIds: ["editor", "reviewer", "editor"],
      environment: {
        MENTIKO_WORKSPACE_PATH: "/workspace/repo",
        MENTIKO_MAX_ACTIVE_AGENTS: "3",
        ANTHROPIC_API_KEY: "must-not-persist",
      },
      now: new Date("2026-08-09T20:00:00.000Z"),
    };
    const first = persistRoutedLaunchJob(input);
    const second = persistRoutedLaunchJob(input);

    expect(second).toEqual(first);
    expect(first.id).toBe(routedLaunchJobId({
      occurrenceId: input.occurrenceId,
      runId: input.runId,
      targetAgentIds: ["editor", "reviewer"],
    }));
    expect(first.targets).toEqual([{ agentId: "editor" }, { agentId: "reviewer" }]);
    expect(first.environment).toEqual({
      MENTIKO_MAX_ACTIVE_AGENTS: "3",
      MENTIKO_WORKSPACE_PATH: "/workspace/repo",
    });
  });

  it("fences a live lease, reclaims it after expiry, and binds exact target attempts", () => {
    const paths = fixture();
    const job = persistRoutedLaunchJob({
      ...paths,
      occurrenceId: "occurrence-1",
      runId: "run-job",
      targetAgentIds: ["editor"],
      now: new Date("2026-08-09T20:00:00.000Z"),
    });
    expect(claimRoutedLaunchJob({
      runJsonPath: paths.runJsonPath,
      jobId: job.id,
      ownerId: "owner-a",
      leaseMs: 1_000,
      now: new Date("2026-08-09T20:00:00.000Z"),
    })).toMatchObject({ status: "leased", lease: { ownerId: "owner-a" } });
    expect(claimRoutedLaunchJob({
      runJsonPath: paths.runJsonPath,
      jobId: job.id,
      ownerId: "owner-b",
      leaseMs: 1_000,
      now: new Date("2026-08-09T20:00:00.500Z"),
    })).toBeUndefined();
    expect(claimRoutedLaunchJob({
      runJsonPath: paths.runJsonPath,
      jobId: job.id,
      ownerId: "owner-b",
      leaseMs: 1_000,
      now: new Date("2026-08-09T20:00:01.001Z"),
    })).toMatchObject({ status: "leased", lease: { ownerId: "owner-b" }, attemptCount: 2 });
    expect(routedLaunchJobLeaseOwned({
      runJsonPath: paths.runJsonPath,
      jobId: job.id,
      ownerId: "owner-a",
      now: new Date("2026-08-09T20:00:01.100Z"),
    })).toBe(false);

    bindRoutedLaunchJobAttempt({
      runJsonPath: paths.runJsonPath,
      jobId: job.id,
      ownerId: "owner-b",
      agentId: "editor",
      attemptId: "run-job:editor:1",
      now: new Date("2026-08-09T20:00:01.100Z"),
    });
    expect(completeRoutedLaunchJob({
      runJsonPath: paths.runJsonPath,
      jobId: job.id,
      ownerId: "owner-b",
      now: new Date("2026-08-09T20:00:01.200Z"),
    })).toBe(true);
    expect(readRoutedLaunchJob(paths.runJsonPath, job.id)).toMatchObject({
      status: "completed",
      targets: [{ agentId: "editor", attemptId: "run-job:editor:1" }],
    });
  });
});
