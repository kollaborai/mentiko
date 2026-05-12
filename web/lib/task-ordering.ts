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

function compareTasks(a: SortableTask, b: SortableTask): number {
  return (
    numericPriority(a) - numericPriority(b) ||
    createdTime(a) - createdTime(b) ||
    compareIds(a.id, b.id) ||
    (a.title || "").localeCompare(b.title || "")
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
