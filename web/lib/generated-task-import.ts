import { _getDb, taskAddDep, taskCreate } from "@/lib/task-store";

type IssueType = "epic" | "feature" | "task" | "bug" | "chore";

export interface GeneratedSubtask {
  title: string;
  description?: string;
  type?: string;
  priority?: number;
  acceptance_criteria?: string | string[];
  labels?: string[];
  depends_on?: number[];
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

function generatedTaskMetadata(input: ImportGeneratedTaskTreeInput, extra?: Record<string, unknown>) {
  return {
    ...(input.metadata || {}),
    ...(input.generationJobId ? { task_generation_job_id: input.generationJobId } : {}),
    ...(input.generationRunId ? { task_generation_run_id: input.generationRunId } : {}),
    ...(input.generationChainId ? { task_generation_chain_id: input.generationChainId } : {}),
    ...(input.workspacePath ? { workspace_path: input.workspacePath } : {}),
    ...(input.autoRun === true ? { auto_run: true } : {}),
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
        workspace_id: input.workspacePath || undefined,
        metadata: generatedTaskMetadata(input, { task_generation_role: "parent" }),
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
            workspace_id: input.workspacePath || undefined,
            metadata: generatedTaskMetadata(input, {
              task_generation_role: "subtask",
              task_generation_parent_id: parent.id,
              task_generation_subtask_index: index,
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

  return createTree();
}
