import { opsGet, opsPatch, opsPost, opsDelete } from "./ops-client.js";

export interface ListTasksInput {
  status?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

// Returns { tasks (summary fields only), total, limit, offset, has_more }.
// Pass offset = prevOffset + limit while has_more is true to page through.
export async function listTasks(input: ListTasksInput = {}) {
  const params: Record<string, string> = {};
  if (input.status) params.status = input.status;
  if (input.query) params.query = input.query;
  if (input.limit !== undefined) params.limit = String(input.limit);
  if (input.offset !== undefined) params.offset = String(input.offset);
  return await opsGet("/api/mentiko-mcp/ops/tasks", params);
}

export interface CreateTaskInput {
  subject: string;
  desc?: string;
  parentId?: string;
  workspacePath?: string;
  issue_type?: string;
  priority?: number;
  owner?: string;
  assignee?: string;
  labels?: string[];
  notes?: string;
  acceptance_criteria?: string;
  design?: string;
  estimated_minutes?: number;
  due_at?: string;
}

export async function createTask(input: CreateTaskInput) {
  return await opsPost("/api/mentiko-mcp/ops/tasks", input);
}

export interface UpdateTaskFields {
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  assignee?: string;
  acceptance_criteria?: string;
  design?: string;
  notes?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  estimated_minutes?: number;
  due_at?: string;
  workspace_id?: string;
}

export async function updateTask(id: string, fields: UpdateTaskFields) {
  return await opsPatch("/api/mentiko-mcp/ops/tasks", { id, ...fields });
}

// Full record + dependency edges + comments for a single task.
export async function getTask(id: string) {
  return await opsGet("/api/mentiko-mcp/ops/tasks", { id });
}

export async function commentTask(id: string, text: string) {
  return await opsPost("/api/mentiko-mcp/ops/tasks/comment", { id, text });
}

// taskId depends on / is blocked by dependsOnId.
export async function addTaskDependency(taskId: string, dependsOnId: string) {
  return await opsPost("/api/mentiko-mcp/ops/tasks/deps", { taskId, dependsOnId });
}

export async function removeTaskDependency(taskId: string, dependsOnId: string) {
  return await opsDelete("/api/mentiko-mcp/ops/tasks/deps", { taskId, dependsOnId });
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
