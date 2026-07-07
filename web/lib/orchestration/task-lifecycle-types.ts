// Task lifecycle contract types (Task 1).
//
// This is the single source of truth for the reducer-owned task lifecycle state
// machine. The reducer (task-lifecycle-reducer.ts) converts lifecycle events
// into a next state plus explicit effects; the service adapter
// (task-lifecycle-service.ts) applies those effects via injected dependencies.
//
// See docs/orchestration/task-lifecycle-reducer-spec.md for the authoritative
// contract and docs/superpowers/plans/2026-07-06-task-lifecycle-reducer.md
// (Contract corrections C1–C8) for the review-hardened rules reflected here.

// Budget is expressed as retries. 2 retries = 3 execution attempts, matching the
// current auditor RETRY_CAP=2 (>=) semantics. Do NOT change to 3 without a
// deliberate call — see the plan's C1.
export const MAX_EXECUTION_RETRIES_BEFORE_SUMMARY = 2;
export const TASK_LIFECYCLE_RUN_FINGERPRINT_SEPARATOR = "::";

export function taskLifecycleRunFingerprintKey(runId: string, fingerprint: string): string {
  return `${runId}${TASK_LIFECYCLE_RUN_FINGERPRINT_SEPARATOR}${fingerprint}`;
}

export type TaskLifecyclePhase =
  | "idle"
  | "analyzing"
  | "chain_ready"
  | "executing"
  | "retrying"
  | "summarizing"
  | "decision_blocked"
  | "followup_blocked"
  | "resuming"
  | "closing"
  | "closed";

export interface TaskLifecycleState {
  phase: TaskLifecyclePhase;
  taskId: string;
  chainId?: string;
  currentRunId?: string;
  currentRunStatus?: "running" | "completed" | "failed" | "stopped";
  // C1: backed by metadata.execution_retries, NOT auto_run_retries (which is also
  // incremented on generation/analysis failures and would over-count executions).
  executionRetryCount: number;
  // Default MAX_EXECUTION_RETRIES_BEFORE_SUMMARY. Governs BOTH the failure path
  // and the summary-retry path so the two operators never diverge.
  retryBudget: number;
  // C4: set-based dedup. A single field cannot enforce idempotency across the
  // reconcile re-poll of one terminal run.
  summarizedFingerprints: string[];
  gatedFingerprints: string[];
  decisionTaskId?: string;
  followUpTaskIds: string[];
  blockedByTaskIds: string[];
  lastError?: string;
}

export type TaskLifecycleEvent =
  | {
      type: "analysis.completed";
      taskId: string;
      recommendationRunId: string;
      recommendedChainId?: string;
      requiresGeneration: boolean;
    }
  | { type: "chain.generated"; taskId: string; chainId: string; generationRunId: string }
  | { type: "execution.started"; taskId: string; runId: string; chainId?: string }
  | { type: "execution.completed"; taskId: string; runId: string; fingerprint: string }
  | {
      type: "execution.failed";
      taskId: string;
      runId: string;
      fingerprint: string;
      reason: string;
      nonRetryable?: boolean;
    }
  | {
      type: "summary.completed";
      taskId: string;
      summaryRunId: string;
      sourceRunId: string;
      fingerprint: string;
      verdict: "close" | "retry" | "decision";
      followUpTaskIds?: string[];
      decisionTaskId?: string;
    }
  | { type: "decision.created"; taskId: string; decisionTaskId: string; sourceRunId: string; fingerprint: string }
  | { type: "decision.resolved"; taskId: string; decisionTaskId: string; followUpTaskIds: string[] }
  | { type: "followups.completed"; taskId: string; followUpTaskIds: string[] }
  | { type: "decision.deleted"; taskId: string; decisionTaskId?: string; decisionId?: string }
  | { type: "task.closed"; taskId: string };
// NOTE: task.auto_run_tick is intentionally dropped from v1 scope (C8). Auto-run
// admission (analysis, chain generation, execution start) stays in
// reconcile/auto-run; the reducer owns the post-execution lifecycle and enters at
// execution.started.

export type TaskLifecycleEffect =
  // Reserved for a future task.auto_run_tick consolidation. Not emitted in v1.
  | { type: "start_analysis"; taskId: string }
  | { type: "start_chain_generation"; taskId: string }
  | { type: "start_execution"; taskId: string; chainId: string }
  | { type: "retry_execution"; taskId: string; previousRunId: string; reason: string }
  | { type: "start_outcome_summary"; taskId: string; sourceRunId: string; fingerprint: string }
  | { type: "create_decision_gate"; taskId: string; sourceRunId: string; fingerprint: string }
  | { type: "block_on_decision"; taskId: string; decisionTaskId: string }
  | { type: "create_followup_dependencies"; taskId: string; followUpTaskIds: string[] }
  | { type: "resume_original_task"; taskId: string }
  | { type: "close_task"; taskId: string }
  | { type: "clear_decision_gate"; taskId: string; decisionTaskId?: string }
  | { type: "scan_unblocked_auto_run_tasks" };

export interface TaskLifecycleTransition {
  state: TaskLifecycleState;
  effects: TaskLifecycleEffect[];
}
