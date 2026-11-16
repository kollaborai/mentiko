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

import { reconcileOrphanedRuns } from "@/lib/runs/run-reconciler";
import { upsertRoutedLaunchJobRecord } from "@/lib/runner-v2/launch-job";

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
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
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

  it("an acceptance that lands while the reaper scans cannot be erased or stopped from the pre-acceptance read", async () => {
    // The reaper reads its session snapshot BEFORE the per-run loop. Acceptance
    // lands right then (between that read and the run's locked mutation) —
    // with the old whole-snapshot write the reaper would have stopped the run
    // and dropped the accepted attempt and queued job it never saw.
    writeRun("run-race", orphanShape({ id: "run-race" }));
    onLiveSessionsCall = () => {
      onLiveSessionsCall = undefined;
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
});
