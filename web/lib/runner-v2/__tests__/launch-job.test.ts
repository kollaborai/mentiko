/** @jest-environment node */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindRoutedLaunchJobAttempt,
  claimRoutedLaunchJob,
  completeRoutedLaunchJob,
  acceptedResumeTerminalJob,
  blockPastBoundResumeLaunchJob,
  persistRoutedLaunchJob,
  readRoutedLaunchJob,
  routedLaunchJobId,
  routedLaunchJobLeaseOwned,
  upsertRoutedLaunchJobRecord,
  type RoutedLaunchJob,
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

// ---- accepted resume dispatch expiry scope (#142 round 4) ----

describe("blockPastBoundResumeLaunchJob blocks only the accepted attempt's bound job", () => {
  const NOW = new Date("2026-11-16T12:00:00.000Z");
  const OLD = new Date(NOW.getTime() - 11 * 60_000).toISOString(); // past the 10-minute bound

  interface SeedInput {
    resumeAttempt?: Record<string, unknown>;
    resumeJob?: { createdAt?: string; status?: "queued" | "leased"; lease?: RoutedLaunchJob["lease"] };
    unrelatedJob?: { createdAt?: string; status?: "queued" | "leased"; lease?: RoutedLaunchJob["lease"] };
  }

  function seedRun(seed: SeedInput): { run: ReturnType<typeof createRunRecord>; resumeJobId: string; unrelatedJobId: string } {
    const paths = fixture();
    let run = createRunRecord({ runId: "run-scope", chainName: "chain", goal: "scope" });
    run = { ...run, status: "running", agents: [{ id: "editor", name: "Editor", status: "pending", session: "" }] };
    const resumeUpsert = upsertRoutedLaunchJobRecord(run, {
      occurrenceId: "resume:run-scope:1",
      runId: "run-scope",
      runDir: paths.runDir,
      chainPath: paths.chainPath,
      targetAgentIds: ["editor"],
      environment: { NAMESPACE_ID: "default" },
      now: new Date(seed.resumeJob?.createdAt || OLD),
    });
    const unrelatedUpsert = upsertRoutedLaunchJobRecord(resumeUpsert.run, {
      occurrenceId: "completion:run-scope:2",
      runId: "run-scope",
      runDir: paths.runDir,
      chainPath: paths.chainPath,
      targetAgentIds: ["editor"],
      environment: { NAMESPACE_ID: "default" },
      now: new Date(seed.unrelatedJob?.createdAt || OLD),
    });
    const resumeJobId = resumeUpsert.job.id;
    const unrelatedJobId = unrelatedUpsert.job.id;
    return { run: unrelatedUpsert.run as ReturnType<typeof createRunRecord>, resumeJobId, unrelatedJobId };
  }

  function withJob(run: Record<string, unknown>, jobId: string, overrides: { status?: RoutedLaunchJob["status"]; lease?: RoutedLaunchJob["lease"] }): Record<string, unknown> {
    const record = JSON.parse(JSON.stringify(run)) as {
      runnerV2: { launchJobs: Record<string, RoutedLaunchJob> };
    };
    record.runnerV2.launchJobs[jobId] = {
      ...record.runnerV2.launchJobs[jobId],
      ...(overrides.status ? { status: overrides.status } : {}),
      ...(overrides.lease ? { lease: overrides.lease } : {}),
    };
    return record;
  }

  it("blocks ONLY the bound job past its bound with the typed code and never stops the run", () => {
    const { run, resumeJobId, unrelatedJobId } = seedRun({
      unrelatedJob: { createdAt: new Date(NOW.getTime() - 60_000).toISOString() },
    });
    const record = JSON.parse(JSON.stringify(run)) as Record<string, unknown>;
    const bound = { ...record, resumeAttempt: { id: "a1", series: 0, outcome: "accepted", launchJobId: resumeJobId } };
    const next = blockPastBoundResumeLaunchJob(bound as never, { now: NOW });
    expect(next).toBeDefined();
    // the fold never decides the run stop: only the reaper, which knows the live sessions
    expect(next!.status).toBe("running");
    const jobs = (next!.runnerV2 as { launchJobs: Record<string, RoutedLaunchJob> }).launchJobs;
    expect(jobs[resumeJobId].status).toBe("blocked");
    expect(jobs[resumeJobId].terminalCode).toBe("resume_dispatch_bound");
    expect(jobs[unrelatedJobId].status).toBe("queued");
    expect(acceptedResumeTerminalJob(next as never)).toMatchObject({ jobId: resumeJobId, code: "resume_dispatch_bound" });
    // idempotent: a blocked job is no longer past the bound
    expect(blockPastBoundResumeLaunchJob(next as never, { now: NOW })).toBeUndefined();
  });

  it("an old UNRELATED queued job is not blocked", () => {
    const { run, resumeJobId } = seedRun({
      resumeJob: { createdAt: new Date(NOW.getTime() - 60_000).toISOString() },
    });
    const bound = { ...run, resumeAttempt: { id: "a1", series: 0, outcome: "accepted", launchJobId: resumeJobId } };
    expect(blockPastBoundResumeLaunchJob(bound as never, { now: NOW })).toBeUndefined();
    expect(acceptedResumeTerminalJob(bound as never)).toBeUndefined();
  });

  it("an accepted record with NO bound job id (older head) is left alone", () => {
    const { run } = seedRun({});
    const unbound = { ...run, resumeAttempt: { id: "a1", series: 0, outcome: "accepted" } };
    expect(blockPastBoundResumeLaunchJob(unbound as never, { now: NOW })).toBeUndefined();
    expect(acceptedResumeTerminalJob(unbound as never)).toBeUndefined();
  });

  it("a bound job with an unexpired lease is never past the bound, however old", () => {
    const { run, resumeJobId } = seedRun({});
    const leased = withJob(run, resumeJobId, {
      status: "leased",
      lease: {
        ownerId: "worker:1:x",
        acquiredAt: OLD,
        heartbeatAt: OLD,
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    });
    const bound = { ...leased, resumeAttempt: { id: "a1", series: 0, outcome: "accepted", launchJobId: resumeJobId } };
    expect(blockPastBoundResumeLaunchJob(bound as never, { now: NOW })).toBeUndefined();
  });

  it("another job's lease does not defer the bound job's block (no endless deferral)", () => {
    const { run, resumeJobId, unrelatedJobId } = seedRun({});
    const leased = withJob(run, unrelatedJobId, {
      status: "leased",
      lease: {
        ownerId: "worker:1:x",
        acquiredAt: OLD,
        heartbeatAt: OLD,
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    });
    const bound = { ...leased, resumeAttempt: { id: "a1", series: 0, outcome: "accepted", launchJobId: resumeJobId } };
    const next = blockPastBoundResumeLaunchJob(bound as never, { now: NOW });
    const jobs = (next!.runnerV2 as { launchJobs: Record<string, RoutedLaunchJob> }).launchJobs;
    expect(jobs[resumeJobId].status).toBe("blocked");
    expect(jobs[unrelatedJobId].status).toBe("leased");
  });

  it("the terminal signal needs the typed code: a bound job blocked without one is not terminal", () => {
    const { run, resumeJobId } = seedRun({});
    const blocked = withJob(run, resumeJobId, { status: "blocked" });
    const bound = { ...blocked, resumeAttempt: { id: "a1", series: 0, outcome: "accepted", launchJobId: resumeJobId } };
    expect(acceptedResumeTerminalJob(bound as never)).toBeUndefined();
  });
});
