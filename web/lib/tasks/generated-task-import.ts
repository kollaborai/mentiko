import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "@/lib/config";
import { _getDb, taskAddDep, taskCreate, taskGet } from "@/lib/tasks/task-store";
import { createTaskDecision } from "@/lib/tasks/task-decision-link";
import { resolveTaskAutoRunDefault } from "@/lib/tasks/task-auto-run-default";
import { isTaskWorkMode } from "@/lib/tasks/work-mode";

type IssueType = "epic" | "feature" | "task" | "bug" | "chore";

export interface GeneratedSubtask {
  title: string;
  description?: string;
  type?: string;
  priority?: number;
  acceptance_criteria?: string | string[];
  labels?: string[];
  depends_on?: number[];
  work_mode?: string;
}

export interface GeneratedTask {
  title: string;
  description?: string;
  type?: string;
  priority?: number;
  acceptance_criteria?: string | string[];
  design?: string;
  design_notes?: string | string[];
  notes?: string;
  labels?: string[];
  subtasks?: GeneratedSubtask[];
  work_mode?: string;
}

export interface CreatedTaskSummary {
  id: string;
  title: string;
  type: string;
  priority: number;
}

interface ImportGeneratedTaskTreeInput {
  namespaceId: string;
  orgId: string;
  generated: GeneratedTask;
  workspacePath?: string;
  parentId?: string;
  createdBy: string;
  generationJobId?: string;
  generationRunId?: string;
  generationChainId?: string;
  autoRun?: boolean;
  metadata?: Record<string, unknown>;
}

interface ImportGeneratedTaskTreeResult {
  parentId: string;
  tasks: CreatedTaskSummary[];
  createdTaskIds: string[];
  created: boolean;
}

function normalizeTextOrArray(val: string | string[] | undefined | null): string | undefined {
  if (!val) return undefined;
  if (Array.isArray(val)) return val.join("\n");
  return val;
}

function issueType(value: string | undefined, fallback: IssueType): IssueType {
  if (value === "epic" || value === "feature" || value === "task" || value === "bug" || value === "chore") {
    return value;
  }
  return fallback;
}

// Read the generating run's workspace from run.json. The run always knows its
// workspace (workspacePath/workspaceId), so this is the ground-truth fallback
// when no workspace was threaded into the generate call. Returns undefined if
// the run is unscoped, missing, or unreadable (never throws).
function readRunWorkspacePath(runId?: string): string | undefined {
  if (!runId) return undefined;
  try {
    const runsDir = (config as { runsDir?: string }).runsDir;
    if (!runsDir) return undefined;
    const runJsonPath = join(runsDir, runId, "run.json");
    if (!existsSync(runJsonPath)) return undefined;
    const data = JSON.parse(readFileSync(runJsonPath, "utf8")) as {
      workspacePath?: string;
      workspaceId?: string;
    };
    if (typeof data.workspacePath === "string" && data.workspacePath.trim()) return data.workspacePath;
    if (typeof data.workspaceId === "string" && data.workspaceId.trim()) return data.workspaceId;
    return undefined;
  } catch {
    return undefined;
  }
}

// Look up an existing parent task's workspace_id (e.g. generating under an
// existing epic). Returns undefined if there's no parent or the parent is
// itself unscoped.
function parentTaskWorkspaceId(
  namespaceId: string,
  orgId: string,
  parentId?: string,
): string | undefined {
  if (!parentId) return undefined;
  try {
    const parent = taskGet(orgId, parentId, namespaceId);
    return parent?.workspace_id ?? undefined;
  } catch {
    return undefined;
  }
}

// Resolve the effective workspace for a generated tree, preferring the most
// specific source. Order: explicit workspacePath -> existing parent's
// workspace_id -> the generating run's workspace. Falls back to undefined only
// when no workspace is knowable (a genuinely global task).
function resolveEffectiveWorkspace(input: ImportGeneratedTaskTreeInput): string | undefined {
  return (
    input.workspacePath ||
    parentTaskWorkspaceId(input.namespaceId, input.orgId, input.parentId) ||
    readRunWorkspacePath(input.generationRunId)
  );
}

function generatedTaskMetadata(
  input: ImportGeneratedTaskTreeInput,
  effectiveWorkspace: string | undefined,
  extra?: Record<string, unknown>,
) {
  const autoRun = resolveTaskAutoRunDefault({
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    workspacePath: effectiveWorkspace,
    explicitAutoRun: input.autoRun,
  });
  return {
    ...(input.metadata || {}),
    ...(input.generationJobId ? { task_generation_job_id: input.generationJobId } : {}),
    ...(input.generationRunId ? { task_generation_run_id: input.generationRunId } : {}),
    ...(input.generationChainId ? { task_generation_chain_id: input.generationChainId } : {}),
    ...(effectiveWorkspace ? { workspace_path: effectiveWorkspace } : {}),
    ...(autoRun ? { auto_run: true } : {}),
    ...extra,
  };
}

function findExistingImportedTree(
  namespaceId: string,
  orgId: string,
  generationJobId: string,
): ImportGeneratedTaskTreeResult | null {
  const db = _getDb(namespaceId);
  const rows = db.prepare(`
    SELECT id, title, issue_type, priority, parent_id, metadata, created_at
    FROM tasks
    WHERE org_id = ?
    ORDER BY created_at ASC
  `).all(orgId) as Array<{
    id: string;
    title: string;
    issue_type: string;
    priority: number;
    parent_id: string | null;
    metadata: string;
  }>;

  const matching = rows.filter((row) => {
    try {
      const metadata = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
      return metadata.task_generation_job_id === generationJobId;
    } catch {
      return false;
    }
  });

  if (matching.length === 0) return null;

  const parent = matching.find((row) => {
    try {
      const metadata = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
      return metadata.task_generation_role === "parent";
    } catch {
      return false;
    }
  }) ?? matching.find((row) => !row.parent_id) ?? matching[0];

  const tasks = matching.map((row) => ({
    id: row.id,
    title: row.title,
    type: row.issue_type,
    priority: row.priority,
  }));

  return {
    parentId: parent.id,
    tasks,
    createdTaskIds: tasks.map((task) => task.id),
    created: false,
  };
}

export function importGeneratedTaskTree(input: ImportGeneratedTaskTreeInput): ImportGeneratedTaskTreeResult {
  if (!input.generated?.title?.trim()) {
    throw new Error("generated task title is required");
  }

  if (input.generationJobId) {
    const existing = findExistingImportedTree(input.namespaceId, input.orgId, input.generationJobId);
    if (existing) return existing;
  }

  const createTree = _getDb(input.namespaceId).transaction(() => {
    const hasSubtasks = Boolean(input.generated.subtasks?.length);
    const parentIssueType = hasSubtasks ? "epic" : issueType(input.generated.type, "task");
    // Resolve once: explicit workspace wins, then inherit from an existing
    // parent task, then the generating run's workspace. Stamped on every task
    // in the tree so generated tasks are never orphaned out of /tasks.
    const effectiveWorkspace = resolveEffectiveWorkspace(input);

    const parent = taskCreate(
      input.orgId,
      {
        title: input.generated.title,
        description: input.generated.description ?? "",
        issue_type: parentIssueType,
        priority: input.generated.priority ?? 2,
        labels: input.generated.labels,
        acceptance_criteria: normalizeTextOrArray(input.generated.acceptance_criteria),
        design: normalizeTextOrArray(input.generated.design ?? input.generated.design_notes),
        notes: input.generated.notes,
        parent_id: input.parentId,
        created_by: input.createdBy,
        workspace_id: effectiveWorkspace,
        metadata: generatedTaskMetadata(input, effectiveWorkspace, {
          task_generation_role: "parent",
          // Persist the authoritative work_mode on leaf tasks so the delivery gate
          // reads intent instead of guessing from issue_type. Skip epics: they are
          // containers that close on their subtasks, and the gate exempts them.
          ...(parentIssueType !== "epic" && isTaskWorkMode(input.generated.work_mode)
            ? { work_mode: input.generated.work_mode }
            : {}),
        }),
      },
      input.namespaceId,
    );

    const created: CreatedTaskSummary[] = [
      { id: parent.id, title: parent.title, type: parent.issue_type, priority: parent.priority },
    ];
    const subtaskIds: string[] = [];

    if (input.generated.subtasks?.length) {
      for (let index = 0; index < input.generated.subtasks.length; index++) {
        const subtask = input.generated.subtasks[index];
        const child = taskCreate(
          input.orgId,
          {
            title: subtask.title,
            description: subtask.description ?? "",
            issue_type: issueType(subtask.type, "task"),
            priority: subtask.priority ?? 2,
            labels: subtask.labels,
            acceptance_criteria: normalizeTextOrArray(subtask.acceptance_criteria),
            parent_id: parent.id,
            created_by: input.createdBy,
            workspace_id: effectiveWorkspace,
            metadata: generatedTaskMetadata(input, effectiveWorkspace, {
              task_generation_role: "subtask",
              task_generation_parent_id: parent.id,
              task_generation_subtask_index: index,
              ...(issueType(subtask.type, "task") !== "epic" && isTaskWorkMode(subtask.work_mode)
                ? { work_mode: subtask.work_mode }
                : {}),
            }),
          },
          input.namespaceId,
        );
        subtaskIds.push(child.id);
        created.push({ id: child.id, title: child.title, type: child.issue_type, priority: child.priority });
      }

      for (let index = 0; index < input.generated.subtasks.length; index++) {
        const deps = input.generated.subtasks[index].depends_on;
        if (!deps?.length) continue;
        const fromId = subtaskIds[index];
        if (!fromId) continue;
        for (const depIdx of deps) {
          const toId = subtaskIds[depIdx];
          if (!toId) continue;
          taskAddDep(input.orgId, fromId, toId, input.namespaceId, input.workspacePath || undefined);
        }
      }
    }

    return {
      parentId: parent.id,
      tasks: created,
      createdTaskIds: created.map((task) => task.id),
      created: true,
    };
  });

  try {
    return createTree();
  } catch (error) {
    // A concurrent completion callback may win the unique generation-job root
    // claim after our optimistic read but before this transaction inserts.
    // Rediscover that exact tree and return it; never turn a harmless replay
    // race into a failed job or a duplicate import.
    if (input.generationJobId) {
      const existing = findExistingImportedTree(input.namespaceId, input.orgId, input.generationJobId);
      if (existing) return existing;
    }
    throw error;
  }
}

// ---------- agent-as-gate: honor the generation agent's route decision --------

/**
 * Outcome of processing a completed task-generation job. The agent acts as a
 * gate: it returns either a task tree or a decision hand-back. This helper
 * inspects that decision and creates the right entity.
 */
export type GenerationOutcome =
  | { kind: "task"; parentId: string; createdTaskIds: string[]; tasks: CreatedTaskSummary[] }
  | { kind: "decision"; decisionId: string; taskId: string; reason?: string };

interface ProcessTaskGenerationResultInput {
  namespaceId: string;
  orgId: string;
  /** Parsed agent output: { route?: "task"|"decision", task?: GeneratedTask, reason?: string } (or a bare GeneratedTask). */
  result: Record<string, unknown>;
  workspacePath?: string;
  parentId?: string;
  createdBy: string;
  generationJobId?: string;
  generationRunId?: string;
  generationChainId?: string;
  autoRun?: boolean;
  /** Default true. When false, decision hand-backs are ignored and a task is always produced. */
  allowDecisionRouting?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Process the generation agent's gated output:
 *  - route "decision" (and routing allowed) -> createTaskDecision -> decision outcome
 *  - otherwise -> importGeneratedTaskTree(result.task ?? result) -> task outcome
 *
 * Defensive: a bare task object (no route field) is treated as route "task",
 * so older/non-envelope outputs still import correctly.
 */
export async function processTaskGenerationResult(
  input: ProcessTaskGenerationResultInput,
): Promise<GenerationOutcome> {
  const result = input.result as {
    route?: unknown;
    task?: GeneratedTask;
    reason?: unknown;
  };
  const allowDecisionRouting = input.allowDecisionRouting !== false;
  const wantsDecision = allowDecisionRouting && result?.route === "decision";

  if (wantsDecision) {
    const reason =
      typeof result.reason === "string" && result.reason.trim()
        ? result.reason.trim()
        : "Routed to a decision during task generation.";
    const { decision, task } = await createTaskDecision({
      namespaceId: input.namespaceId,
      orgId: input.orgId,
      prompt: reason,
      source: "task-generate",
      workspacePath: input.workspacePath,
      parentTaskId: input.parentId,
      generationJobId: input.generationJobId,
    });
    return { kind: "decision", decisionId: decision.id, taskId: task.id, reason };
  }

  // Task path: unwrap the envelope, fall back to a bare task object.
  const generated = (result?.task ?? (result as unknown as GeneratedTask)) as GeneratedTask;
  const importResult = importGeneratedTaskTree({
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    generated,
    workspacePath: input.workspacePath,
    parentId: input.parentId,
    createdBy: input.createdBy,
    generationJobId: input.generationJobId,
    generationRunId: input.generationRunId,
    generationChainId: input.generationChainId,
    autoRun: input.autoRun,
    metadata: input.metadata,
  });
  return {
    kind: "task",
    parentId: importResult.parentId,
    createdTaskIds: importResult.createdTaskIds,
    tasks: importResult.tasks,
  };
}
