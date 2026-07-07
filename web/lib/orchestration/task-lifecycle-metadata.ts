import { hydrateLifecycleState } from "./task-lifecycle-hydrate";
import { reduceTaskLifecycle } from "./task-lifecycle-reducer";
import type { TaskLifecycleState } from "./task-lifecycle-types";

export function metadataWithLifecycleState(
  metadata: Record<string, unknown>,
  state: TaskLifecycleState,
): Record<string, unknown> {
  return {
    ...metadata,
    lifecycle_phase: state.phase,
    execution_retries: state.executionRetryCount,
    summarized_run_fingerprints: state.summarizedFingerprints,
    gated_run_fingerprints: state.gatedFingerprints,
    decision_subtask_id: state.decisionTaskId,
    followup_task_ids: state.followUpTaskIds,
  };
}

function isRetryOrResumeSeries(metadata: Record<string, unknown>): boolean {
  return (
    metadata.lifecycle_phase === "retrying" ||
    metadata.lifecycle_phase === "resuming" ||
    metadata.last_run_status === "retry_requested" ||
    metadata.last_run_status === "retry_pending"
  );
}

function startHydrationMetadata(
  metadata: Record<string, unknown>,
  runId: string,
): Record<string, unknown> {
  if (
    metadata.last_run_status === "running" &&
    metadata.last_run_id !== runId &&
    !isRetryOrResumeSeries(metadata)
  ) {
    return {
      ...metadata,
      last_run_id: undefined,
      last_run_status: undefined,
    };
  }
  return metadata;
}

export function executionStartedLifecycleMetadata(input: {
  taskId: string;
  metadata: Record<string, unknown>;
  runId: string;
  chainId?: string;
}): Record<string, unknown> {
  const hydrationMetadata = startHydrationMetadata(input.metadata, input.runId);
  const transition = reduceTaskLifecycle(
    hydrateLifecycleState(input.taskId, hydrationMetadata),
    {
      type: "execution.started",
      taskId: input.taskId,
      runId: input.runId,
      ...(input.chainId ? { chainId: input.chainId } : {}),
    },
  );

  return {
    ...metadataWithLifecycleState(input.metadata, transition.state),
    last_run_id: input.runId,
    last_run_status: "running",
    last_run_error: undefined,
    last_run_completed: null,
    ...(input.chainId ? { chain_id: input.chainId } : {}),
  };
}
