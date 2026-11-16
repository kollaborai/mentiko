import { MAX_AUTO_RUN_RETRIES } from "@/lib/tasks/auto-run-state";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";
import { taskMutateMetadata } from "@/lib/tasks/task-store";

/**
 * Resume-attempt identity for #142 (review round 4 P1): the task row guards
 * (last_run_id, status) cannot tell two responses for the SAME run apart — a
 * late failure from attempt N can be charged to attempt N+1, or to a fresh
 * series after "Retry task" reset the budget, because the run id and open
 * status still match. Each scan therefore stamps a fresh attempt id on the
 * task BEFORE sending the resume, and the failure accounting charges only
 * when that attempt id is still the current one.
 */

export const RESUME_ATTEMPT_ID_KEY = "resume_attempt_id";
export const RESUME_ATTEMPT_RUN_KEY = "resume_attempt_run_id";

/** The gate shape the scan admitted when it selected this run. */
function attemptStillAdmitted(
  currentMeta: Record<string, unknown>,
  task: { status: string },
  runId: string
): boolean {
  if (currentMeta.last_run_id !== runId) {
    // The task points at a different run now: a newer run started or the
    // binding changed. This response belongs to history, not the budget.
    return false;
  }
  if (isTerminalTaskStatus(task.status)) {
    // Closed between the scan and the response: nothing left to retry.
    return false;
  }
  if (
    task.status !== "open"
    && !(task.status === "in_progress" && currentMeta.last_run_status === "retry_requested")
  ) {
    // The gate admits only open tasks (in_progress solely as an explicit
    // retry series). Any other in_progress means execution already
    // resumed/started elsewhere — progress, not a failed attempt.
    return false;
  }
  return true;
}

export type ResumeAttemptStamp =
  | { ok: true; attemptId: string }
  | { ok: false; stale: true }
  | { ok: false; stale: false; error: string };

/**
 * Stamp a fresh resume-attempt identity on the task, guarded by the same
 * read-modify-write revision CAS as the accounting. Call BEFORE sending the
 * resume request; the returned attempt id is the token the failure response
 * must still match to spend budget.
 *
 * - ok:true — the stamp landed; send the resume for this attempt.
 * - ok:false + stale — the task no longer owns this run the way the scan
 *   thought; do not send the resume.
 * - ok:false + error — the store could not write (error/exhausted CAS); do
 *   not send the resume this scan, report the error truthfully.
 */
export function stampResumeAttempt(input: {
  orgId: string;
  taskId: string;
  namespaceId?: string;
  runId: string;
}): ResumeAttemptStamp {
  const { orgId, taskId, namespaceId, runId } = input;
  const attemptId = `resume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let stale = false;
  try {
    const res = taskMutateMetadata(
      orgId,
      taskId,
      (currentMeta, task) => {
        if (!attemptStillAdmitted(currentMeta, task, runId)) {
          stale = true;
          return null;
        }
        stale = false;
        return {
          ...currentMeta,
          [RESUME_ATTEMPT_ID_KEY]: attemptId,
          [RESUME_ATTEMPT_RUN_KEY]: runId,
        };
      },
      namespaceId
    );
    if (!res.ok) {
      return {
        ok: false,
        stale: false,
        error: "compare-and-set attempts exhausted or task vanished",
      };
    }
    if (stale) return { ok: false, stale: true };
    return { ok: true, attemptId };
  } catch (error) {
    return {
      ok: false,
      stale: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type FailedResumeRetryOutcome =
  | { outcome: "consumed" }
  | { outcome: "superseded" }
  | { outcome: "accounting_failed"; error: string };

/**
 * Spend one auto_run_retries on a failed resume attempt — but only when the
 * CURRENT task record still owns that exact attempt: last_run_id still equals
 * the run the resume was sent for, the task is not closed, it is still
 * admissible the way the gate admits it, AND the stamped resume_attempt_id is
 * still the attempt this response belongs to. A response whose attempt id is
 * no longer current (a newer attempt was stamped, the series was reset by
 * "Retry task"/auto-run toggle, or the attempt already charged) is
 * `superseded` and spends nothing.
 *
 * Charging also clears the attempt stamp, so a duplicate delivery of the same
 * response cannot charge twice.
 *
 * All checks and the increment happen inside one taskMutateMetadata
 * read-modify-write, so a concurrent writer that changes the record between
 * the check and the write loses-and-retries instead of being clobbered.
 *
 * Store failures (thrown error, or every compare-and-set attempt lost) are
 * reported as `accounting_failed` with the error — NOT as superseded, so the
 * caller reports the truth instead of asserting the task moved on (#142
 * review P2).
 */
export function consumeFailedResumeRetry(input: {
  orgId: string;
  taskId: string;
  namespaceId?: string;
  /** The run id the resume request was sent for (the scan's selection). */
  runId: string;
  /** The attempt id stamped by stampResumeAttempt before the request was sent. */
  attemptId: string;
  /** Failure message recorded as resume_last_error when the write lands. */
  message: string;
}): FailedResumeRetryOutcome {
  const { orgId, taskId, namespaceId, runId, attemptId, message } = input;

  // True only when the LAST mutate decision (the one whose write landed, or
  // the null that ended the loop) was an increment: a decision that lost its
  // race and re-decided as stale resets the flag.
  let consumed = false;
  try {
    const res = taskMutateMetadata(
      orgId,
      taskId,
      (currentMeta, task) => {
        if (!attemptStillAdmitted(currentMeta, task, runId)) {
          consumed = false;
          return null;
        }
        if (currentMeta[RESUME_ATTEMPT_ID_KEY] !== attemptId) {
          // A newer attempt was stamped, or the series was reset (every reset
          // path clears the stamp): this response speaks for a past attempt.
          consumed = false;
          return null;
        }
        consumed = true;
        return {
          ...currentMeta,
          auto_run_retries: Math.min(
            MAX_AUTO_RUN_RETRIES,
            ((currentMeta.auto_run_retries as number) || 0) + 1,
          ),
          resume_last_error: message,
          // Clear the stamp so a duplicate delivery of this same response
          // cannot charge a second time.
          [RESUME_ATTEMPT_ID_KEY]: undefined,
          [RESUME_ATTEMPT_RUN_KEY]: undefined,
        };
      },
      namespaceId
    );
    if (!res.ok) {
      return {
        outcome: "accounting_failed",
        error: "compare-and-set attempts exhausted or task vanished",
      };
    }
    return consumed
      ? { outcome: "consumed" }
      : { outcome: "superseded" };
  } catch (error) {
    return {
      outcome: "accounting_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
