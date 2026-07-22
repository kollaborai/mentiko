export interface DependencyInfo {
  blockedBy: readonly string[];
  blocks?: readonly string[];
}

export interface DependencyRow {
  task_id: string;
  depends_on_id: string;
  type?: string | null;
}

type DependencySource =
  | Map<string, DependencyInfo>
  | readonly DependencyRow[];

interface SortableTask {
  id: string;
  priority?: number | string | null;
  rawPriority?: number | null;
  created_at?: string | null;
  createdAt?: string | null;
  title?: string | null;
  label?: string | null;
  type?: string | null;
  metadata?: Record<string, unknown> | null;
}

function numericPriority(task: SortableTask): number {
  if (typeof task.rawPriority === "number") return task.rawPriority;
  if (typeof task.priority === "number") return task.priority;
  switch (task.priority) {
    case "high":
      return 0;
    case "medium":
      return 2;
    case "low":
      return 3;
    case "none":
      return 4;
    default:
      return 2;
  }
}

function createdTime(task: SortableTask): number {
  const value = task.createdAt ?? task.created_at;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function stringMeta(task: SortableTask, key: string): string | null {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberMeta(task: SortableTask, key: string): number | null {
  const value = task.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compareDecisionSequence(a: SortableTask, b: SortableTask): number {
  const decisionA = stringMeta(a, "decision_id");
  const decisionB = stringMeta(b, "decision_id");
  if (!decisionA || decisionA !== decisionB) return 0;

  const orderA = numberMeta(a, "decision_plan_order");
  const orderB = numberMeta(b, "decision_plan_order");
  if (orderA !== null && orderB !== null && orderA !== orderB) {
    return orderA - orderB;
  }

  return (
    createdTime(a) - createdTime(b) ||
    compareIds(a.id, b.id)
  );
}

function compareTasks(a: SortableTask, b: SortableTask): number {
  return (
    compareDecisionSequence(a, b) ||
    numericPriority(a) - numericPriority(b) ||
    createdTime(a) - createdTime(b) ||
    compareIds(a.id, b.id) ||
    (a.title || a.label || "").localeCompare(b.title || b.label || "")
  );
}

export function sortTasksByDependencyOrder<T extends SortableTask>(
  tasks: readonly T[],
  dependencies: DependencySource | undefined
): T[] {
  if (!dependencies || tasks.length < 2) return [...tasks];

  const ordered = [...tasks].sort(compareTasks);
  const taskIds = new Set(ordered.map((task) => task.id));
  const taskById = new Map(ordered.map((task) => [task.id, task]));
  const blockersByTask = new Map<string, Set<string>>();
  const blockedByTask = new Map<string, Set<string>>();

  const addEdge = (blockedTaskId: string, blockerTaskId: string) => {
    if (
      blockedTaskId === blockerTaskId ||
      !taskIds.has(blockedTaskId) ||
      !taskIds.has(blockerTaskId)
    ) {
      return;
    }

    if (!blockersByTask.has(blockedTaskId)) {
      blockersByTask.set(blockedTaskId, new Set());
    }
    blockersByTask.get(blockedTaskId)!.add(blockerTaskId);

    if (!blockedByTask.has(blockerTaskId)) {
      blockedByTask.set(blockerTaskId, new Set());
    }
    blockedByTask.get(blockerTaskId)!.add(blockedTaskId);
  };

  if (dependencies instanceof Map) {
    for (const task of ordered) {
      const info = dependencies.get(task.id);
      for (const blockerId of info?.blockedBy || []) {
        addEdge(task.id, blockerId);
      }
    }
  } else {
    for (const dep of dependencies) {
      if (dep.type && dep.type !== "blocks") continue;
      addEdge(dep.task_id, dep.depends_on_id);
    }
  }

  if (blockersByTask.size === 0) return ordered;

  const remainingBlockers = new Map<string, number>();
  for (const task of ordered) {
    remainingBlockers.set(task.id, blockersByTask.get(task.id)?.size || 0);
  }

  const compareTaskIds = (a: string, b: string) => {
    const taskA = taskById.get(a);
    const taskB = taskById.get(b);
    if (!taskA || !taskB) return compareIds(a, b);
    return compareTasks(taskA, taskB);
  };

  const ready = ordered
    .filter((task) => (remainingBlockers.get(task.id) || 0) === 0)
    .map((task) => task.id);
  const result: T[] = [];
  const seen = new Set<string>();

  while (ready.length > 0) {
    ready.sort(compareTaskIds);
    const id = ready.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);

    const task = taskById.get(id);
    if (task) result.push(task);

    const blockedTasks = [...(blockedByTask.get(id) || [])].sort(compareTaskIds);
    for (const blockedTaskId of blockedTasks) {
      const nextCount = (remainingBlockers.get(blockedTaskId) || 0) - 1;
      remainingBlockers.set(blockedTaskId, nextCount);
      if (nextCount === 0) {
        ready.push(blockedTaskId);
      }
    }
  }

  if (result.length === ordered.length) return result;

  const unresolved = ordered.filter((task) => !seen.has(task.id));
  return [...result, ...unresolved];
}

/**
 * Structural subset of the operations read model's per-task state
 * (TaskOpIndicatorState) that operational ordering needs. Kept structural so
 * this pure module doesn't import from components.
 */
export interface OperationalOrderState {
  reason: string;
  /** 1-based Expected Next queue position when the task is queued. */
  expectedNextPosition?: number;
  blockedDownstreamTaskIds?: readonly string[];
}

const IN_FLIGHT_REASONS = new Set([
  "awaiting_recommendation",
  "awaiting_generation",
  "awaiting_execution",
  "queued_capacity",
  "outcome_audit_pending",
]);

const ATTENTION_ORDER_REASONS = new Set([
  "blocked_error",
  "blocked_failed_dependency",
  "outcome_audit_failed",
  "stale_run_scope",
  "unknown_inconsistent_state",
  "paused_retries_exhausted",
  "waiting_human_decision",
]);

/**
 * Operational rank for sidebar ordering: active work first, then the system's
 * own pipeline steps, then the Expected Next queue, then human-actionable
 * blockers, then everything waiting, closed last.
 */
export function operationalRank(state?: OperationalOrderState): number {
  if (!state) return 5;
  if (state.reason === "running") return 0;
  if (IN_FLIGHT_REASONS.has(state.reason)) return 1;
  if (state.expectedNextPosition !== undefined) return 2;
  if (ATTENTION_ORDER_REASONS.has(state.reason)) return 3;
  if (state.reason === "paused_manual") return 4;
  if (state.reason === "closed") return 6;
  return 5;
}

/**
 * Compare two operational states within the ranking above. Equal-rank pairs
 * compare by queue position (rank 2) or downstream impact, biggest blockers
 * first (rank 3); everything else is 0 so a stable sort preserves the base
 * (dependency/priority) order.
 */
export function compareOperationalStates(
  a?: OperationalOrderState,
  b?: OperationalOrderState
): number {
  const rankA = operationalRank(a);
  const rankB = operationalRank(b);
  if (rankA !== rankB) return rankA - rankB;
  if (rankA === 2) {
    return (
      (a?.expectedNextPosition ?? Infinity) - (b?.expectedNextPosition ?? Infinity)
    );
  }
  if (rankA === 3) {
    return (
      (b?.blockedDownstreamTaskIds?.length ?? 0) -
      (a?.blockedDownstreamTaskIds?.length ?? 0)
    );
  }
  return 0;
}

/**
 * Stable re-rank of an already-ordered task list by live operational state:
 * running on top, then up-next in queue order, then blockers by downstream
 * impact. Ties keep the incoming (dependency/priority) order. Without op
 * states the list is returned unchanged.
 */
export function sortTasksByOperationalOrder<T extends { id: string }>(
  tasks: readonly T[],
  opStates?: Map<string, OperationalOrderState>
): T[] {
  if (!opStates || opStates.size === 0 || tasks.length < 2) return [...tasks];
  return [...tasks].sort((a, b) =>
    compareOperationalStates(opStates.get(a.id), opStates.get(b.id))
  );
}

export function sortTaskTreeNodes<T extends SortableTask>(
  nodes: readonly T[],
  deps: readonly { from: string; to: string }[]
): T[] {
  const dependencyRows = deps.map((dep) => ({
    task_id: dep.to,
    depends_on_id: dep.from,
    type: "blocks",
  }));

  return sortTasksByDependencyOrder(nodes, dependencyRows);
}
