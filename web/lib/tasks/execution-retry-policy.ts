import {
  TASK_RETRY_SOURCE_RUN_ID_METADATA_KEY,
  TASK_RETRY_SOURCE_SCOPE_METADATA_KEY,
  TASK_RUN_SCOPE_METADATA_KEY,
} from "@/lib/tasks/task-run-locator";

export const EXECUTION_RETRY_LIMIT = 2;

export const RETRYABLE_EXECUTION_STATUSES = new Set([
  "failed",
  "stopped",
  "deleted",
  "unknown",
  "cancelled",
]);

export function executionRetryCount(metadata: Record<string, unknown>): number {
  const executionRetries = metadata.execution_retries;
  return typeof executionRetries === "number" && Number.isFinite(executionRetries) ? executionRetries : 0;
}

export function hasExecutionRetriesRemaining(metadata: Record<string, unknown>, status?: string): boolean {
  return !!status
    && RETRYABLE_EXECUTION_STATUSES.has(status)
    && executionRetryCount(metadata) < EXECUTION_RETRY_LIMIT;
}

export function nextExecutionRetryMetadata(
  metadata: Record<string, unknown>,
  status: string,
  reason?: string,
): Record<string, unknown> {
  const next = executionRetryCount(metadata) + 1;
  const sourceRunId = typeof metadata.last_run_id === "string" ? metadata.last_run_id : undefined;
  return {
    ...metadata,
    // A retry has no active execution claim until its next launch. Concrete
    // lifecycle writers retain the verified scope through releaseTaskRunScopeForRetry.
    [TASK_RUN_SCOPE_METADATA_KEY]: undefined,
    [TASK_RETRY_SOURCE_RUN_ID_METADATA_KEY]: sourceRunId,
    [TASK_RETRY_SOURCE_SCOPE_METADATA_KEY]: undefined,
    last_run_id: undefined,
    last_run_status: "retry_requested",
    last_run_error: reason || `Execution run ended with ${status}`,
    last_run_decision_required: false,
    execution_retries: next,
  };
}
