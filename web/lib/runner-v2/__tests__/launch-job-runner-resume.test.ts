/**
 * @jest-environment node
 *
 * Issue #142 round 2: the background worker claims an accepted resume launch
 * job and must reconstruct the scoped session token / profile secrets at claim
 * time, BEFORE any PTY effect. Failure blocks the job visibly; success merges
 * the reconstructed credentials with the canonical persisted environment.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { upsertRoutedLaunchJobRecord, readRoutedLaunchJob } from "@/lib/runner-v2/launch-job";
import { runRoutedLaunchJob } from "@/lib/runner-v2/launch-job-runner";
import type { RunnerV2LaunchContext, RunnerV2LaunchResult } from "@/lib/runner-v2/types";

const TEST_ROOT = join("/tmp", `mentiko-launch-job-resume-142-${randomUUID()}`);

interface SetupResult {
  runJsonPath: string;
  jobId: string;
}

function setupRun(overrides: { resumeAttempt?: unknown } = {}): SetupResult {
  const runId = "run-resume-worker";
  const runDir = join(TEST_ROOT, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "chain.json"), JSON.stringify({
    id: "release-review",
    name: "Release Review",
    agents: [{ id: "reviewer", name: "Reviewer" }],
  }));
  const withJob = upsertRoutedLaunchJobRecord({
    id: runId,
    chain: "Release Review",
    goal: "resume",
    started: "2026-11-16T00:00:00.000Z",
    status: "running",
    agents: [{ id: "reviewer", name: "Reviewer", status: "pending", session: "" }],
    ...(overrides.resumeAttempt !== undefined ? { resumeAttempt: overrides.resumeAttempt } : {}),
  } as never, {
    occurrenceId: `resume:${runId}:1780000000000`,
    runId,
    runDir,
    chainPath: join(runDir, "chain.json"),
    targetAgentIds: ["reviewer"],
    environment: {
      NAMESPACE_ID: "default",
      ORG_ID: "default",
      MENTIKO_RUN_ID: runId,
      MENTIKO_CAP_POLL_SECS: "7",
    },
  });
  const runJsonPath = join(runDir, "run.json");
  writeFileSync(runJsonPath, JSON.stringify(withJob.run, null, 2));
  return { runJsonPath, jobId: withJob.job.id };
}

const acceptedAttempt = {
  id: "attempt-accepted-1",
  series: 0,
  taskId: "TASK-010",
  outcome: "accepted",
  automatic: true,
  updatedAt: "2026-11-16T00:00:01.000Z",
};

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("runRoutedLaunchJob credential reconstruction (accepted resume jobs)", () => {
  it("blocks the job visibly when scoped credentials cannot be reconstructed, before any PTY effect", async () => {
    const { runJsonPath, jobId } = setupRun({ resumeAttempt: acceptedAttempt });
    const bootstrap = jest.fn(async () => ({ support: "started" }) as unknown as RunnerV2LaunchResult);

    const result = await runRoutedLaunchJob({
      runJsonPath,
      jobId,
      ownerId: "worker:test:1",
      dependencies: {
        bootstrap,
        reconstructResumeEnvironment: async () => {
          throw new Error("no scoped session identity for org default");
        },
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.error).toContain("resume launch blocked");
    expect(result.error).toContain("no scoped session identity");
    expect(bootstrap).not.toHaveBeenCalled();
    const job = JSON.parse(readFileSync(runJsonPath, "utf8")).runnerV2.launchJobs[jobId];
    expect(job.status).toBe("blocked");
    expect(job.lastError).toContain("resume launch blocked");
    expect(job.lease).toBeUndefined();
  });

  it("reconstructs scoped credentials before bootstrap and merges them with the canonical persisted env", async () => {
    const { runJsonPath, jobId } = setupRun({ resumeAttempt: acceptedAttempt });
    process.env.PTY_DAEMON = "/tmp/mentiko-142-worker-pty.sock";
    let capturedEnv: Record<string, string> | undefined;
    const bootstrap = jest.fn(async (context: RunnerV2LaunchContext) => {
      capturedEnv = context.env as Record<string, string>;
      // Leave no durable attempt state: this test proves the ENV, not the
      // bootstrap lifecycle; the requeue path releases the lease cleanly.
      throw new Error("bootstrap probe stops after capturing the env");
    });

    const result = await runRoutedLaunchJob({
      runJsonPath,
      jobId,
      ownerId: "worker:test:2",
      dependencies: {
        bootstrap,
        reconstructResumeEnvironment: async () => ({
          MENTIKO_SESSION_ID: "chain-run-resume-worker",
          MENTIKO_SESSION_TOKEN: "minted-scoped-token",
          BETTER_AUTH_SECRET: "reconstructed-secret",
        }),
      },
    });

    try {
      expect(bootstrap).toHaveBeenCalledTimes(1);
      expect(capturedEnv!.MENTIKO_SESSION_TOKEN).toBe("minted-scoped-token");
      expect(capturedEnv!.MENTIKO_SESSION_ID).toBe("chain-run-resume-worker");
      expect(capturedEnv!.BETTER_AUTH_SECRET).toBe("reconstructed-secret");
      // canonical persisted identity wins over anything else
      expect(capturedEnv!.MENTIKO_RUN_ID).toBe("run-resume-worker");
      expect(capturedEnv!.MENTIKO_CAP_POLL_SECS).toBe("7");
      // the sanitized allowlisted worker inheritance (PTY daemon socket)
      expect(capturedEnv!.PTY_DAEMON).toBe("/tmp/mentiko-142-worker-pty.sock");
      expect(result.status).toBe("requeued");
      // the reconstructed secret values were never persisted to the job record
      const job = readRoutedLaunchJob(runJsonPath, jobId)!;
      expect(job.environment.MENTIKO_SESSION_TOKEN).toBeUndefined();
      expect(job.environment.BETTER_AUTH_SECRET).toBeUndefined();
    } finally {
      delete process.env.PTY_DAEMON;
    }
  });

  it("keeps the legacy environment merge for jobs on runs without an accepted resumeAttempt", async () => {
    const { runJsonPath, jobId } = setupRun();
    let capturedEnv: Record<string, string> | undefined;
    const bootstrap = jest.fn(async (context: RunnerV2LaunchContext) => {
      capturedEnv = context.env as Record<string, string>;
      throw new Error("bootstrap probe stops after capturing the env");
    });
    const reconstruct = jest.fn(async () => ({}));

    await runRoutedLaunchJob({
      runJsonPath,
      jobId,
      ownerId: "worker:test:3",
      dependencies: { bootstrap, reconstructResumeEnvironment: reconstruct },
    });

    expect(reconstruct).not.toHaveBeenCalled();
    expect(capturedEnv!.MENTIKO_SESSION_TOKEN).toBeUndefined();
    expect(capturedEnv!.MENTIKO_CAP_POLL_SECS).toBe("7");
  });
});
