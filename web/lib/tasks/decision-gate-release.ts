// W3 — releasing a task's decision gate after the decision is resolved
// (stall-killer spec v2).
//
// A completion audit with verdict "decision" parks the task behind a decision
// subtask and stamps the execution bookkeeping of the run that triggered it.
// When that decision resolves, the task is re-opened — but the bookkeeping was
// left behind, and the task-reconciler's provenance repair re-applied the same
// audited verdict on every pass, re-raising the gate it had just cleared.
// Observed live on TASK-003: lifecycle_phase "resuming" (the decision HAD
// resolved) sitting next to last_run_decision_required true, forever.
//
// The release is one operation, not three writes, because a partial clear is
// worse than none: task_run_scope present with last_run_id absent trips the
// "task run scope is invalid" gate (resolveScopedTaskRun requires
// metadata.last_run_id === scope.runId).
//
// PURE — no I/O.

import { releaseTaskRunScopeForRetry } from "@/lib/tasks/task-run-locator";

/**
 * The audited run whose decision gate has been released. Monotonic and
 * run-scoped: it names WHICH run's gate is spent, so a later audit of a
 * genuinely new run still parks the task.
 */
export const DECISION_GATE_RELEASED_RUN_ID_KEY = "decision_gate_released_run_id";

export function readDecisionGateReleasedRunId(
  metadata: Record<string, unknown>,
): string | undefined {
  const value = metadata[DECISION_GATE_RELEASED_RUN_ID_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * True when this exact audited run's decision gate has already been released.
 *
 * The reconciler's provenance repair asks this before re-applying a "decision"
 * verdict. It deliberately does NOT consult last_run_decision_required — that
 * is the field the repair itself writes, so trusting it would make the guard
 * circular and it would never fire.
 */
export function isDecisionGateReleased(
  metadata: Record<string, unknown>,
  auditedRunId: unknown,
): boolean {
  if (typeof auditedRunId !== "string" || !auditedRunId) return false;
  return readDecisionGateReleasedRunId(metadata) === auditedRunId;
}

/**
 * Clear every piece of execution bookkeeping the finished run left behind, in
 * one reduction: the scope, the run pointers, and the gate flag together.
 *
 * `completion_audit_*` is deliberately untouched — hasDurableAuditedClose only
 * fires on verdict "close", and an audited-closed task must stay terminal.
 */
export function releaseDecisionGateMetadata(
  metadata: Record<string, unknown>,
  input: { taskId: string; sourceRunId: string },
): Record<string, unknown> {
  return {
    ...releaseTaskRunScopeForRetry(metadata, input),
    last_run_id: undefined,
    last_run_status: "retry_requested",
    last_run_decision_required: false,
    [DECISION_GATE_RELEASED_RUN_ID_KEY]: input.sourceRunId,
  };
}
