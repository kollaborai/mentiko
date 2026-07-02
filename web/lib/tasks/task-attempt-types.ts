export type TaskAttemptKind =
  | "task_generation"
  | "recommendation"
  | "chain_generation"
  | "execution"
  | "outcome_summary"
  | "decision_system"
  | "unknown";

export type TaskAttemptCategory = "system" | "task_execution";

export type TaskAttemptSource = "run_json" | "task_metadata" | "job_store" | "merged";

export interface TaskAttemptRun {
  id?: string;
  taskId?: string;
  chain?: string;
  chainId?: string;
  status?: string;
  started?: string;
  completed?: string;
  jobId?: string;
  generationKind?: string;
  metadata?: unknown;
}

export interface TaskAttempt {
  runId: string;
  kind: TaskAttemptKind;
  category: TaskAttemptCategory;
  chainId?: string;
  chainName?: string;
  status: string;
  startedAt?: string;
  completedAt?: string;
  jobId?: string;
  generationKind?: string;
  sourceRunId?: string;
  source: TaskAttemptSource;
  isSystem: boolean;
  isCurrent: boolean;
  isLatestForKind: boolean;
  staleReason?: string;
}
