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
 */
export function withTaskResumeClaim<T>(
  input: { orgId: string; namespaceId?: string; taskId: string },
  fn: () => T,
): T {
  const task = taskGet(input.orgId, input.taskId, input.namespaceId);
  const metadata =
    task?.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? task.metadata as Record<string, unknown>
      : undefined;
  const runId = taskResumeRunId(metadata);
  if (!runId) return fn();
  const claimDir = join(resolveLinkRunsDir(input.namespaceId || "default", input.orgId), runId, ".resume-claim");
  let release: () => void;
  try {
    release = acquireExclusiveFileClaim(claimDir, { waitTimeoutMs: 5_000, retryDelayMs: 25 });
  } catch (error) {
    if (error instanceof ExclusiveFileClaimBusyError) {
      throw new ResumeResetConflictError(runId);
    }
    throw error;
  }
  try {
    return fn();
  } finally {
    release();
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
