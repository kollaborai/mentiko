// Pure operational-state vocabulary for the Operations Timeline.
//
// No I/O in this module. The server read model (operations-read-model.ts) feeds
// it persisted state (task rows, dependency edges, the live runs snapshot, and
// the admission verdict from canAdmitAutoRun); tests and client indicators
// consume the same rules so the UI can never disagree with the API about why a
// task is in a given state. Every reason code names the persisted evidence that
// produced it — nothing here is decorative.

import { isTerminalTaskStatus } from "@/lib/tasks/task-status";

/**
 * Stable reason codes for a task's operational state.
 *
 * Codes beyond the core contract, each still grounded in persisted state:
 * - epic_container: epics never run chains directly (canAdmitAutoRun rejects them).
 * - paused_manual: metadata.auto_run_paused — user pause, distinct from retry exhaustion.
 * - auto_run_off: open task with auto-run resolved off and no chain — nothing will
 *   happen without a human.
 */
export type TaskOpReason =
  | "running"
  | "queued_capacity"
  | "ready"
  | "awaiting_recommendation"
  | "awaiting_generation"
  | "awaiting_execution"
  | "blocked_dependency"
  | "blocked_failed_dependency"
  | "blocked_error"
  | "paused_retries_exhausted"
  | "paused_manual"
  | "outcome_audit_pending"
  | "outcome_audit_failed"
  | "waiting_human_decision"
  | "closed"
  | "stale_run_scope"
  | "auto_run_off"
  | "epic_container"
  | "unknown_inconsistent_state";

/** Reasons that demand human attention (surfaced in the Attention section). */
export const ATTENTION_REASONS: ReadonlySet<TaskOpReason> = new Set<TaskOpReason>([
  "blocked_error",
  "blocked_failed_dependency",
  "paused_retries_exhausted",
  "outcome_audit_failed",
  "waiting_human_decision",
  "stale_run_scope",
  "unknown_inconsistent_state",
]);

/** Reasons that mean "waiting on something", grouped in the Waiting section. */
export const WAITING_REASONS: ReadonlySet<TaskOpReason> = new Set<TaskOpReason>([
  "blocked_dependency",
  "blocked_failed_dependency",
  "queued_capacity",
  "awaiting_recommendation",
  "awaiting_generation",
  "awaiting_execution",
  "outcome_audit_pending",
  "waiting_human_decision",
  "paused_retries_exhausted",
  "paused_manual",
]);

export interface BlockingDepInput {
  id: string;
  title?: string;
  status?: string;
  /** The blocker itself is in an errored operational state (own run failed, retries exhausted, audit failed). */
  errored: boolean;
}

/** Minimal structural mirror of AutoRunAdmission (kept local so this module stays fs-free). */
export interface AdmissionInput {
  admit: boolean;
  reason: string;
  action?: string;
}

export interface LiveSystemRunInput {
  kind: "recommendation" | "generation" | "audit" | "task_generation" | "decision";
  runId: string;
}

export interface ClassifyTaskInput {
  taskId: string;
  status: string;
  issueType: string;
  metadata: Record<string, unknown>;
  admission: AdmissionInput;
  /** Resolved auto-run enablement (resolveAutoRunState — includes workspace default). */
  autoRunEnabled: boolean;
  autoRunRetries: number;
  autoRunUserPaused: boolean;
  autoRunRetriesExhausted: boolean;
  /** Live execution run for this task (RunsSnapshot.activeRunByTask). */
  activeExecutionRunId?: string;
  /** Live non-execution run for this task (recommendation/generation/audit). */
  liveSystemRun?: LiveSystemRunInput;
  /** Unfinished blocking dependencies (closed deps must already be filtered out). */
  blockingDeps: BlockingDepInput[];
  /** hasExecutionRetriesRemaining() — the lifecycle will relaunch this errored run. */
  retryPending?: boolean;
}

export interface TaskOpClassification {
  reason: TaskOpReason;
  /** Human-readable causal explanation ("Waiting for TASK-123", …). */
  detail: string;
  /** The persisted field(s)/source this verdict is derived from. */
  source: string;
  runId?: string;
  decisionId?: string;
}

/** Own-run statuses that mean the task's last execution ended badly. */
const ERRORED_RUN_STATUSES = new Set(["failed", "error", "blocked", "stopped"]);

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * A task is "errored" for dependency purposes when its own execution is stuck:
 * last run ended badly without a pending retry, retries are exhausted, or its
 * outcome audit failed. Used to distinguish blocked_dependency (healthy queue)
 * from blocked_failed_dependency (progress is impossible until a human acts).
 */
export function isTaskMetadataErrored(
  metadata: Record<string, unknown>,
  retriesExhausted: boolean,
): boolean {
  if (retriesExhausted) return true;
  if (metadata.task_outcome_summary_status === "failed") return true;
  const lastRunStatus = str(metadata.last_run_status);
  return !!lastRunStatus && ERRORED_RUN_STATUSES.has(lastRunStatus);
}

export function classifyTaskOperation(input: ClassifyTaskInput): TaskOpClassification {
  const { metadata, admission } = input;
  const decisionId = str(metadata.decision_id);
  const chainId = str(metadata.chain_id);
  const chainName = str(metadata.chain_name);
  const chainLabel = chainName || chainId;

  if (isTerminalTaskStatus(input.status)) {
    return { reason: "closed", detail: `Task is ${input.status}`, source: "task.status" };
  }

  if (input.issueType === "epic") {
    return {
      reason: "epic_container",
      detail: "Epics do not run chains directly — their subtasks do",
      source: "task.issue_type",
    };
  }

  if (input.issueType === "decision") {
    return {
      reason: "waiting_human_decision",
      detail: decisionId
        ? `Waiting for decision ${decisionId}`
        : "Decision gate — waiting for a human decision",
      source: "task.issue_type + metadata.decision_id",
      decisionId,
    };
  }

  if (admission.action === "task_run_scope_invalid") {
    return {
      reason: "stale_run_scope",
      detail: "Persisted run claim is malformed or mismatched — needs repair before this task can run",
      source: "metadata.task_run_scope",
    };
  }

  if (input.activeExecutionRunId) {
    return {
      reason: "running",
      detail: chainLabel ? `Executing chain ${chainLabel}` : "Execution run is active",
      source: "runs snapshot (live run.json)",
      runId: input.activeExecutionRunId,
    };
  }

  if (input.liveSystemRun) {
    const { kind, runId } = input.liveSystemRun;
    if (kind === "recommendation") {
      return {
        reason: "awaiting_recommendation",
        detail: "Chain recommendation is running",
        source: "runs snapshot (chain-recommendation run)",
        runId,
      };
    }
    if (kind === "generation" || kind === "task_generation") {
      return {
        reason: "awaiting_generation",
        detail: "Chain generation is running",
        source: "runs snapshot (chain-generation run)",
        runId,
      };
    }
    if (kind === "audit") {
      return {
        reason: "outcome_audit_pending",
        detail: "Outcome audit run is active",
        source: "runs snapshot (run-summary-generation run)",
        runId,
      };
    }
  }

  if (metadata.last_run_decision_required === true) {
    return {
      reason: "waiting_human_decision",
      detail: "Last run requires human review",
      source: "metadata.last_run_decision_required",
      runId: str(metadata.last_run_id),
      decisionId,
    };
  }

  if (metadata.task_outcome_summary_status === "failed") {
    return {
      reason: "outcome_audit_failed",
      detail: str(metadata.task_outcome_summary_error)
        ? `Outcome audit failed: ${str(metadata.task_outcome_summary_error)}`
        : "Outcome audit failed",
      source: "metadata.task_outcome_summary_status",
      runId: str(metadata.task_outcome_summary_source_run_id) || str(metadata.last_run_id),
    };
  }

  if (
    metadata.task_outcome_summary_status === "running"
    || metadata.lifecycle_phase === "summarizing"
  ) {
    return {
      reason: "outcome_audit_pending",
      detail: "Waiting for the outcome audit to finish",
      source: "metadata.task_outcome_summary_status / lifecycle_phase",
      runId: str(metadata.task_outcome_summary_run_id),
    };
  }

  if (input.autoRunRetriesExhausted || admission.action === "max_retries") {
    return {
      reason: "paused_retries_exhausted",
      detail: `Auto-run paused after ${input.autoRunRetries} failed attempts`,
      source: "metadata.auto_run_retries",
      runId: str(metadata.last_run_id),
    };
  }

  if (input.autoRunUserPaused || admission.action === "paused") {
    const pausedReason = str(metadata.auto_run_paused_reason);
    return {
      reason: "paused_manual",
      detail: pausedReason ? `Auto-run paused: ${pausedReason}` : "Auto-run paused by a user",
      source: "metadata.auto_run_paused",
    };
  }

  const lastRunStatus = str(metadata.last_run_status);
  if (lastRunStatus && ERRORED_RUN_STATUSES.has(lastRunStatus)) {
    const error = str(metadata.last_run_error) || str(metadata.last_run_blocked_reason);
    const retrySuffix = input.retryPending ? " — automatic retry pending" : "";
    return {
      reason: "blocked_error",
      detail: (error
        ? `Last run ${lastRunStatus}: ${error}`
        : `Last run ended ${lastRunStatus}`) + retrySuffix,
      source: "metadata.last_run_status",
      runId: str(metadata.last_run_id),
    };
  }

  if (input.blockingDeps.length > 0) {
    const errored = input.blockingDeps.filter((dep) => dep.errored);
    if (errored.length > 0) {
      return {
        reason: "blocked_failed_dependency",
        detail: `Blocked because ${errored.map((d) => d.id).join(", ")} failed`,
        source: "task_dependencies + blocker run state",
      };
    }
    return {
      reason: "blocked_dependency",
      detail: `Waiting for ${input.blockingDeps.map((d) => d.id).join(", ")}`,
      source: "task_dependencies",
    };
  }

  if (admission.admit) {
    // Capacity is assigned at the view level (first N by dispatch order stay
    // "ready", overflow becomes queued_capacity) — a single task cannot know
    // its queue position.
    return {
      reason: "ready",
      detail: chainLabel
        ? `Ready — will execute chain ${chainLabel}`
        : "Ready — no chain assigned, auto-run will analyze and recommend one",
      source: "canAdmitAutoRun",
      runId: undefined,
    };
  }

  if (!input.autoRunEnabled) {
    if (chainId !== undefined) {
      return {
        reason: "awaiting_execution",
        detail: `Chain ${chainLabel} assigned — auto-run is off, waiting for a manual start`,
        source: "metadata.chain_id + resolved auto-run state",
      };
    }
    return {
      reason: "auto_run_off",
      detail: "Auto-run is off and no chain is assigned — nothing runs without a human",
      source: "resolved auto-run state",
    };
  }

  // Execution finished but the task is still open: the outcome audit closes
  // this loop (the reconcile sweep triggers it). This is the normal window
  // between a run completing and its audit landing — not an inconsistency.
  if (admission.action === "already_completed") {
    return {
      reason: "outcome_audit_pending",
      detail: "Execution completed — waiting for the outcome audit to close the loop",
      source: "metadata.last_run_status + canAdmitAutoRun",
      runId: str(metadata.last_run_id),
    };
  }

  if (input.status === "in_progress") {
    return {
      reason: "unknown_inconsistent_state",
      detail: "Task says in_progress but no active run or claim was found",
      source: "task.status vs runs snapshot",
      runId: str(metadata.last_run_id),
    };
  }

  return {
    reason: "unknown_inconsistent_state",
    detail: `Not admissible: ${admission.reason}`,
    source: "canAdmitAutoRun",
  };
}

// ---------- dependency graph helpers ----------

export interface DepEdgeInput {
  task_id: string;
  depends_on_id: string;
  type?: string | null;
}

/** Only "blocks" edges gate execution (same rule as task-ordering). */
export function blockingEdges(edges: readonly DepEdgeInput[]): DepEdgeInput[] {
  return edges.filter((edge) => !edge.type || edge.type === "blocks");
}

export interface DownstreamImpact {
  /** Open tasks directly depending on this one. */
  direct: string[];
  /** All open tasks transitively depending on this one (includes direct). */
  total: string[];
}

/**
 * Which OPEN tasks can't progress while `taskId` is unfinished. Closed
 * dependents are never counted — a historical dependency row on a closed task
 * blocks nothing.
 */
export function computeDownstreamImpact(
  taskId: string,
  edges: readonly DepEdgeInput[],
  isOpen: (id: string) => boolean,
): DownstreamImpact {
  const dependentsByBlocker = new Map<string, string[]>();
  for (const edge of blockingEdges(edges)) {
    const list = dependentsByBlocker.get(edge.depends_on_id);
    if (list) list.push(edge.task_id);
    else dependentsByBlocker.set(edge.depends_on_id, [edge.task_id]);
  }

  const direct = (dependentsByBlocker.get(taskId) ?? []).filter(isOpen);
  const total: string[] = [];
  const seen = new Set<string>([taskId]);
  const queue = [...direct];
  for (const id of direct) seen.add(id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    total.push(current);
    for (const next of dependentsByBlocker.get(current) ?? []) {
      if (seen.has(next) || !isOpen(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return { direct, total };
}

/**
 * Shortest upstream causal path from a blocked task to a root blocker
 * (a blocker with no unfinished blockers of its own, or an errored one).
 * Returns [rootBlocker, …, directBlocker] — empty when nothing blocks the task.
 */
export function shortestCausalPath(
  taskId: string,
  edges: readonly DepEdgeInput[],
  isUnfinished: (id: string) => boolean,
): string[] {
  const blockersByTask = new Map<string, string[]>();
  for (const edge of blockingEdges(edges)) {
    const list = blockersByTask.get(edge.task_id);
    if (list) list.push(edge.depends_on_id);
    else blockersByTask.set(edge.task_id, [edge.depends_on_id]);
  }

  // BFS upstream; first node whose own blockers are all finished is a root cause.
  const parent = new Map<string, string>();
  const queue: string[] = [];
  for (const blocker of blockersByTask.get(taskId) ?? []) {
    if (!isUnfinished(blocker)) continue;
    parent.set(blocker, taskId);
    queue.push(blocker);
  }
  const visited = new Set<string>(queue);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const upstream = (blockersByTask.get(current) ?? []).filter(isUnfinished);
    if (upstream.length === 0) {
      // Walk parent pointers from the root cause back toward the blocked task:
      // result is [rootBlocker, …, directBlocker].
      const path: string[] = [];
      let node: string | undefined = current;
      while (node && node !== taskId) {
        path.push(node);
        node = parent.get(node);
      }
      return path;
    }
    for (const next of upstream) {
      if (visited.has(next)) continue;
      visited.add(next);
      parent.set(next, current);
      queue.push(next);
    }
  }
  // Every upstream chain loops back — cycle. Report the direct blockers.
  return (blockersByTask.get(taskId) ?? []).filter(isUnfinished).slice(0, 1);
}

/**
 * Kahn's algorithm over the open-task blocking subgraph. Tasks left with
 * unresolved in-degree after peeling are cycle participants — there is no valid
 * execution order for them, and the view must report that as an error instead
 * of pretending there is a queue.
 */
export function detectDependencyCycles(
  openTaskIds: ReadonlySet<string>,
  edges: readonly DepEdgeInput[],
): string[] {
  const inDegree = new Map<string, number>();
  const dependentsByBlocker = new Map<string, string[]>();
  for (const id of openTaskIds) inDegree.set(id, 0);
  for (const edge of blockingEdges(edges)) {
    if (!openTaskIds.has(edge.task_id) || !openTaskIds.has(edge.depends_on_id)) continue;
    if (edge.task_id === edge.depends_on_id) continue;
    inDegree.set(edge.task_id, (inDegree.get(edge.task_id) ?? 0) + 1);
    const list = dependentsByBlocker.get(edge.depends_on_id);
    if (list) list.push(edge.task_id);
    else dependentsByBlocker.set(edge.depends_on_id, [edge.task_id]);
  }

  const queue = [...openTaskIds].filter((id) => (inDegree.get(id) ?? 0) === 0);
  let peeled = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    peeled += 1;
    for (const dependent of dependentsByBlocker.get(current) ?? []) {
      const next = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }
  if (peeled === openTaskIds.size) return [];
  return [...openTaskIds]
    .filter((id) => (inDegree.get(id) ?? 0) > 0)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// ---------- overall system verdict ----------

export type OperationsOverall = "running" | "degraded" | "blocked" | "idle" | "unhealthy";

export interface OverallInput {
  digestOverall: "ok" | "degraded" | "unhealthy";
  activeRunCount: number;
  readyCount: number;
  attentionCount: number;
  /** Open, auto-run-enabled tasks in an attention state (errors, gates, paused). */
  openBlockerCount: number;
}

export function computeOverall(input: OverallInput): OperationsOverall {
  if (input.digestOverall === "unhealthy") return "unhealthy";
  // Stalled: nothing running, nothing admissible, and open work is pinned
  // behind errors/gates — the pipeline cannot make progress without a human.
  if (input.activeRunCount === 0 && input.readyCount === 0 && input.openBlockerCount > 0) {
    return "blocked";
  }
  if (input.digestOverall === "degraded" || input.attentionCount > 0) return "degraded";
  if (input.activeRunCount > 0) return "running";
  return "idle";
}

// ---------- notification specs (idempotent by key) ----------

export interface OpsNotificationSpec {
  idempotencyKey: string;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

/** djb2 — stable short hash for error strings inside idempotency keys. */
export function stableHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

export interface NotificationStateInput {
  taskId: string;
  title: string;
  reason: TaskOpReason;
  runId?: string;
  decisionId?: string;
  retries: number;
  downstreamOpenCount: number;
  updatedAt: string;
}

export interface SystemNotificationInput {
  workerStatus: "running" | "stopped";
  workerStale: boolean;
  workerAnchor: string;
  loopErrors: Array<{ loop: string; error: string }>;
  reapedRuns: Array<{ runId: string; detail: string }>;
  /** Recently closed tasks whose open dependents became admissible. */
  unblocked: Array<{ taskId: string; closedAt: string; releasedTaskIds: string[] }>;
}

/**
 * Durable-transition notifications. Every spec carries an idempotency key
 * anchored to the persisted transition (run id, retry count, closed_at, …) so
 * repeated polls re-derive the same key and addNotification() dedupes — a
 * notification fires once per real transition, never once per poll.
 */
export function buildOperationsNotifications(
  states: readonly NotificationStateInput[],
  system: SystemNotificationInput,
): OpsNotificationSpec[] {
  const specs: OpsNotificationSpec[] = [];

  for (const state of states) {
    const base = { taskId: state.taskId, actionUrl: `/tasks?id=${encodeURIComponent(state.taskId)}` };
    if (state.reason === "blocked_error" && state.runId) {
      const blocking = state.downstreamOpenCount > 0
        ? ` — blocking ${state.downstreamOpenCount} downstream task${state.downstreamOpenCount === 1 ? "" : "s"}`
        : "";
      specs.push({
        idempotencyKey: `ops:task-error:${state.taskId}:${state.runId}`,
        type: "task_error",
        title: `${state.taskId} failed`,
        message: `${state.title}${blocking}`,
        metadata: { ...base, runId: state.runId },
      });
    } else if (state.reason === "paused_retries_exhausted") {
      specs.push({
        idempotencyKey: `ops:retries-exhausted:${state.taskId}:${state.retries}`,
        type: "task_retries_exhausted",
        title: `${state.taskId} auto-run paused`,
        message: `${state.title} — paused after ${state.retries} failed attempts`,
        metadata: base,
      });
    } else if (state.reason === "outcome_audit_failed") {
      specs.push({
        idempotencyKey: `ops:audit-failed:${state.taskId}:${state.runId ?? "no-run"}`,
        type: "task_audit_failed",
        title: `${state.taskId} outcome audit failed`,
        message: state.title,
        metadata: { ...base, runId: state.runId },
      });
    } else if (state.reason === "waiting_human_decision") {
      specs.push({
        idempotencyKey: `ops:decision-gate:${state.decisionId ?? state.taskId}`,
        type: "decision_required",
        title: `Decision needed: ${state.taskId}`,
        message: state.title,
        metadata: {
          ...base,
          decisionId: state.decisionId,
          actionUrl: state.decisionId
            ? `/decisions?id=${encodeURIComponent(state.decisionId)}`
            : base.actionUrl,
        },
      });
    }
  }

  if (system.workerStatus === "stopped" || system.workerStale) {
    specs.push({
      idempotencyKey: `ops:worker-${system.workerStatus === "stopped" ? "stopped" : "stale"}:${system.workerAnchor}`,
      type: "worker_down",
      title: system.workerStatus === "stopped" ? "Background worker stopped" : "Background worker stale",
      message: "Auto-run, reconciler, and watchdog are not making progress",
      metadata: { actionUrl: "/settings/system" },
    });
  }
  for (const loopError of system.loopErrors) {
    specs.push({
      idempotencyKey: `ops:loop-error:${loopError.loop}:${stableHash(loopError.error)}`,
      type: "loop_error",
      title: `${loopError.loop} loop error`,
      message: loopError.error,
      metadata: { actionUrl: "/activity" },
    });
  }
  for (const reaped of system.reapedRuns) {
    specs.push({
      idempotencyKey: `ops:reaped:${reaped.runId}`,
      type: "run_reaped",
      title: `Recovered dead run ${reaped.runId}`,
      message: reaped.detail,
      metadata: { runId: reaped.runId, actionUrl: `/runs?runId=${encodeURIComponent(reaped.runId)}` },
    });
  }
  for (const unblocked of system.unblocked) {
    specs.push({
      idempotencyKey: `ops:unblocked:${unblocked.taskId}:${unblocked.closedAt}`,
      type: "tasks_unblocked",
      title: `${unblocked.taskId} completed — downstream work released`,
      message: `Now eligible: ${unblocked.releasedTaskIds.join(", ")}`,
      metadata: { taskId: unblocked.taskId, actionUrl: "/activity" },
    });
  }

  return specs;
}
