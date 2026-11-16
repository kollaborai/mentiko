import { randomUUID } from "node:crypto";
import { MAX_AUTO_RUN_RETRIES } from "@/lib/tasks/auto-run-state";
import { taskMutateMetadata } from "@/lib/tasks/task-store";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";

/**
 * Route-owned resume attempts (issue #142).
 *
 * The resume route alone decides whether a particular attempt failed before
 * acceptance or was accepted for execution, and records that decision durably
 * on the run record as `resumeAttempt`. Callers (the auto-run scanner, the UI)
 * read this record; they never infer an outcome from an HTTP status, a timeout,
 * or a run-status snapshot.
 */

export type ResumeAttemptOutcome = "preparing" | "failed" | "accepted";

/**
 * Header the auto-run scanner sends on its resume fetch so the route can tell
 * automatic attempts (which debit task retries on confirmed failure) from
 * manual ones (which never debit).
 */
export const RESUME_SOURCE_HEADER = "x-mentiko-resume-source";
export const RESUME_SOURCE_AUTO_RUN = "auto-run";

export interface ResumeAttemptRecord {
  /** Unique id of this attempt; stable across crash recovery of a preparing attempt. */
  id: string;
  /** Task metadata resume_series captured under the resume claim when the attempt started. */
  series: number;
  taskId?: string;
  outcome: ResumeAttemptOutcome;
  /** Sanitized actionable reason; never credentials. Set for failed (and preparing-stuck) outcomes. */
  reason?: string;
  /** True when the auto-run scanner requested the attempt; only automatic attempts debit task retries. */
  automatic?: boolean;
  updatedAt?: string;
}

/** History entry preserved at acceptance so the prior terminal cause is never erased. */
export interface ResumeHistoryEntry {
  attempt?: ResumeAttemptRecord;
  status?: string;
  statusReason?: unknown;
  statusMessage?: string;
  at: string;
}

export const RESUME_HISTORY_KEY = "resumeHistory";
const RESUME_HISTORY_LIMIT = 20;

export function readResumeAttempt(
  run: { resumeAttempt?: unknown },
): ResumeAttemptRecord | undefined {
  const raw = run.resumeAttempt;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Partial<ResumeAttemptRecord>;
  if (
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.series !== "number" ||
    (record.outcome !== "preparing" && record.outcome !== "failed" && record.outcome !== "accepted")
  ) {
    return undefined;
  }
  return {
    id: record.id,
    series: record.series,
    ...(typeof record.taskId === "string" && record.taskId ? { taskId: record.taskId } : {}),
    outcome: record.outcome,
    ...(typeof record.reason === "string" && record.reason ? { reason: record.reason } : {}),
    ...(record.automatic === true ? { automatic: true } : {}),
    ...(typeof record.updatedAt === "string" ? { updatedAt: record.updatedAt } : {}),
  };
}

export function currentResumeSeries(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const raw = (metadata as Record<string, unknown>).resume_series;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

export function newResumeAttempt(input: {
  series: number;
  taskId?: string;
  automatic: boolean;
}): ResumeAttemptRecord {
  return {
    id: randomUUID(),
    series: input.series,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    outcome: "preparing",
    ...(input.automatic ? { automatic: true } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function appendResumeHistory<T extends Record<string, unknown>>(
  run: T,
  entry: ResumeHistoryEntry,
): T {
  const prior = Array.isArray(run[RESUME_HISTORY_KEY]) ? (run[RESUME_HISTORY_KEY] as unknown[]) : [];
  return {
    ...run,
    [RESUME_HISTORY_KEY]: [...prior, entry].slice(-RESUME_HISTORY_LIMIT),
  };
}

/**
 * Guarded, idempotent task projection of a confirmed failed resume outcome
 * (issue #142): ONE compare-and-set write charges
 *   auto_run_retries = min(MAX, n+1)
 *   resume_last_error = attempt reason
 *   resume_accounted_attempt_id = attempt id
 *
 * Fences, all checked inside the CAS loop against the CURRENT task row:
 *   - the same attempt id is already accounted -> no-op (replay-safe);
 *   - the attempt was not automatic -> no-op (manual resumes never debit);
 *   - the task's resume_series moved past the attempt's series (a Retry-task /
 *     assign-chain / auto-run reset invalidated old outcomes) -> no-op;
 *   - the task no longer points at this run (last_run_id or the persisted
 *     task_run_scope names a different run) -> no-op.
 *
 * Returns { status: "projected" } when the write landed, { status: "no-op" }
 * when a fence held, and { status: "unwritten" } when the CAS could not land
 * (caller must not start a new attempt; the durable outcome replays here on
 * the next route entry).
 */
export type ResumeProjectionResult =
  | { status: "projected"; retries: number }
  | { status: "no-op"; cause: string }
  | { status: "unwritten" };

/**
 * A confirmed failure whose task CAS could not land (issue #142 round 2, P2):
 * the outcome IS durably recorded on the run and replays on the next route
 * entry, but the owner would see nothing meanwhile. This writes a guarded
 * operational pause — no attempt outcome, no debit — fenced by the same
 * series/run/status rules as the projection itself, so a reset, replacement
 * or close is never paused for a stale gap.
 *
 * Returns whether the pause write LANDED (#142 round 3): a writable store
 * with repeated CAS contention can still leave it unwritten, and the caller
 * must surface that visibly instead of assuming the owner was notified.
 */
export function pauseTaskForUnwrittenResumeProjection(input: {
  orgId: string;
  namespaceId?: string;
  taskId: string;
  runId: string;
  attempt: ResumeAttemptRecord;
}): boolean {
  if (input.attempt.outcome !== "failed") return false;
  const landed = taskMutateMetadata(input.orgId, input.taskId, (metadata, task) => {
    if (isTerminalTaskStatus(task.status)) return null;
    if (currentResumeSeries(metadata) !== input.attempt.series) return null;
    if (!taskPointsAtRun(metadata, input.taskId, input.runId)) return null;
    if (metadata.resume_accounted_attempt_id === input.attempt.id) return null;
    return {
      ...metadata,
      auto_run_paused: true,
      auto_run_paused_reason:
        `resume failure for run ${input.runId} (attempt ${input.attempt.id}) could not be recorded on the task: `
        + `${input.attempt.reason || "resume failed"}. `
        + "Auto-run paused without consuming a retry; use Retry task once the task store is writable again.",
    };
  }, input.namespaceId);
  return landed.ok;
}

export function projectConfirmedResumeFailure(input: {
  orgId: string;
  namespaceId?: string;
  taskId: string;
  runId: string;
  attempt: ResumeAttemptRecord;
}): ResumeProjectionResult {
  if (input.attempt.outcome !== "failed") {
    return { status: "no-op", cause: "attempt is not a confirmed failure" };
  }
  let result: ResumeProjectionResult = { status: "no-op", cause: "attempt is not automatic" };
  const landed = taskMutateMetadata(input.orgId, input.taskId, (metadata, task) => {
    if (metadata.resume_accounted_attempt_id === input.attempt.id) {
      result = { status: "no-op", cause: "attempt already accounted" };
      return null;
    }
    if (input.attempt.automatic !== true) {
      result = { status: "no-op", cause: "attempt is not automatic" };
      return null;
    }
    if (isTerminalTaskStatus(task.status)) {
      result = { status: "no-op", cause: "task is closed" };
      return null;
    }
    if (currentResumeSeries(metadata) !== input.attempt.series) {
      result = { status: "no-op", cause: "attempt series is stale after a reset" };
      return null;
    }
    if (!taskPointsAtRun(metadata, input.taskId, input.runId)) {
      result = { status: "no-op", cause: "task no longer points at this run" };
      return null;
    }
    const retries = typeof metadata.auto_run_retries === "number" && metadata.auto_run_retries > 0
      ? metadata.auto_run_retries
      : 0;
    const next = Math.min(MAX_AUTO_RUN_RETRIES, retries + 1);
    result = { status: "projected", retries: next };
    return {
      ...metadata,
      auto_run_retries: next,
      resume_last_error: input.attempt.reason || "resume failed",
      resume_accounted_attempt_id: input.attempt.id,
    };
  }, input.namespaceId);
  if (!landed.ok) return { status: "unwritten" };
  return result;
}

/**
 * The task must still own THIS run. A persisted task_run_scope is the
 * AUTHORITATIVE claim: when one exists it must name exactly this task + run,
 * and a merely matching last_run_id can no longer admit the charge (the run
 * pointer drifts on replacements). Only when no scope exists does last_run_id
 * carry the claim. A task that moved on (new run, replacement, reassignment)
 * must never be charged for the old run's attempts.
 */
export function taskPointsAtRun(
  metadata: Record<string, unknown>,
  taskId: string,
  runId: string,
): boolean {
  const scope = metadata.task_run_scope;
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const record = scope as { taskId?: unknown; runId?: unknown };
    return record.taskId === taskId && record.runId === runId;
  }
  return metadata.last_run_id === runId;
}
