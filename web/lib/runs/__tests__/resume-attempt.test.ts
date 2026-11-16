/**
 * @jest-environment node
 *
 * Guarded task projection of confirmed failed resume outcomes (issue #142),
 * exercised against the REAL sqlite task store in a temp data root.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/lib/config", () => ({
  __esModule: true,
  default: {
    globalRoot: mkdtempSync(join(tmpdir(), "resume-attempt-142-")),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TEST_ROOT = (jest.requireMock("@/lib/config") as { default: { globalRoot: string } }).default.globalRoot;

import { closeAll, taskCreate, taskGet, taskUpdate } from "@/lib/tasks/task-store";
import {
  currentResumeSeries,
  pauseTaskForUnwrittenResumeProjection,
  projectConfirmedResumeFailure,
  type ResumeAttemptRecord,
} from "@/lib/runs/resume-attempt";

const ORG = "default";
const NS = "test";

function failedAttempt(overrides: Partial<ResumeAttemptRecord> = {}): ResumeAttemptRecord {
  return {
    id: `attempt-${Math.random().toString(36).slice(2, 8)}`,
    series: 0,
    taskId: "TASK-1",
    outcome: "failed",
    reason: "no chain definition found",
    automatic: true,
    ...overrides,
  };
}

function seedTask(metadata: Record<string, unknown>): string {
  return taskCreate(ORG, { title: "t", issue_type: "task", metadata }, NS).id;
}

function metadataOf(taskId: string): Record<string, unknown> {
  return taskGet(ORG, taskId, NS)!.metadata as Record<string, unknown>;
}

afterAll(() => {
  closeAll();
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("projectConfirmedResumeFailure", () => {
  it("charges exactly one retry for a confirmed automatic failure and preserves unrelated metadata", () => {
    const taskId = seedTask({
      auto_run: true,
      chain_id: "release-review",
      last_run_id: "run-1",
      unrelated_marker: "keep-me",
    });
    const attempt = failedAttempt({ taskId });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "projected", retries: 1 });
    const metadata = metadataOf(taskId);
    expect(metadata.auto_run_retries).toBe(1);
    expect(metadata.resume_last_error).toBe("no chain definition found");
    expect(metadata.resume_accounted_attempt_id).toBe(attempt.id);
    expect(metadata.unrelated_marker).toBe("keep-me");
  });

  it("replaying the same attempt id is a no-op, never a double charge", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1" });
    const attempt = failedAttempt({ taskId });

    projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });
    const second = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(second).toEqual({ status: "no-op", cause: "attempt already accounted" });
    expect(metadataOf(taskId).auto_run_retries).toBe(1);
  });

  it("caps the retry count at the ceiling", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1", auto_run_retries: 3 });
    const attempt = failedAttempt({ taskId });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "projected", retries: 3 });
  });

  it("a manual attempt never debits task retries", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1" });
    const attempt = failedAttempt({ taskId, automatic: undefined });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "no-op", cause: "attempt is not automatic" });
    expect(metadataOf(taskId).auto_run_retries).toBeUndefined();
  });

  it("a stale series (a Retry-task/assign/auto-run reset landed) fences the projection", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1", resume_series: 1 });
    const attempt = failedAttempt({ taskId, series: 0 });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "no-op", cause: "attempt series is stale after a reset" });
    expect(metadataOf(taskId).auto_run_retries).toBeUndefined();
  });

  it("a task that no longer points at this run (scope names a different run) is not charged", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-2" });
    taskUpdate(ORG, taskId, {
      metadata: {
        ...metadataOf(taskId),
        task_run_scope: { taskId, runId: "run-2", namespaceId: NS, orgId: ORG, version: 1 },
      },
    }, NS);
    const attempt = failedAttempt({ taskId });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "no-op", cause: "task no longer points at this run" });
    expect(metadataOf(taskId).auto_run_retries).toBeUndefined();
  });

  it("a scope pointing at this run still admits the projection when last_run_id drifted", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-elsewhere" });
    taskUpdate(ORG, taskId, {
      metadata: {
        ...metadataOf(taskId),
        task_run_scope: { taskId, runId: "run-1", namespaceId: NS, orgId: ORG, version: 1 },
      },
    }, NS);
    const attempt = failedAttempt({ taskId });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "projected", retries: 1 });
  });

  it("an authoritative scope naming a DIFFERENT run fences the projection even when last_run_id still matches", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1" });
    taskUpdate(ORG, taskId, {
      metadata: {
        ...metadataOf(taskId),
        task_run_scope: { taskId, runId: "run-2", namespaceId: NS, orgId: ORG, version: 1 },
      },
    }, NS);
    const attempt = failedAttempt({ taskId });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "no-op", cause: "task no longer points at this run" });
    expect(metadataOf(taskId).auto_run_retries).toBeUndefined();
  });

  it("a closed task is never charged for a resume failure", async () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1" });
    taskUpdate(ORG, taskId, { status: "closed" }, NS);
    const attempt = failedAttempt({ taskId });

    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });

    expect(result).toEqual({ status: "no-op", cause: "task is closed" });
    expect(metadataOf(taskId).auto_run_retries).toBeUndefined();
  });

  it("reports unwritten when the task vanished", () => {
    const attempt = failedAttempt({ taskId: "TASK-gone" });
    const result = projectConfirmedResumeFailure({ orgId: ORG, namespaceId: NS, taskId: "TASK-gone", runId: "run-1", attempt });
    expect(result).toEqual({ status: "unwritten" });
  });
});

describe("currentResumeSeries", () => {
  it("treats absent, malformed, and negative values as series 0", () => {
    expect(currentResumeSeries(undefined)).toBe(0);
    expect(currentResumeSeries({})).toBe(0);
    expect(currentResumeSeries({ resume_series: "2" })).toBe(0);
    expect(currentResumeSeries({ resume_series: -1 })).toBe(0);
    expect(currentResumeSeries({ resume_series: 4 })).toBe(4);
  });
});

describe("pauseTaskForUnwrittenResumeProjection (unwritten failure accounting, #142 r2)", () => {
  it("pauses visibly without a debit when the failure projection could not land", () => {
    const taskId = seedTask({ auto_run: true, last_run_id: "run-1" });
    const attempt = failedAttempt({ taskId });

    const paused = pauseTaskForUnwrittenResumeProjection({ orgId: ORG, namespaceId: NS, taskId, runId: "run-1", attempt });
    // the write result is RETURNED (#142 r3): the caller can surface an
    // unwritten pause instead of assuming the owner was notified
    expect(paused).toBe(true);

    const metadata = metadataOf(taskId);
    expect(metadata.auto_run_paused).toBe(true);
    expect(metadata.auto_run_paused_reason).toContain("could not be recorded on the task");
    expect(metadata.auto_run_paused_reason).toContain("without consuming a retry");
    // no debit: the replay on the next route entry still charges exactly once
    expect(metadata.auto_run_retries).toBeUndefined();
  });

  it("returns false when there is nothing to pause (not a failed attempt); a fence-held no-op is true (no gap)", () => {
    const notFailed = seedTask({ auto_run: true, last_run_id: "run-1" });
    expect(pauseTaskForUnwrittenResumeProjection({
      orgId: ORG, namespaceId: NS, taskId: notFailed, runId: "run-1",
      attempt: { ...failedAttempt({ taskId: notFailed }), outcome: "accepted" },
    })).toBe(false);
    expect(metadataOf(notFailed).auto_run_paused).toBeUndefined();

    // a fence-held no-op (series moved) writes nothing and owes nothing: ok
    const fenced = seedTask({ auto_run: true, last_run_id: "run-1", resume_series: 9 });
    expect(pauseTaskForUnwrittenResumeProjection({
      orgId: ORG, namespaceId: NS, taskId: fenced, runId: "run-1",
      attempt: failedAttempt({ taskId: fenced, series: 1 }),
    })).toBe(true);
    expect(metadataOf(fenced).auto_run_paused).toBeUndefined();
  });

  it("never pauses a task the projection already accounted, a reset task, or a closed task", () => {
    const accounted = seedTask({ auto_run: true, last_run_id: "run-1", resume_accounted_attempt_id: "attempt-x" });
    pauseTaskForUnwrittenResumeProjection({
      orgId: ORG, namespaceId: NS, taskId: accounted, runId: "run-1",
      attempt: failedAttempt({ taskId: accounted, id: "attempt-x" }),
    });
    expect(metadataOf(accounted).auto_run_paused).toBeUndefined();

    const reset = seedTask({ auto_run: true, last_run_id: "run-1", resume_series: 5 });
    pauseTaskForUnwrittenResumeProjection({
      orgId: ORG, namespaceId: NS, taskId: reset, runId: "run-1",
      attempt: failedAttempt({ taskId: reset, series: 4 }),
    });
    expect(metadataOf(reset).auto_run_paused).toBeUndefined();

    const closed = seedTask({ auto_run: true, last_run_id: "run-1" });
    taskUpdate(ORG, closed, { status: "closed" }, NS);
    pauseTaskForUnwrittenResumeProjection({
      orgId: ORG, namespaceId: NS, taskId: closed, runId: "run-1",
      attempt: failedAttempt({ taskId: closed }),
    });
    expect(metadataOf(closed).auto_run_paused).toBeUndefined();
  });
});
