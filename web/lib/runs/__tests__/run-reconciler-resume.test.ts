/**
 * @jest-environment node
 *
 * Issue #142 round 2: the reaper decides against the CURRENT run record under
 * the run.json lock. It cannot erase a resume acceptance that landed while it
 * was scanning, cannot stop a run out from under a queued/worker-claimed
 * resume launch job, and leaves a preparing resume attempt entirely alone.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    namespaceId: "default",
    orgId: "default",
    runsDir: "/tmp/mentiko-reaper-142-test/runs",
    eventsDir: "/tmp/mentiko-reaper-142-test/events",
    globalRoot: "/tmp/mentiko-reaper-142-test",
  },
}));

jest.mock("@/lib/system/system-logger", () => ({
  writeLog: () => undefined,
}));

let mockLiveSessions: Set<string> = new Set();
let onLiveSessionsCall: (() => void) | undefined;
jest.mock("@/lib/pty/pty-client", () => ({
  getLiveSessions: async () => {
    onLiveSessionsCall?.();
    return mockLiveSessions;
  },
}));

// Injection seam for the acceptance race: fires between the reaper's tolerant
// per-run read and its LOCKED fold (updateRunJsonRecord), which is the window
// the round-2 fix exists for — an acceptance landing in that gap must survive.
let onBeforeLockedFold: ((runJsonPath: string) => void) | undefined;
jest.mock("@/lib/runner-v2/run-state", () => {
  const actual = jest.requireActual("@/lib/runner-v2/run-state");
  return {
    ...actual,
    updateRunJsonRecord: (runJsonPath: string, update: (record: unknown) => unknown) => {
      onBeforeLockedFold?.(runJsonPath);
      return actual.updateRunJsonRecord(runJsonPath, update);
    },
  };
});

import { reconcileOrphanedRuns } from "@/lib/runs/run-reconciler";
import { upsertRoutedLaunchJobRecord } from "@/lib/runner-v2/launch-job";
import { closeAll, taskCreate, taskGet } from "@/lib/tasks/task-store";

const TEST_ROOT = "/tmp/mentiko-reaper-142-test";
const RUNS = join(TEST_ROOT, "runs");

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function writeRun(runId: string, record: Record<string, unknown>): string {
  const runDir = join(RUNS, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify(record, null, 2));
  return runDir;
}

function readRun(runId: string): Record<string, any> {
  return JSON.parse(readFileSync(join(RUNS, runId, "run.json"), "utf8"));
}

/** An old, session-less running run: the classic orphan shape. */
function orphanShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "unused",
    chain: "Release Review",
    goal: "g",
    started: isoAgo(60 * 60_000),
    status: "running",
    agents: [{ id: "reviewer", name: "Reviewer", status: "running", session: "dead-session" }],
    ...overrides,
  };
}

function queuedJobRun(runId: string, runDir: string, base: Record<string, unknown>): Record<string, unknown> {
  const withJob = upsertRoutedLaunchJobRecord(base as never, {
    occurrenceId: `resume:${runId}:1780000000000`,
    runId,
    runDir,
    chainPath: join(runDir, "chain.json"),
    targetAgentIds: ["reviewer"],
    environment: { NAMESPACE_ID: "default", ORG_ID: "default" },
  });
  return withJob.run as unknown as Record<string, unknown>;
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(RUNS, { recursive: true });
  mockLiveSessions = new Set();
  onLiveSessionsCall = undefined;
  onBeforeLockedFold = undefined;
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  closeAll();
});

describe("reconcileOrphanedRuns vs route-owned resume work", () => {
  it("still stops a genuinely orphaned run without resume work (control)", async () => {
    writeRun("run-orph", orphanShape());
    const result = await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });
    expect(result.orphaned).toBe(1);
    expect(readRun("run-orph").status).toBe("stopped");
  });

  it("does not stop a run out from under a queued resume launch job, and preserves the accepted attempt", async () => {
    const runDir = join(RUNS, "run-job");
    const accepted = orphanShape({
      id: "run-job",
      resumeAttempt: { id: "a1", series: 0, outcome: "accepted", automatic: true, updatedAt: isoAgo(10 * 60_000) },
      resumedAt: isoAgo(10 * 60_000), // past the 2-minute resume grace
    });
    writeRun("run-job", queuedJobRun("run-job", runDir, accepted));

    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    const record = readRun("run-job");
    expect(record.status).toBe("running");
    expect(record.resumeAttempt.outcome).toBe("accepted");
    const jobs = Object.values(record.runnerV2.launchJobs) as Array<Record<string, any>>;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("queued");
  });

  it("does not stop a run whose resume launch job is leased by a live worker claim", async () => {
    const runDir = join(RUNS, "run-leased");
    const base = queuedJobRun("run-leased", runDir, orphanShape({
      id: "run-leased",
      resumeAttempt: { id: "a1", series: 0, outcome: "accepted", automatic: true, updatedAt: isoAgo(10 * 60_000) },
      resumedAt: isoAgo(10 * 60_000),
    }));
    // lease the job: unexpired
    const jobId = Object.keys((base.runnerV2 as any).launchJobs)[0];
    (base.runnerV2 as any).launchJobs[jobId] = {
      ...(base.runnerV2 as any).launchJobs[jobId],
      status: "leased",
      lease: {
        ownerId: "worker:1:x",
        acquiredAt: isoAgo(5_000),
        heartbeatAt: isoAgo(1_000),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    writeRun("run-leased", base);

    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    const record = readRun("run-leased");
    expect(record.status).toBe("running");
    expect((Object.values(record.runnerV2.launchJobs) as Array<Record<string, any>>)[0].status).toBe("leased");
  });

  it("an EXPIRED lease no longer protects the run, but the attempt and job records are never removed", async () => {
    const runDir = join(RUNS, "run-expired");
    const base = queuedJobRun("run-expired", runDir, orphanShape({
      id: "run-expired",
      resumeAttempt: { id: "a1", series: 0, outcome: "accepted", automatic: true, updatedAt: isoAgo(10 * 60_000) },
      resumedAt: isoAgo(10 * 60_000),
    }));
    const jobId = Object.keys((base.runnerV2 as any).launchJobs)[0];
    (base.runnerV2 as any).launchJobs[jobId] = {
      ...(base.runnerV2 as any).launchJobs[jobId],
      status: "leased",
      lease: {
        ownerId: "worker:dead:x",
        acquiredAt: isoAgo(600_000),
        heartbeatAt: isoAgo(600_000),
        expiresAt: isoAgo(300_000),
      },
    };
    writeRun("run-expired", base);

    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    const record = readRun("run-expired");
    expect(record.status).toBe("stopped");
    // the durable recovery evidence survived the stop
    expect(record.resumeAttempt.outcome).toBe("accepted");
    expect((Object.values(record.runnerV2.launchJobs) as Array<Record<string, any>>)[0].status).toBe("leased");
  });

  it("leaves a preparing resume attempt entirely alone (a resume is in flight under its claim)", async () => {
    writeRun("run-prep", orphanShape({
      id: "run-prep",
      resumeAttempt: { id: "a1", series: 0, outcome: "preparing", automatic: true, updatedAt: isoAgo(1_000) },
    }));

    const result = await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    expect(result.orphaned).toBe(0);
    const record = readRun("run-prep");
    expect(record.status).toBe("running");
    expect(record.resumeAttempt.outcome).toBe("preparing");
  });

  it("an acceptance that lands between the reaper's STALE READ and its LOCKED FOLD cannot be erased or stopped", async () => {
    // The round-2 race window: the reaper has already done its tolerant
    // per-run read (a session-less orphan), and the resume acceptance lands
    // right before the run's locked mutation. Deciding from the pre-read
    // snapshot (the old whole-snapshot write) would stop the run and drop the
    // accepted attempt and queued job the reaper never saw; the locked fold
    // must re-read and leave the accepted work alone.
    writeRun("run-race", orphanShape({ id: "run-race" }));
    onBeforeLockedFold = (runJsonPath) => {
      if (!runJsonPath.includes("run-race")) return;
      onBeforeLockedFold = undefined; // fire exactly once, for this run's fold
      const runDir = join(RUNS, "run-race");
      const accepted = orphanShape({
        id: "run-race",
        resumeAttempt: { id: "a1", series: 0, outcome: "accepted", automatic: true, updatedAt: new Date().toISOString() },
        resumedAt: new Date().toISOString(),
      });
      writeRun("run-race", queuedJobRun("run-race", runDir, accepted));
    };

    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    const record = readRun("run-race");
    expect(record.status).toBe("running");
    expect(record.resumeAttempt.outcome).toBe("accepted");
    expect((Object.values(record.runnerV2.launchJobs) as Array<Record<string, any>>)[0].status).toBe("queued");
  });

  // ---- dispatch-bound liveness (#142 round 3) ----

  function seedTaskForRun(runId: string, metadata: Record<string, unknown> = {}): string {
    return taskCreate("default", {
      title: "dispatch bound",
      issue_type: "task",
      metadata: {
        auto_run: true,
        chain_id: "release-review",
        last_run_id: runId,
        last_run_status: "running",
        ...metadata,
      },
    }, "default").id;
  }

  function neverClaimedJobRun(runId: string, runDir: string, taskId: string): Record<string, unknown> {
    const base = orphanShape({
      id: runId,
      taskId,
      resumeAttempt: { id: "a1", series: 3, outcome: "accepted", automatic: true, updatedAt: isoAgo(11 * 60_000) },
      resumedAt: isoAgo(11 * 60_000), // past the 2-minute resume grace
    });
    const withJob = upsertRoutedLaunchJobRecord(base as never, {
      occurrenceId: `resume:${runId}:1780000000000`,
      runId,
      runDir,
      chainPath: join(runDir, "chain.json"),
      targetAgentIds: ["reviewer"],
      environment: { NAMESPACE_ID: "default", ORG_ID: "default" },
    });
    const record = withJob.run as unknown as Record<string, unknown>;
    // the job has sat queued, never claimed, past the 10-minute dispatch bound
    const jobId = Object.keys((record.runnerV2 as any).launchJobs)[0];
    (record.runnerV2 as any).launchJobs[jobId].createdAt = isoAgo(11 * 60_000);
    return record;
  }

  it("a never-claimed accepted job past the dispatch bound: run stopped with a reaper reason, job blocked, task paused without a debit", async () => {
    const runDir = join(RUNS, "run-bound");
    const taskId = seedTaskForRun("run-bound", { resume_series: 3 });
    writeRun("run-bound", neverClaimedJobRun("run-bound", runDir, taskId));

    const result = await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    const record = readRun("run-bound");
    expect(record.status).toBe("stopped");
    expect(record.statusReason).toEqual({
      actor: "reaper",
      reason: "accepted resume launch job exceeded its dispatch bound",
    });
    const job = (Object.values(record.runnerV2.launchJobs) as Array<Record<string, any>>)[0];
    expect(job.status).toBe("blocked");
    expect(job.lastError).toContain("dispatch bound");
    expect(cleanedOrStopped(result, "run-bound")).toBe(true);

    // the owner sees WHY: guarded operational pause, series/run fenced, no debit
    const task = taskGet("default", taskId, "default")!;
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.auto_run_paused).toBe(true);
    expect(metadata.auto_run_paused_reason).toContain("dispatch bound");
    expect(metadata.auto_run_retries).toBeUndefined();

    // idempotent pause: a second scan may fix stale agent statuses, but the
    // pause itself never rewrites (reason identical, still paused)
    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });
    expect(readRun("run-bound").status).toBe("stopped");
    const taskAfter = taskGet("default", taskId, "default")!;
    const metadataAfter = taskAfter.metadata as Record<string, unknown>;
    expect(metadataAfter.auto_run_paused).toBe(true);
    expect(metadataAfter.auto_run_paused_reason).toBe(metadata.auto_run_paused_reason);
  });

  it("a never-claimed accepted job INSIDE the bound is left alone", async () => {
    const runDir = join(RUNS, "run-young");
    const taskId = seedTaskForRun("run-young", {});
    const record = neverClaimedJobRun("run-young", runDir, taskId);
    const jobId = Object.keys((record.runnerV2 as any).launchJobs)[0];
    (record.runnerV2 as any).launchJobs[jobId].createdAt = isoAgo(60_000); // young
    writeRun("run-young", record);

    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    const after = readRun("run-young");
    expect(after.status).toBe("running");
    expect((Object.values(after.runnerV2.launchJobs) as Array<Record<string, any>>)[0].status).toBe("queued");
    const task = taskGet("default", taskId, "default")!;
    expect((task.metadata as Record<string, unknown>).auto_run_paused).toBeUndefined();
  });

  it("a run the WORKER already stopped for the bound still gets its guarded task pause on the next scan", async () => {
    const runDir = join(RUNS, "run-worker-stopped");
    const taskId = seedTaskForRun("run-worker-stopped", { resume_series: 3 });
    const record = neverClaimedJobRun("run-worker-stopped", runDir, taskId);
    record.status = "stopped";
    record.statusReason = { actor: "reaper", reason: "accepted resume launch job exceeded its dispatch bound" };
    const jobId = Object.keys((record.runnerV2 as any).launchJobs)[0];
    (record.runnerV2 as any).launchJobs[jobId].status = "blocked";
    writeRun("run-worker-stopped", record);

    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    const task = taskGet("default", taskId, "default")!;
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.auto_run_paused).toBe(true);
    expect(metadata.auto_run_paused_reason).toContain("dispatch bound");
  });

  it("a dispatch-bound pause never lands on a task that moved on (series fence)", async () => {
    const runDir = join(RUNS, "run-bound-reset");
    // task was RESET after the accepted attempt: series moved to 9
    const taskId = seedTaskForRun("run-bound-reset", { resume_series: 9 });
    writeRun("run-bound-reset", neverClaimedJobRun("run-bound-reset", runDir, taskId));

    await reconcileOrphanedRuns({ runsDir: RUNS, eventsDir: join(TEST_ROOT, "events") });

    expect(readRun("run-bound-reset").status).toBe("stopped"); // the run still ends
    const task = taskGet("default", taskId, "default")!;
    expect((task.metadata as Record<string, unknown>).auto_run_paused).toBeUndefined();
  });
});

function cleanedOrStopped(result: { cleaned: string[] }, runId: string): boolean {
  return result.cleaned.includes(runId);
}
