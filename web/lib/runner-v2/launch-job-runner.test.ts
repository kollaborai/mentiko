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

function singleTargetFixture(runId: string) {
  const runDir = mkdtempSync(join(tmpdir(), "routed-launch-phase-restart-"));
  const runJsonPath = join(runDir, "run.json");
  const chainPath = join(runDir, "chain.json");
  writeFileSync(chainPath, JSON.stringify({ id: "phase-recovery", name: "Phase Recovery" }));
  updateRunJson(runJsonPath, () => ({
    ...createRunRecord({ runId, chainName: "phase-recovery", goal: "recover phase" }),
    status: "running",
  }));
  const job = persistRoutedLaunchJob({
    runJsonPath,
    occurrenceId: `${runId}:source:event-1`,
    runId,
    runDir,
    chainPath,
    targetAgentIds: ["writer"],
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
  const attempt = createAgentAttempt({
    runJsonPath,
    runId,
    agentId: "writer",
    leaseId: `workspace-writer-${runId}`,
    launchJobId: job.id,
    launchOccurrenceId: job.occurrenceId,
  });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "queued" });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "lease_acquired" });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });
  bindRoutedLaunchJobAttempt({
    runJsonPath,
    jobId: job.id,
    ownerId: "dead-owner",
    agentId: "writer",
    attemptId: attempt.id,
  });
  return { runDir, runJsonPath, job, attempt };
}

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

  it("reclaims a pre-instruction attempt and starts exactly one replacement attempt", async () => {
    const paths = singleTargetFixture("run-phase-retry");
    const recovered: string[] = [];
    const launched: string[] = [];
    const result = await runRoutedLaunchJob({
      runJsonPath: paths.runJsonPath,
      jobId: paths.job.id,
      ownerId: "restarted-owner",
      dependencies: {
        recoverInterruptedBootstrap: async ({ attempt }) => {
          recovered.push(attempt.id);
          transitionAgentAttempt({
            runJsonPath: paths.runJsonPath,
            attemptId: attempt.id,
            to: "released",
            reason: "launch_coordinator_interrupted",
          });
          return { status: "retry" };
        },
        bootstrap: async (context) => {
          launched.push(context.agentId || "");
          const replacement = createAgentAttempt({
            runJsonPath: paths.runJsonPath,
            runId: paths.job.runId,
            agentId: context.agentId || "",
            leaseId: `workspace-writer-${paths.job.runId}`,
            launchJobId: paths.job.id,
            launchOccurrenceId: paths.job.occurrenceId,
          });
          transitionAgentAttempt({ runJsonPath: paths.runJsonPath, attemptId: replacement.id, to: "queued" });
          transitionAgentAttempt({ runJsonPath: paths.runJsonPath, attemptId: replacement.id, to: "lease_acquired" });
          transitionAgentAttempt({ runJsonPath: paths.runJsonPath, attemptId: replacement.id, to: "pty_allocated" });
          transitionAgentAttempt({ runJsonPath: paths.runJsonPath, attemptId: replacement.id, to: "process_spawned" });
          transitionAgentAttempt({ runJsonPath: paths.runJsonPath, attemptId: replacement.id, to: "ready_for_instructions" });
          transitionAgentAttempt({ runJsonPath: paths.runJsonPath, attemptId: replacement.id, to: "instructions_submitted" });
          return { support: "supported", mode: "typed-plan", sessionName: replacement.leaseId };
        },
      },
    });

    expect(result).toEqual({ status: "completed", jobId: paths.job.id });
    expect(recovered).toEqual([paths.attempt.id]);
    expect(launched).toEqual(["writer"]);
    const attempts = readRunnerV2AttemptState(paths.runJsonPath).attempts;
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.phase)).toEqual(["released", "instructions_submitted"]);
    expect(readRoutedLaunchJob(paths.runJsonPath, paths.job.id)?.targets[0].attemptId).toBe(attempts[1].id);
  });

  it("repairs the monitor for a submitted attempt without launching a duplicate", async () => {
    const paths = singleTargetFixture("run-monitor-repair");
    transitionAgentAttempt({
      runJsonPath: paths.runJsonPath,
      attemptId: paths.attempt.id,
      to: "ready_for_instructions",
    });
    transitionAgentAttempt({
      runJsonPath: paths.runJsonPath,
      attemptId: paths.attempt.id,
      to: "instructions_submitted",
    });
    const recover = jest.fn(async () => ({
      status: "started" as const,
      monitor: "restarted" as const,
    }));
    const bootstrap = jest.fn(async () => {
      throw new Error("must not launch a duplicate");
    });

    const result = await runRoutedLaunchJob({
      runJsonPath: paths.runJsonPath,
      jobId: paths.job.id,
      ownerId: "monitor-repair-owner",
      dependencies: { recoverInterruptedBootstrap: recover, bootstrap },
    });

    expect(result).toEqual({ status: "completed", jobId: paths.job.id });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(readRunnerV2AttemptState(paths.runJsonPath).attempts).toHaveLength(1);
  });

  it("blocks a released ambiguous-delivery attempt instead of falsely completing the job", async () => {
    const paths = singleTargetFixture("run-ambiguous-block");
    transitionAgentAttempt({
      runJsonPath: paths.runJsonPath,
      attemptId: paths.attempt.id,
      to: "human_action_required",
      reason: "instruction_delivery_ambiguous",
      detail: "physical instruction delivery could not be proven",
    });
    transitionAgentAttempt({
      runJsonPath: paths.runJsonPath,
      attemptId: paths.attempt.id,
      to: "released",
      reason: "released",
    });
    const bootstrap = jest.fn(async () => {
      throw new Error("blocked attempt must not relaunch");
    });

    const result = await runRoutedLaunchJob({
      runJsonPath: paths.runJsonPath,
      jobId: paths.job.id,
      ownerId: "ambiguous-owner",
      dependencies: { bootstrap },
    });

    expect(result).toEqual({
      status: "blocked",
      jobId: paths.job.id,
      error: "physical instruction delivery could not be proven",
    });
    expect(bootstrap).not.toHaveBeenCalled();
    expect(readRoutedLaunchJob(paths.runJsonPath, paths.job.id)).toMatchObject({
      status: "blocked",
      lastError: "physical instruction delivery could not be proven",
    });
  });
});
