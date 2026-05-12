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
) {
  return await opsPost("/api/mentiko-mcp/ops/tasks/generate", {
    description,
    workspacePath,
    autoRun,
  }, {
    timeoutMs: 130_000,
  });
}

export async function markTaskDone(id: string) {
  return await opsPatch("/api/mentiko-mcp/ops/tasks", { id, done: true });
}
