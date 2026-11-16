import { MAX_AUTO_RUN_RETRIES } from "@/lib/tasks/auto-run-state";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";
import { taskMutateMetadata } from "@/lib/tasks/task-store";

/**
 * Spend one auto_run_retries on a failed resume attempt — but only when the
 * CURRENT task record still owns that attempt (#142 review P1: a late or
 * overlapping resume response must never spend a task's retry budget on a
 * task that has moved on).
 *
 * The write lands only when the record still matches the shape the scan
 * selected: last_run_id still equals the run the resume was sent for, the
 * task is not closed, and it is still admissible the way the gate admits it
 * (status open, or in_progress only as an explicit retry_requested series —
 * any other in_progress means a competing resume/run already started). When
 * the task advanced to a different run, closed, or began executing, the
 * response is stale: no write, no retry consumed.
 *
 * All checks and the increment happen inside one taskMutateMetadata
 * read-modify-write, so a concurrent writer that changes the record between
 * the check and the write loses-and-retries instead of being clobbered.
 *
 * Returns true iff the failure was recorded (retry consumed or clamped at
 * the ceiling); false means the response was stale and nothing was written.
 */
export function consumeFailedResumeRetry(input: {
  orgId: string;
  taskId: string;
  namespaceId?: string;
  /** The run id the resume request was sent for (the scan's selection). */
  runId: string;
  /** Failure message recorded as resume_last_error when the write lands. */
  message: string;
}): boolean {
  const { orgId, taskId, namespaceId, runId, message } = input;

  // True only when the LAST mutate decision (the one whose write landed, or
  // the null that ended the loop) was an increment: a decision that lost its
  // race and re-decided as stale resets the flag.
  let consumed = false;
  try {
    const res = taskMutateMetadata(
      orgId,
      taskId,
      (currentMeta, task) => {
        if (currentMeta.last_run_id !== runId) {
          // The task points at a different run now: a newer run started or the
          // binding changed. This response belongs to history, not the budget.
          consumed = false;
          return null;
        }
        if (isTerminalTaskStatus(task.status)) {
          // Closed between the scan and the response: nothing left to retry.
          consumed = false;
          return null;
        }
        if (
          task.status !== "open"
          && !(task.status === "in_progress" && currentMeta.last_run_status === "retry_requested")
        ) {
          // The gate admits only open tasks (in_progress solely as an explicit
          // retry series). Any other in_progress means execution already
          // resumed/started elsewhere — progress, not a failed attempt.
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
        };
      },
      namespaceId,
    );
    // ok:false (task vanished / every attempt lost the race) wrote nothing
    // durable; the next scan re-evaluates against the then-current record.
    return res.ok && consumed;
  } catch {
    // Best-effort, like the read-then-write it replaces: a store error
    // consumes nothing; the next scan re-attempts the accounting.
    return false;
  }
}
