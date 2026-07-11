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
import { resolveAutoRunState } from "@/lib/tasks/auto-run-state";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";

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

function stringValue(value: unknown): string | undefined {
  return value ? String(value) : undefined;
}

function lastRunChainName(metadata: Record<string, unknown>): string {
  const direct = stringValue(metadata.last_run_chain);
  if (direct) return direct;

  const summary = metadata.last_run_summary;
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    return stringValue((summary as Record<string, unknown>).chain) || "";
  }

  return "";
}

function misclassifiedAuditRun(metadata: Record<string, unknown>) {
  const lastRunId = stringValue(metadata.last_run_id);
  const chainName = lastRunChainName(metadata).toLowerCase();
  if (!lastRunId) return { recommendationRunId: undefined, generationRunId: undefined };

  if (chainName.includes("chain recommendation") || chainName.includes("chain-recommendation")) {
    return { recommendationRunId: lastRunId, generationRunId: undefined };
  }

  if (chainName.includes("chain generation") || chainName.includes("chain-generation")) {
    return { recommendationRunId: undefined, generationRunId: lastRunId };
  }

  return { recommendationRunId: undefined, generationRunId: undefined };
}

// raw issue -> normalized Task
export function toTask(issue: TaskRecord): Task {
  const metadata = parseMetadata(issue.metadata);
  let chainBinding: TaskChainBinding | undefined;
  if (
    metadata?.chain_id ||
    metadata?.analysis_job_id ||
    metadata?.generation_job_id ||
    metadata?.recommendation_run_id ||
    metadata?.generated_chain_run_id ||
    metadata?.auto_run !== undefined
  ) {
    const auditRun = misclassifiedAuditRun(metadata);
    const executionRunId = auditRun.recommendationRunId || auditRun.generationRunId
      ? undefined
      : stringValue(metadata.last_run_id);
    chainBinding = {
      chain_id: String(metadata.chain_id || ""),
      chain_name: stringValue(metadata.chain_name),
      auto_run: (metadata.auto_run as boolean) ?? false,
      run_config: metadata.run_config as
        | TaskChainBinding["run_config"]
        | undefined,
      last_run_id: executionRunId,
      last_run_status: executionRunId ? stringValue(metadata.last_run_status) : undefined,
      last_run_outcome: executionRunId ? stringValue(metadata.last_run_outcome) : undefined,
      last_run_decision_required:
        executionRunId && typeof metadata.last_run_decision_required === "boolean"
          ? metadata.last_run_decision_required
          : undefined,
      last_run_error: executionRunId ? stringValue(metadata.last_run_error) : undefined,
      last_run_completed: executionRunId ? stringValue(metadata.last_run_completed) : undefined,
      auto_run_retries: typeof metadata.auto_run_retries === "number" ? metadata.auto_run_retries : undefined,
      auto_run_paused: (metadata.auto_run_paused as boolean) ?? false,
      auto_run_paused_reason: stringValue(metadata.auto_run_paused_reason),
      analysis_job_id: (metadata.analysis_job_id as string) || undefined,
      analysis_status: (metadata.analysis_status as TaskChainBinding["analysis_status"]) || undefined,
      recommendation_run_id: stringValue(metadata.recommendation_run_id) || auditRun.recommendationRunId,
      recommendation_chain_id: stringValue(metadata.recommendation_chain_id) || (auditRun.recommendationRunId ? "chain-recommendation" : undefined),
      generation_job_id: (metadata.generation_job_id as string) || undefined,
      generation_status: (metadata.generation_status as TaskChainBinding["generation_status"]) || undefined,
      generated_chain_run_id: stringValue(metadata.generated_chain_run_id) || auditRun.generationRunId,
      generated_chain_source_chain_id: metadata.generated_chain_source_chain_id
        ? String(metadata.generated_chain_source_chain_id)
        : auditRun.generationRunId ? "chain-generation" : undefined,
    };
  }

  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    completed: isTerminalTaskStatus(issue.status),
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
    autoRun: resolveAutoRunState({
      explicitAutoRun: typeof metadata?.auto_run === "boolean" ? metadata.auto_run : undefined,
      workspaceDefault: issue.workspace_auto_run_default,
      retries: typeof metadata?.auto_run_retries === "number" ? metadata.auto_run_retries : 0,
      userPaused: metadata?.auto_run_paused === true,
      pausedReason: typeof metadata?.auto_run_paused_reason === "string" ? metadata.auto_run_paused_reason : "",
      completed: isTerminalTaskStatus(issue.status),
    }),
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
    decision: "DEC",
    link: "LINK",
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
    case "decision":
      return "bg-blue-500/15 text-blue-300";
    case "link":
      return "bg-cyan-500/15 text-cyan-300";
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

  for (const task of tasks) {
    if (task.type !== "epic" || epicMap.has(task.id)) continue;

    const children = tasks.filter(
      (candidate) =>
        candidate.type !== "epic" &&
        (candidate.parentId === task.id ||
          candidate.id.startsWith(`${task.id}.`))
    );

    epicMap.set(task.id, {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.rawPriority,
      total_children: children.length,
      closed_children: children.filter((child) => child.completed).length,
    });
  }

  const derivedParentIds = new Set(
    tasks
      .map((task) => task.parentId)
      .filter((parentId): parentId is string => Boolean(parentId))
      .filter((parentId) => parentId.toLowerCase().startsWith("epic"))
      .filter((parentId) => !epicMap.has(parentId))
  );
  for (const parentId of derivedParentIds) {
    const children = tasks.filter(
      (candidate) => candidate.type !== "epic" && candidate.parentId === parentId
    );
    if (children.length === 0) continue;

    epicMap.set(parentId, {
      id: parentId,
      title: parentId,
      description: "",
      status: children.every((child) => child.completed)
        ? "closed"
        : "open",
      priority: Math.min(...children.map((child) => child.rawPriority)),
      total_children: children.length,
      closed_children: children.filter((child) => child.completed).length,
    });
  }

  const includedEpicIds = new Set<string>();

  const groups = new Map<string, Task[]>();
  const ungrouped: Task[] = [];

  // index tasks by id so we can walk a task's parent chain up to its epic.
  const taskById = new Map<string, Task>();
  for (const t of tasks) taskById.set(t.id, t);

  // Resolve the epic a task rolls up to. A task may sit under a non-epic parent
  // (e.g. an auto-raised decision under a feature, or tasks generated under a
  // feature); walk up parentId until we reach a known epic so it groups under
  // that epic instead of falling into "ungrouped". Returns undefined when no
  // epic ancestor exists.
  const resolveEpicGroupId = (task: Task): string | undefined => {
    const seen = new Set<string>();
    let current: Task | undefined = task;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const pid = current.parentId;
      if (!pid) return undefined;
      if (epicMap.has(pid)) return pid;
      current = taskById.get(pid);
    }
    return undefined;
  };

  for (const task of tasks) {
    // skip epics themselves from the task list
    if (task.type === "epic") {
      if (options.includeEpics) includedEpicIds.add(task.id);
      continue;
    }

    // resolve the epic by walking the parent chain (handles tasks whose direct
    // parent is a feature, not an epic), then fall back to ID prefix matching
    // (dot notation: epic "EPIC-001" may have children "EPIC-001.1", etc)
    let matched = false;
    const epicGroupId = resolveEpicGroupId(task);
    if (epicGroupId) {
      const group = groups.get(epicGroupId) || [];
      group.push(task);
      groups.set(epicGroupId, group);
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
