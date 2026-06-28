import { opsGet, opsPatch, opsPost } from "./ops-client.js";

export async function listTasks(status?: string, _epic?: string) {
  return await opsGet(
    "/api/mentiko-mcp/ops/tasks",
    status ? { status } : undefined,
  );
}

export async function createTask(
  subject: string,
  desc?: string,
  parentId?: string,
  workspacePath?: string,
) {
  return await opsPost("/api/mentiko-mcp/ops/tasks", {
    subject,
    desc,
    parentId,
    workspacePath,
  });
}

export async function generateTasks(
  description: string,
  workspacePath?: string,
  autoRun?: boolean,
  sendToDecisionIfWarranted?: boolean,
  mode?: "task" | "decision",
) {
  // Async: returns { jobId, runId } for task generation, or
  // { routedTo: "decision", decisionId, taskId } when the prompt routes to a
  // decision (default ON; opt out with sendToDecisionIfWarranted: false).
  return await opsPost("/api/mentiko-mcp/ops/tasks/generate", {
    description,
    workspacePath,
    autoRun,
    sendToDecisionIfWarranted,
    mode,
  }) as
    | { jobId: string; runId: string; status: string }
    | { routedTo: "decision"; decisionId: string; taskId: string };
}

export async function markTaskDone(id: string) {
  return await opsPatch("/api/mentiko-mcp/ops/tasks", { id, done: true });
}
