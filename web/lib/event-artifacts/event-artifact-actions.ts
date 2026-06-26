import { readFileSync } from "fs";
import { importGeneratedTaskTree, type GeneratedTask } from "@/lib/tasks/generated-task-import";
import { taskAddComment, taskGet, taskMergeMeta } from "@/lib/tasks/task-store";

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
  const result = importGeneratedTaskTree({
    namespaceId: input.namespaceId,
    orgId: input.orgId,
    generated,
    workspacePath: input.workspacePath,
    parentId: input.parentTaskId,
    createdBy: input.createdBy,
    generationJobId: `event-artifact:${input.namespaceId}:${input.orgId}:${input.runId}:${input.executionId}`,
    generationRunId: input.runId,
    autoRun: false,
    metadata: {
      event_artifact_execution_id: input.executionId,
      event_artifact_run_id: input.runId,
      event_artifact_artifact_path: input.artifactPath,
    },
  });

  const parent = taskGet(input.orgId, input.parentTaskId, input.namespaceId);
  if (parent) {
    taskMergeMeta(input.orgId, input.parentTaskId, {
      auto_run: false,
      event_artifact_status: "waiting_on_children",
      event_artifact_execution_id: input.executionId,
      event_artifact_run_id: input.runId,
      event_artifact_artifact_path: input.artifactPath,
      event_artifact_child_task_ids: result.createdTaskIds,
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
