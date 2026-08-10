/** @jest-environment node */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentAttempt,
  readRunnerV2AttemptState,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import {
  bindRoutedLaunchJobAttempt,
  claimRoutedLaunchJob,
  persistRoutedLaunchJob,
  readRoutedLaunchJob,
} from "@/lib/runner-v2/launch-job";
import { runRoutedLaunchJob } from "@/lib/runner-v2/launch-job-runner";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

describe("routed launch job crash recovery", () => {
  it("reclaims an expired 30-target coordinator and resumes each queued attempt exactly once", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "routed-launch-restart-"));
    const runJsonPath = join(runDir, "run.json");
    const chainPath = join(runDir, "chain.json");
    const agentIds = Array.from({ length: 30 }, (_, index) => `agent-${String(index + 1).padStart(2, "0")}`);
    writeFileSync(chainPath, JSON.stringify({ id: "thirty", name: "Thirty" }));
    updateRunJson(runJsonPath, () => ({
      ...createRunRecord({ runId: "run-thirty", chainName: "thirty", goal: "resume all" }),
      status: "running",
    }));
    const job = persistRoutedLaunchJob({
      runJsonPath,
      occurrenceId: "run-thirty:source:event-1",
      runId: "run-thirty",
      runDir,
      chainPath,
      targetAgentIds: agentIds,
      now: new Date("2026-08-09T20:00:00.000Z"),
    });
    claimRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "dead-owner",
      pid: 999_999,
      leaseMs: 1_000,
      now: new Date("2026-08-09T20:00:00.000Z"),
    });
    for (const agentId of agentIds) {
      const attempt = createAgentAttempt({
        runJsonPath,
        runId: "run-thirty",
        agentId,
        leaseId: `${agentId}-run-thirty`,
        launchJobId: job.id,
        launchOccurrenceId: job.occurrenceId,
        now: new Date("2026-08-09T20:00:00.100Z"),
      });
      transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "queued" });
      bindRoutedLaunchJobAttempt({
        runJsonPath,
        jobId: job.id,
        ownerId: "dead-owner",
        agentId,
        attemptId: attempt.id,
      });
    }

    const launched: string[] = [];
    const result = await runRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "restarted-worker",
      dependencies: {
        pid: process.pid,
        leaseMs: 60_000,
        bootstrap: async (context) => {
          launched.push(context.agentId || "");
          const attempt = [...readRunnerV2AttemptState(runJsonPath).attempts]
            .reverse()
            .find((candidate) => candidate.agentId === context.agentId && candidate.launchJobId === job.id)!;
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "lease_acquired" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "ready_for_instructions" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "instructions_submitted" });
          return { support: "supported", mode: "typed-plan", sessionName: attempt.leaseId };
        },
      },
    });

    expect(result).toEqual({ status: "completed", jobId: job.id });
    expect(launched.sort()).toEqual(agentIds);
    expect(new Set(launched).size).toBe(30);
    expect(readRunnerV2AttemptState(runJsonPath).attempts).toHaveLength(30);
    expect(readRunnerV2AttemptState(runJsonPath).attempts.every((attempt) =>
      attempt.phase === "instructions_submitted" && attempt.launchJobId === job.id)).toBe(true);
    expect(readRoutedLaunchJob(runJsonPath, job.id)).toMatchObject({
      status: "completed",
      attemptCount: 2,
    });
  });
});
