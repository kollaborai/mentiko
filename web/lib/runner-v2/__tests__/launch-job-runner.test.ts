/** @jest-environment node */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentAttempt,
  readRunnerV2AttemptState,
  releaseAgentCapacitySlot,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import {
  enqueueAgentAttempt,
  waitForTypedAgentCapacity,
} from "@/lib/runner-v2/agent-capacity";
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
  it("keeps the launch lease until every sibling settles before requeueing a failed job", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "routed-launch-sibling-failure-"));
    const runJsonPath = join(runDir, "run.json");
    const chainPath = join(runDir, "chain.json");
    writeFileSync(chainPath, JSON.stringify({ id: "siblings", name: "Siblings" }));
    updateRunJson(runJsonPath, () => ({
      ...createRunRecord({ runId: "run-sibling-failure", chainName: "siblings", goal: "join siblings" }),
      status: "running",
    }));
    const job = persistRoutedLaunchJob({
      runJsonPath,
      occurrenceId: "run-sibling-failure:source:event-1",
      runId: "run-sibling-failure",
      runDir,
      chainPath,
      targetAgentIds: ["fast-failure", "slow-success"],
    });
    let releaseSlowTarget!: () => void;
    const slowTargetGate = new Promise<void>((resolve) => {
      releaseSlowTarget = resolve;
    });

    let settled = false;
    const running = runRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "single-owner",
      dependencies: {
        bootstrap: async (context) => {
          if (context.agentId === "fast-failure") throw new Error("fast target failed");
          await slowTargetGate;
          const attempt = createAgentAttempt({
            runJsonPath,
            runId: job.runId,
            agentId: context.agentId || "",
            leaseId: `${context.agentId}-${job.runId}`,
            launchJobId: job.id,
            launchOccurrenceId: job.occurrenceId,
          });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "queued" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "lease_acquired" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "ready_for_instructions" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "instructions_submitted" });
          return { support: "supported", mode: "typed-plan", sessionName: attempt.leaseId };
        },
      },
    });
    void running.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    expect(readRoutedLaunchJob(runJsonPath, job.id)).toMatchObject({
      status: "leased",
      lease: { ownerId: "single-owner" },
    });

    releaseSlowTarget();
    await expect(running).resolves.toEqual({
      status: "requeued",
      jobId: job.id,
      error: "fast target failed",
    });
    expect(readRoutedLaunchJob(runJsonPath, job.id)).toMatchObject({
      status: "queued",
      lastError: "fast target failed",
    });
    expect(readRoutedLaunchJob(runJsonPath, job.id)?.lease).toBeUndefined();
  });

  it("reclaims an expired 30-target coordinator, drains FIFO capacity, and resumes each target exactly once", async () => {
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
      enqueueAgentAttempt({
        runJsonPath,
        attemptId: attempt.id,
        scopeRoot: runDir,
        now: new Date(`2026-08-09T20:00:00.${String(100 + agentIds.indexOf(agentId)).padStart(3, "0")}Z`),
      });
      bindRoutedLaunchJobAttempt({
        runJsonPath,
        jobId: job.id,
        ownerId: "dead-owner",
        agentId,
        attemptId: attempt.id,
      });
    }

    const launched: string[] = [];
    const admissionOrder: string[] = [];
    let maxActive = 0;
    const result = await runRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "restarted-worker",
      dependencies: {
        pid: process.pid,
        leaseMs: 60_000,
        bootstrap: async (context) => {
          const attempt = [...readRunnerV2AttemptState(runJsonPath).attempts]
            .reverse()
            .find((candidate) => candidate.agentId === context.agentId && candidate.launchJobId === job.id)!;
          const admission = await waitForTypedAgentCapacity({
            runJsonPath,
            runId: "run-thirty",
            attemptId: attempt.id,
            cap: 3,
            scopeRoot: runDir,
            launchJobId: job.id,
            launchOwnerId: "restarted-worker",
            maxWaitMs: 10_000,
            pollMs: 1,
            pollMaxMs: 2,
          });
          expect(admission).toMatchObject({ status: "admitted", cap: 3 });
          const agentId = context.agentId || "";
          admissionOrder.push(agentId);
          launched.push(agentId);
          const active = readRunnerV2AttemptState(runJsonPath).attempts.filter((candidate) =>
            candidate.capacitySlotAcquiredAt && !candidate.capacitySlotReleasedAt).length;
          maxActive = Math.max(maxActive, active);
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "ready_for_instructions" });
          transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "instructions_submitted" });
          releaseAgentCapacitySlot({ runJsonPath, attemptId: attempt.id });
          return { support: "supported", mode: "typed-plan", sessionName: attempt.leaseId };
        },
      },
    });

    expect(result).toEqual({ status: "completed", jobId: job.id });
    expect([...launched].sort()).toEqual(agentIds);
    expect(new Set(launched).size).toBe(30);
    expect(admissionOrder).toEqual(agentIds);
    expect(maxActive).toBe(3);
    const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
    expect(attempts).toHaveLength(30);
    expect(attempts.every((attempt) =>
      attempt.phase === "instructions_submitted"
      && attempt.launchJobId === job.id
      && Boolean(attempt.capacitySlotAcquiredAt)
      && Boolean(attempt.capacitySlotReleasedAt))).toBe(true);
    expect(attempts.filter((attempt) =>
      attempt.capacitySlotAcquiredAt && !attempt.capacitySlotReleasedAt)).toHaveLength(0);
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

describe("routing-driven revisit of a terminal-attempt agent", () => {
  it("authorizes one fresh occurrence and bootstraps instead of failing closed (1 -> 2 -> back to 1)", async () => {
    const runId = "run-revisit";
    const runDir = mkdtempSync(join(tmpdir(), "routed-launch-revisit-"));
    const runJsonPath = join(runDir, "run.json");
    const chainPath = join(runDir, "chain.json");
    writeFileSync(chainPath, JSON.stringify({ id: "revisit", name: "Revisit" }));
    updateRunJson(runJsonPath, () => ({
      ...createRunRecord({ runId, chainName: "revisit", goal: "loop" }),
      status: "running",
    }));
    const first = createAgentAttempt({
      runJsonPath,
      runId,
      agentId: "step-one",
      leaseId: `step-one-${runId}`,
    });
    for (const phase of ["queued", "lease_acquired", "pty_allocated", "process_spawned", "ready_for_instructions", "instructions_submitted", "completed"] as const) {
      transitionAgentAttempt({ runJsonPath, attemptId: first.id, to: phase });
    }
    const job = persistRoutedLaunchJob({
      runJsonPath,
      occurrenceId: `${runId}:step-two:two-done`,
      runId,
      runDir,
      chainPath,
      targetAgentIds: ["step-one"],
      now: new Date("2026-10-27T05:00:00.000Z"),
    });
    claimRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "revisit-owner",
      pid: process.pid,
      leaseMs: 60_000,
      now: new Date("2026-10-27T05:00:01.000Z"),
    });

    let bootstrapped = 0;
    const result = await runRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "revisit-owner",
      dependencies: {
        bootstrap: async () => {
          bootstrapped += 1;
          const second = createAgentAttempt({
            runJsonPath,
            runId,
            agentId: "step-one",
            leaseId: `step-one-${runId}-2`,
            launchJobId: job.id,
            launchOccurrenceId: job.occurrenceId,
          });
          for (const phase of ["queued", "lease_acquired", "pty_allocated", "process_spawned", "ready_for_instructions", "instructions_submitted"] as const) {
            transitionAgentAttempt({ runJsonPath, attemptId: second.id, to: phase });
          }
          expect(second.id).not.toBe(first.id);
          return { support: "supported", mode: "typed-plan", sessionName: `step-one-${runId}-2` };
        },
      },
    });
    expect(result).toEqual({ status: "completed", jobId: job.id });
    expect(bootstrapped).toBe(1);
    const run = JSON.parse(readFileSync(runJsonPath, "utf8"));
    const firstUpdatedAt = readRunnerV2AttemptState(runJsonPath).attempts
      .find((attempt) => attempt.id === first.id)!.updatedAt;
    // The authorization is scoped to one agent and one launch-job occurrence,
    // and deliberately is not resumedAt (which the watchdog and reconciler
    // read as a stall-detection grace window).
    expect(run.relaunchAuthorizations).toEqual({
      "step-one": { launchJobId: job.id, authorizedAt: expect.any(String) },
    });
    expect(run.resumedAt).toBeUndefined();
    expect(Date.parse(run.relaunchAuthorizations["step-one"].authorizedAt)).toBeGreaterThan(Date.parse(firstUpdatedAt));
  });

  it("does not bootstrap again when the same launch job id is replayed", async () => {
    const runId = "run-revisit-replay";
    const runDir = mkdtempSync(join(tmpdir(), "routed-launch-revisit-replay-"));
    const runJsonPath = join(runDir, "run.json");
    const chainPath = join(runDir, "chain.json");
    writeFileSync(chainPath, JSON.stringify({ id: "revisit-replay", name: "Revisit Replay" }));
    updateRunJson(runJsonPath, () => ({
      ...createRunRecord({ runId, chainName: "revisit-replay", goal: "loop" }),
      status: "running",
    }));
    const first = createAgentAttempt({
      runJsonPath,
      runId,
      agentId: "step-one",
      leaseId: `step-one-${runId}`,
    });
    for (const phase of ["queued", "lease_acquired", "pty_allocated", "process_spawned", "ready_for_instructions", "instructions_submitted", "completed"] as const) {
      transitionAgentAttempt({ runJsonPath, attemptId: first.id, to: phase });
    }
    const job = persistRoutedLaunchJob({
      runJsonPath,
      occurrenceId: `${runId}:step-two:two-done`,
      runId,
      runDir,
      chainPath,
      targetAgentIds: ["step-one"],
      now: new Date("2026-10-27T05:00:00.000Z"),
    });
    claimRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "replay-owner",
      pid: process.pid,
      leaseMs: 60_000,
      now: new Date("2026-10-27T05:00:01.000Z"),
    });
    const revisit = async () => runRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "replay-owner",
      dependencies: {
        bootstrap: async () => {
          const second = createAgentAttempt({
            runJsonPath,
            runId,
            agentId: "step-one",
            leaseId: `step-one-${runId}-2`,
            launchJobId: job.id,
            launchOccurrenceId: job.occurrenceId,
          });
          for (const phase of ["queued", "lease_acquired", "pty_allocated", "process_spawned", "ready_for_instructions", "instructions_submitted", "completed"] as const) {
            transitionAgentAttempt({ runJsonPath, attemptId: second.id, to: phase });
          }
          return { support: "supported", mode: "typed-plan", sessionName: `step-one-${runId}-2` };
        },
      },
    });

    await revisit();
    const authorizedAt = JSON.parse(readFileSync(runJsonPath, "utf8")).relaunchAuthorizations?.["step-one"]?.authorizedAt;
    expect(authorizedAt).toEqual(expect.any(String));

    // Simulate the replay window: the worker died after the revisit attempt was
    // durably terminal but before the job completed, so the reconciler requeues
    // the SAME job id. It must not bootstrap a third occurrence.
    updateRunJson(runJsonPath, (run) => ({
      ...run!,
      runnerV2: {
        ...run!.runnerV2,
        launchJobs: {
          ...run!.runnerV2?.launchJobs,
          [job.id]: { ...readRoutedLaunchJob(runJsonPath, job.id)!, status: "queued", lease: undefined },
        },
      },
    }));
    const replay = await runRoutedLaunchJob({
      runJsonPath,
      jobId: job.id,
      ownerId: "replay-owner",
      dependencies: {
        bootstrap: async () => {
          throw new Error("replayed job id must not bootstrap again");
        },
      },
    });
    expect(replay).toEqual({ status: "completed", jobId: job.id });
    const run = JSON.parse(readFileSync(runJsonPath, "utf8"));
    expect(run.relaunchAuthorizations["step-one"].authorizedAt).toBe(authorizedAt); // no re-authorization
    expect(readRunnerV2AttemptState(runJsonPath).attempts).toHaveLength(2); // no third occurrence
  });
});
