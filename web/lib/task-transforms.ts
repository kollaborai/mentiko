// pure transform functions: task store JSON -> component props

import type {
  TaskRecord,
  EpicStatus,
  GraphOutput,
  Task,
  TaskPriority,
  TaskChainBinding,
} from "./task-types";
import type { GoalStatus } from "@/components/ui/goal-card";

// priority 0-4 -> UI priority
export function mapPriority(rawPriority: number): TaskPriority {
  if (rawPriority <= 1) return "high";
  if (rawPriority === 2) return "medium";
  if (rawPriority === 3) return "low";
  return "none";
}

// numeric sort order for priorities
export function priorityOrder(p: TaskPriority): number {
  switch (p) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    default:
      return 3;
  }
}

// parse metadata - may be string or object depending on context
function parseMetadata(
  raw: string | Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
}

// raw issue -> normalized Task
export function toTask(issue: TaskRecord): Task {
  const metadata = parseMetadata(issue.metadata);
  let chainBinding: TaskChainBinding | undefined;
  if (metadata?.chain_id || metadata?.analysis_job_id || metadata?.generation_job_id || metadata?.auto_run !== undefined) {
    chainBinding = {
      chain_id: String(metadata.chain_id || ""),
      chain_name: metadata.chain_name ? String(metadata.chain_name) : undefined,
      auto_run: (metadata.auto_run as boolean) ?? false,
      run_config: metadata.run_config as
        | TaskChainBinding["run_config"]
        | undefined,
      last_run_id: metadata.last_run_id ? String(metadata.last_run_id) : undefined,
      last_run_status: metadata.last_run_status ? String(metadata.last_run_status) : undefined,
      last_run_outcome: metadata.last_run_outcome ? String(metadata.last_run_outcome) : undefined,
      last_run_decision_required:
        typeof metadata.last_run_decision_required === "boolean"
          ? metadata.last_run_decision_required
          : undefined,
      last_run_error: metadata.last_run_error ? String(metadata.last_run_error) : undefined,
      last_run_completed: metadata.last_run_completed ? String(metadata.last_run_completed) : undefined,
      auto_run_retries: typeof metadata.auto_run_retries === "number" ? metadata.auto_run_retries : undefined,
      analysis_job_id: (metadata.analysis_job_id as string) || undefined,
      analysis_status: (metadata.analysis_status as TaskChainBinding["analysis_status"]) || undefined,
      generation_job_id: (metadata.generation_job_id as string) || undefined,
      generation_status: (metadata.generation_status as TaskChainBinding["generation_status"]) || undefined,
    };
  }

  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    completed: issue.status === "closed",
    status: issue.status as Task["status"],
    priority: mapPriority(issue.priority),
    rawPriority: issue.priority,
    type: issue.issue_type,
    owner: issue.owner || "",
    assignee: issue.assignee || "",
    createdBy: issue.created_by || "",
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at,
    labels: issue.labels || [],
    dueDate: issue.due_at,
    estimate: issue.estimated_minutes,
    dependencyCount: issue.dependency_count || 0,
    dependentCount: issue.dependent_count || 0,
    commentCount: issue.comment_count || 0,
    chainBinding,
    parentId: issue.parent_id,
    acceptance: issue.acceptance_criteria,
    design: issue.design,
    notes: issue.notes,
    metadata: metadata || undefined,
  };
}

// epic status -> GoalCard props
export function epicToGoalProps(epic: EpicStatus) {
  const progress =
    epic.total_children > 0
      ? Math.round((epic.closed_children / epic.total_children) * 100)
      : 0;

  let status: GoalStatus = "pending";
  if (
    epic.closed_children === epic.total_children &&
    epic.total_children > 0
  ) {
    status = "completed";
  } else if (epic.closed_children > 0) {
    status = "in_progress";
  }

  return {
    id: epic.id,
    title: epic.title,
    description: epic.description || "",
    progress,
    status,
    meta: `${epic.closed_children}/${epic.total_children} done`,
  };
}

// dependency graph -> { nodes, links } for visualization
export function graphToNodes(graph: GraphOutput) {
  const nodes: Array<{
    id: string;
    label: string;
    type: string;
    status: string;
    layer: number;
    position: number;
  }> = [];

  const links: Array<{
    source: string;
    target: string;
    type: string;
  }> = [];

  for (const [id, node] of Object.entries(graph.layout.Nodes)) {
    if (!node?.Issue) continue;
    nodes.push({
      id,
      label: node.Issue.title,
      type: node.Issue.issue_type,
      status: node.Issue.status,
      layer: node.Layer,
      position: node.Position,
    });

    if (Array.isArray(node.DependsOn)) {
      for (const depId of node.DependsOn) {
        links.push({ source: depId, target: id, type: "blocks" });
      }
    }
  }

  return { nodes, links, layers: graph.layout.Layers };
}

// priority -> tailwind color class
export function priorityColor(p: TaskPriority): string {
  switch (p) {
    case "high":
      return "text-red-400";
    case "medium":
      return "text-amber-400";
    case "low":
      return "text-blue-400";
    default:
      return "text-foreground/40";
  }
}

// priority -> bg color class (for badges)
export function priorityBgColor(p: TaskPriority): string {
  switch (p) {
    case "high":
      return "bg-red-500/15 text-red-400";
    case "medium":
      return "bg-amber-500/15 text-amber-400";
    case "low":
      return "bg-blue-500/15 text-blue-400";
    default:
      return "bg-foreground/5 text-foreground/40";
  }
}

// issue type -> short label
export function typeLabel(t: string): string {
  const map: Record<string, string> = {
    epic: "EPIC",
    feature: "FEAT",
    task: "TASK",
    bug: "BUG",
    chore: "CHORE",
  };
  return map[t] || t.toUpperCase();
}

// issue type -> tailwind color class
export function typeBgColor(t: string): string {
  switch (t) {
    case "epic":
      return "bg-purple-500/15 text-purple-400";
    case "feature":
      return "bg-green-500/15 text-green-400";
    case "bug":
      return "bg-red-500/15 text-red-400";
    case "chore":
      return "bg-foreground/5 text-foreground/40";
    default:
      return "bg-foreground/5 text-foreground/50";
  }
}

// group tasks by parent epic
export function groupByEpic(
  tasks: Task[],
  epics: EpicStatus[],
  options: { includeEpics?: boolean } = {}
): { epic: EpicStatus | null; tasks: Task[] }[] {
  const epicMap = new Map<string, EpicStatus>();
  for (const e of epics) {
    epicMap.set(e.id, e);
  }
  const includedEpicIds = new Set<string>();

  const groups = new Map<string, Task[]>();
  const ungrouped: Task[] = [];

  for (const task of tasks) {
    // skip epics themselves from the task list
    if (task.type === "epic") {
      if (options.includeEpics) includedEpicIds.add(task.id);
      continue;
    }

    // try parentId first, then fall back to ID prefix matching
    // (dot notation: epic "EPIC-001" may have children "EPIC-001.1", etc)
    let matched = false;
    if (task.parentId && epicMap.has(task.parentId)) {
      const group = groups.get(task.parentId) || [];
      group.push(task);
      groups.set(task.parentId, group);
      matched = true;
    } else {
      for (const epicId of epicMap.keys()) {
        if (task.id.startsWith(epicId + ".")) {
          const group = groups.get(epicId) || [];
          group.push(task);
          groups.set(epicId, group);
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      ungrouped.push(task);
    }
  }

  const result: { epic: EpicStatus | null; tasks: Task[] }[] = [];

  // epics in priority order
  const sortedEpics = [...epicMap.values()].sort(
    (a, b) => a.priority - b.priority
  );

  for (const epic of sortedEpics) {
    const epicTasks = groups.get(epic.id);
    if (epicTasks && epicTasks.length > 0) {
      result.push({ epic, tasks: epicTasks });
    } else if (includedEpicIds.has(epic.id)) {
      result.push({ epic, tasks: [] });
    }
  }

  if (ungrouped.length > 0) {
    result.push({ epic: null, tasks: ungrouped });
  }

  return result;
}

// relative time formatting
export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
