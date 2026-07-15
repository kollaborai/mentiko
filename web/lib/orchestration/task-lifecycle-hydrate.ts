// Lifecycle state hydration (Task 3, Step 1 — the state source, C3).
//
// The reducer is pure and never reads storage. Every adapter entry point builds
// the current TaskLifecycleState from persisted task metadata via
// hydrateLifecycleState(taskId, metadata) BEFORE reducing. Without it, each call
// rebuilds a near-default state (executionRetryCount = 0, empty fingerprint sets)
// and every capping/dedup guarantee silently voids in production despite green
// unit tests.
//
// NOTE ON SIGNATURE: the spec shorthand is hydrateLifecycleState(taskMetadata),
// but TaskLifecycleState.taskId is required and metadata alone does not carry the
// task id, so the id is passed explicitly as the first argument. `metadata` may be
// an object or the raw JSON string as stored on the task record.

import {
  MAX_EXECUTION_RETRIES_BEFORE_SUMMARY,
  TASK_LIFECYCLE_RUN_FINGERPRINT_SEPARATOR,
  taskLifecycleRunFingerprintKey,
  type TaskLifecyclePhase,
  type TaskLifecycleState,
} from "./task-lifecycle-types";

const VALID_PHASES: ReadonlySet<TaskLifecyclePhase> = new Set([
  "idle",
  "analyzing",
  "chain_ready",
  "executing",
  "retrying",
  "summarizing",
  "decision_blocked",
  "followup_blocked",
  "resuming",
  "closing",
  "closed",
]);

// Terminal execution statuses that are eligible for retry-or-summarize. Mirrors
// RETRYABLE_EXECUTION_STATUSES in lib/tasks/execution-retry-policy.ts.
const RETRYABLE_TERMINAL_STATUSES = new Set(["failed", "stopped", "deleted", "unknown", "cancelled"]);
// Statuses that mean a retry is queued but not yet started.
const RETRY_PENDING_STATUSES = new Set(["retry_requested", "retry_pending"]);

/** Parse task metadata that may be an object or a JSON string blob. */
function toRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isLiveFingerprint(value: string): boolean {
  const fingerprint = value.includes(TASK_LIFECYCLE_RUN_FINGERPRINT_SEPARATOR)
    ? value.split(TASK_LIFECYCLE_RUN_FINGERPRINT_SEPARATOR).slice(1).join(TASK_LIFECYCLE_RUN_FINGERPRINT_SEPARATOR)
    : value;
  return fingerprint.startsWith("running:") || fingerprint.startsWith("pending:");
}

function toRunScopedFingerprint(value: string, currentRunId: string | undefined): string {
  if (value.includes(TASK_LIFECYCLE_RUN_FINGERPRINT_SEPARATOR) || !currentRunId) return value;
  return taskLifecycleRunFingerprintKey(currentRunId, value);
}

function runScopedFingerprintArray(value: unknown, currentRunId: string | undefined): string[] {
  return unique(stringArray(value)
    // These are terminal-consumption keys. Historical buggy writers persisted
    // live snapshots; never let those suppress a later real terminal state.
    .filter((fingerprint) => !isLiveFingerprint(fingerprint))
    .map((fingerprint) => toRunScopedFingerprint(fingerprint, currentRunId)));
}

/** Narrow a raw run status string onto the state's typed union (else undefined). */
function narrowRunStatus(raw: string | undefined): TaskLifecycleState["currentRunStatus"] {
  return raw === "running" || raw === "completed" || raw === "failed" || raw === "stopped" ? raw : undefined;
}

/**
 * Derive a sane phase for a task that predates persisted `lifecycle_phase`. An
 * already-stuck task (open, prior terminal runs) must NOT hydrate to the `idle`
 * default. This mirrors the reducer's own transition intent so downstream reads
 * are consistent.
 */
function derivePhase(input: {
  gateActive: boolean;
  followUps: number;
  rawStatus: string | undefined;
  executionRetryCount: number;
  retryBudget: number;
  currentRunId: string | undefined;
}): TaskLifecyclePhase {
  if (input.gateActive) return "decision_blocked";
  if (input.followUps > 0) return "followup_blocked";

  const raw = input.rawStatus;
  if (raw === "running") return "executing";
  if (raw === "completed" || raw === "complete") return "summarizing";
  if (raw && RETRYABLE_TERMINAL_STATUSES.has(raw)) {
    // Under budget → still retrying; exhausted → awaiting outcome summary.
    return input.executionRetryCount < input.retryBudget ? "retrying" : "summarizing";
  }
  if (raw && RETRY_PENDING_STATUSES.has(raw)) return "retrying";
  if (input.currentRunId) return "executing";
  return "idle";
}

export function hydrateLifecycleState(taskId: string, metadata: unknown): TaskLifecycleState {
  const m = toRecord(metadata);

  // C1: execution_retries ONLY — never fall back to auto_run_retries (which is
  // also bumped on generation/analysis failures and would over-count executions).
  const executionRetryCount = numberOr(m.execution_retries, 0);
  const retryBudget = MAX_EXECUTION_RETRIES_BEFORE_SUMMARY;

  const currentRunId = stringOrUndefined(m.last_run_id);
  const rawStatus = typeof m.last_run_status === "string" ? m.last_run_status : undefined;
  const currentRunStatus = narrowRunStatus(rawStatus);

  const gateActive = m.last_run_decision_required === true;
  const decisionTaskId = stringOrUndefined(m.decision_subtask_id);
  const followUpTaskIds = stringArray(m.followup_task_ids);
  const chainId = stringOrUndefined(m.chain_id);

  // summarized_run_fingerprints + legacy single-field compatibility fallback.
  // New persisted shape is `${runId}::${fingerprint}`. Old bare fingerprints are
  // normalized against their own source-run identity. They must never be
  // projected onto a newer current run merely because last_run_id changed.
  const summarizedFingerprints = runScopedFingerprintArray(m.summarized_run_fingerprints, currentRunId);
  for (const [legacyKey, sourceRunKey] of [
    ["completion_audit_run_fingerprint", "completion_audit_run_id"],
    ["task_outcome_summary_run_fingerprint", "task_outcome_summary_source_run_id"],
  ] as const) {
    const legacy = stringOrUndefined(m[legacyKey]);
    if (legacy && !isLiveFingerprint(legacy)) {
      const sourceRunId = stringOrUndefined(m[sourceRunKey]) || currentRunId;
      const scoped = toRunScopedFingerprint(legacy, sourceRunId);
      if (!summarizedFingerprints.includes(scoped)) summarizedFingerprints.push(scoped);
    }
  }
  const gatedFingerprints = stringArray(m.gated_run_fingerprints);

  // blockedByTaskIds is not persisted directly; reconstruct from the live
  // decision/follow-up blockers so decision.deleted can prune stale references.
  const blockedByTaskIds = [
    ...(gateActive && decisionTaskId ? [decisionTaskId] : []),
    ...followUpTaskIds,
  ];

  const persistedPhase =
    typeof m.lifecycle_phase === "string" && VALID_PHASES.has(m.lifecycle_phase as TaskLifecyclePhase)
      ? (m.lifecycle_phase as TaskLifecyclePhase)
      : undefined;

  const phase =
    persistedPhase ??
    derivePhase({
      gateActive,
      followUps: followUpTaskIds.length,
      rawStatus,
      executionRetryCount,
      retryBudget,
      currentRunId,
    });

  const lastError = stringOrUndefined(m.last_run_error);

  return {
    phase,
    taskId,
    ...(chainId ? { chainId } : {}),
    ...(currentRunId ? { currentRunId } : {}),
    ...(currentRunStatus ? { currentRunStatus } : {}),
    executionRetryCount,
    retryBudget,
    summarizedFingerprints,
    gatedFingerprints,
    ...(decisionTaskId ? { decisionTaskId } : {}),
    followUpTaskIds,
    blockedByTaskIds,
    ...(lastError ? { lastError } : {}),
  };
}
