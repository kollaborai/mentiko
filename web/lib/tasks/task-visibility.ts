import type { Task, TaskRecord } from "./task-types";

export interface VisibilityTask {
  id: string;
  issue_type?: string | null;
  type?: string | null;
  parent_id?: string | null;
  parentId?: string;
  metadata?: unknown;
}

function metadataRecord(value: unknown): Record<string, unknown> {
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
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function taskType(task: VisibilityTask): string {
  return task.issue_type || task.type || "";
}

function parentId(task: VisibilityTask): string | undefined {
  return task.parent_id || task.parentId;
}

export function supersededDecisionGateIds(tasks: readonly VisibilityTask[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    const metadata = metadataRecord(task.metadata);
    for (const id of stringArray(metadata.superseded_decision_subtask_ids)) {
      ids.add(id);
    }
  }
  return ids;
}

export function isHiddenDecisionGate(task: VisibilityTask, supersededIds?: Set<string>): boolean {
  if (taskType(task) !== "decision") return false;
  const metadata = metadataRecord(task.metadata);
  return metadata.decision_status === "superseded" || supersededIds?.has(task.id) === true;
}

export function filterVisibleTaskRecords<T extends VisibilityTask>(tasks: readonly T[]): T[] {
  const supersededIds = supersededDecisionGateIds(tasks);
  return tasks.filter((task) => !isHiddenDecisionGate(task, supersededIds));
}

// Use only when `tasks` is the complete collection for the surface being
// returned. A visible child must not retain a navigable parent pointer to an
// invisible superseded decision gate.
export function filterVisibleTaskRecordsWithVisibleParents<T extends VisibilityTask>(tasks: readonly T[]): T[] {
  const visible = filterVisibleTaskRecords(tasks);
  const visibleIds = new Set(visible.map((task) => task.id));

  return visible.map((task) => {
    const id = parentId(task);
    if (!id || visibleIds.has(id)) return task;
    if ("parent_id" in task) return { ...task, parent_id: null } as T;
    if ("parentId" in task) return { ...task, parentId: undefined } as T;
    return task;
  });
}

export function filterVisibleTasks<T extends Task>(tasks: T[]): T[] {
  const supersededIds = supersededDecisionGateIds(tasks);
  return tasks.filter((task) => !isHiddenDecisionGate(task, supersededIds));
}

export function visibleTaskRecordIds(tasks: TaskRecord[]): string[] {
  return filterVisibleTaskRecords(tasks).map((task) => task.id);
}

export function visibleChildTaskRecords<T extends VisibilityTask>(tasks: T[], parentTaskId: string): T[] {
  const visible = filterVisibleTaskRecords(tasks);
  return visible.filter((task) => task.parent_id === parentTaskId);
}

export function visibleChildTasks<T extends Task>(tasks: T[], parentTaskId: string): T[] {
  const visible = filterVisibleTasks(tasks);
  return visible.filter((task) => parentId(task) === parentTaskId);
}
