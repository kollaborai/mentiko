import { readFileSync } from "fs";
import type { GeneratedTask } from "@/lib/tasks/generated-task-import";
import { _getDb, taskAddComment, taskAddDep, taskCreate, taskGet, taskMergeMeta } from "@/lib/tasks/task-store";

export interface ApplyDraftChildTasksInput {
  namespaceId: string;
  orgId: string;
  parentTaskId: string;
  draftTaskPath: string;
  executionId: string;
  runId: string;
  artifactPath: string;
  createdBy: string;
  workspacePath?: string;
}

export function applyDraftChildTasks(input: ApplyDraftChildTasksInput) {
  const generated = JSON.parse(readFileSync(input.draftTaskPath, "utf8")) as GeneratedTask;
  const generationJobId = `event-artifact:${input.namespaceId}:${input.orgId}:${input.runId}:${input.executionId}`;
  const result = createFollowUpChildTask(input, generated, generationJobId);

  const parent = taskGet(input.orgId, input.parentTaskId, input.namespaceId);
  if (parent) {
    for (const childTaskId of result.createdTaskIds) {
      try {
        taskAddDep(input.orgId, input.parentTaskId, childTaskId, input.namespaceId, input.workspacePath);
      } catch {
        // best effort; duplicate/missing dependencies should not hide created tasks
      }
    }
    taskMergeMeta(input.orgId, input.parentTaskId, {
      event_artifact_status: "waiting_on_children",
      event_artifact_execution_id: input.executionId,
      event_artifact_run_id: input.runId,
      event_artifact_artifact_path: input.artifactPath,
      event_artifact_child_task_ids: result.createdTaskIds,
      event_artifact_blocks_auto_run: true,
    }, input.namespaceId);
    if (result.created) {
      taskAddComment(
        input.orgId,
        input.parentTaskId,
        input.createdBy,
        `Quality gate triage created child tasks: ${result.createdTaskIds.join(", ")}`,
        input.namespaceId,
      );
    }
  }

  return result;
}

function createFollowUpChildTask(
  input: ApplyDraftChildTasksInput,
  generated: GeneratedTask,
  generationJobId: string,
) {
  const existing = findExistingFollowUp(input.namespaceId, input.orgId, generationJobId);
  if (existing) return existing;

  const subtaskLines = (generated.subtasks || [])
    .map((subtask, index) => `${index + 1}. ${subtask.title}${subtask.description ? `\n   ${subtask.description}` : ""}`);
  const description = [
    generated.description || "",
    subtaskLines.length ? "Follow-up checklist:" : "",
    ...subtaskLines,
  ].filter(Boolean).join("\n\n");
  const acceptance = Array.isArray(generated.acceptance_criteria)
    ? generated.acceptance_criteria.join("\n")
    : generated.acceptance_criteria;

  const created = taskCreate(
    input.orgId,
    {
      title: generated.title,
      description,
      issue_type: generated.type === "bug" ? "bug" : "task",
      priority: generated.priority ?? 1,
      labels: generated.labels,
      acceptance_criteria: acceptance,
      parent_id: input.parentTaskId,
      created_by: input.createdBy,
      workspace_id: input.workspacePath || undefined,
      metadata: {
        task_generation_job_id: generationJobId,
        task_generation_run_id: input.runId,
        task_generation_role: "event_artifact_followup",
        event_artifact_execution_id: input.executionId,
        event_artifact_run_id: input.runId,
        event_artifact_artifact_path: input.artifactPath,
      },
    },
    input.namespaceId,
  );

  return {
    parentId: input.parentTaskId,
    tasks: [{ id: created.id, title: created.title, type: created.issue_type, priority: created.priority }],
    createdTaskIds: [created.id],
    created: true,
  };
}

function findExistingFollowUp(namespaceId: string, orgId: string, generationJobId: string) {
  const db = _getDb(namespaceId);
  const rows = db.prepare(`
    SELECT id, title, issue_type, priority
    FROM tasks
    WHERE org_id = ?
    ORDER BY created_at ASC
  `).all(orgId) as Array<{
    id: string;
    title: string;
    issue_type: string;
    priority: number;
  }>;

  for (const row of rows) {
    const task = taskGet(orgId, row.id, namespaceId);
    if (task?.metadata?.task_generation_job_id !== generationJobId) continue;
    return {
      parentId: task.parent_id || row.id,
      tasks: [{ id: row.id, title: row.title, type: row.issue_type, priority: row.priority }],
      createdTaskIds: [row.id],
      created: false,
    };
  }

  return null;
}
