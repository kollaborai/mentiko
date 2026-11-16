import { join } from "node:path";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import {
  acquireExclusiveFileClaim,
  ExclusiveFileClaimBusyError,
} from "@/lib/runner-v2/file-claim";
import { currentResumeSeries } from "@/lib/runs/resume-attempt";
import { taskGet, taskMutateMetadata } from "@/lib/tasks/task-store";

/**
 * Reset serialization for route-owned resume (issue #142 round 2).
 *
 * A reset (Retry task, chain assignment, auto-run enable, metadata clear,
 * run replacement) must not interleave with a resume acceptance for the same
 * run: every one of those task writes runs while holding the run's
 * .resume-claim — the same exclusive claim the resume route holds across its
 * whole operation. A busy claim is a VISIBLE RETRYABLE CONFLICT; there is no
 * optimistic success.
 */

/** Visible, retryable: a resume holds the run's claim right now. */
export class ResumeResetConflictError extends Error {
  constructor(readonly runId: string) {
    super(
      `A resume is in progress for run ${runId}; retry the reset once it finishes`,
    );
    this.name = "ResumeResetConflictError";
  }
}

/**
 * The run a task's metadata currently points at: the authoritative
 * task_run_scope wins over last_run_id (mirrors taskPointsAtRun).
 */
export function taskResumeRunId(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) return undefined;
  const scope = metadata.task_run_scope;
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    const runId = (scope as { runId?: unknown }).runId;
    if (typeof runId === "string" && runId) return runId;
  }
  const lastRunId = metadata.last_run_id;
  return typeof lastRunId === "string" && lastRunId ? lastRunId : undefined;
}

/**
 * Run `fn` while holding the .resume-claim of the run the task currently
 * points at. No current run -> nothing to serialize against, run directly.
 * Busy claim -> ResumeResetConflictError (never an optimistic write).
 *
 * Synchronous variant: the claim wait blocks the event loop (bounded
 * Atomics.wait inside acquireExclusiveFileClaim). Prefer
 * withTaskResumeClaimAsync on every async request path (#142 round 3).
 */
export function withTaskResumeClaim<T>(
  input: { orgId: string; namespaceId?: string; taskId: string },
  fn: () => T,
): T {
  const release = acquireTaskResumeClaimSync(input);
  try {
    return fn();
  } finally {
    release?.();
  }
}

/**
 * Async variant (#142 round 3): the guarded task write runs INSIDE the claim,
 * and the claim WAIT never blocks the Node event loop — each retry defers to
 * the event loop (setTimeout) instead of a synchronous Atomics.wait, so a
 * same-process resume awaiting cleanup keeps making progress while a reset
 * waits out its budget. Busy past waitTimeoutMs -> ResumeResetConflictError,
 * a visible retryable conflict; never an optimistic unserialized write.
 */
export async function withTaskResumeClaimAsync<T>(
  input: { orgId: string; namespaceId?: string; taskId: string },
  fn: () => T | Promise<T>,
  options: { waitTimeoutMs?: number; retryDelayMs?: number } = {},
): Promise<T> {
  const waitTimeoutMs = options.waitTimeoutMs ?? 5_000;
  const retryDelayMs = options.retryDelayMs ?? 25;
  const runId = taskResumeClaimRunId(input);
  if (!runId) return fn();
  const claimDir = join(resolveLinkRunsDir(input.namespaceId || "default", input.orgId), runId, ".resume-claim");
  const deadline = Date.now() + waitTimeoutMs;
  let release: (() => void) | undefined;
  while (true) {
    try {
      // waitTimeoutMs 0: one non-blocking attempt per loop; the waiting
      // happens in the awaited setTimeout below.
      release = acquireExclusiveFileClaim(claimDir, { waitTimeoutMs: 0 });
      break;
    } catch (error) {
      if (!(error instanceof ExclusiveFileClaimBusyError)) throw error;
      if (Date.now() >= deadline) throw new ResumeResetConflictError(runId);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

function taskResumeClaimRunId(
  input: { orgId: string; namespaceId?: string; taskId: string },
): string | undefined {
  const task = taskGet(input.orgId, input.taskId, input.namespaceId);
  const metadata =
    task?.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? task.metadata as Record<string, unknown>
      : undefined;
  return taskResumeRunId(metadata);
}

function acquireTaskResumeClaimSync(
  input: { orgId: string; namespaceId?: string; taskId: string },
): (() => void) | undefined {
  const runId = taskResumeClaimRunId(input);
  if (!runId) return undefined;
  const claimDir = join(resolveLinkRunsDir(input.namespaceId || "default", input.orgId), runId, ".resume-claim");
  try {
    return acquireExclusiveFileClaim(claimDir, { waitTimeoutMs: 5_000, retryDelayMs: 25 });
  } catch (error) {
    if (error instanceof ExclusiveFileClaimBusyError) {
      throw new ResumeResetConflictError(runId);
    }
    throw error;
  }
}

/**
 * Increment resume_series ON THE SERVER under the run's resume claim. The
 * caller may pass extra metadata fields to fold into the same guarded write;
 * the series value itself is always computed from the CURRENT task row inside
 * the CAS loop, never from a client snapshot.
 */
export function incrementResumeSeriesUnderClaim(input: {
  orgId: string;
  namespaceId?: string;
  taskId: string;
}): number | undefined {
  let incrementedTo: number | undefined;
  withTaskResumeClaim(input, () => {
    taskMutateMetadata(input.orgId, input.taskId, (metadata) => {
      incrementedTo = currentResumeSeries(metadata) + 1;
      return { ...metadata, resume_series: incrementedTo };
    }, input.namespaceId);
  });
  return incrementedTo;
}
