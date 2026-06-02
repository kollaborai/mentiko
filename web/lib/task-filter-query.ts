import type { TaskFilterStatus, TaskFilterType } from "@/lib/task-types";

export interface TaskListQueryInput {
  status: TaskFilterStatus;
  type: TaskFilterType;
  query?: string;
  workspacePath?: string | null;
}

export function buildTaskListQuery({
  status,
  type,
  query,
  workspacePath,
}: TaskListQueryInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set("status", status === "ready" ? "all" : status);
  if (type !== "all") params.set("type", type);
  if (query?.trim()) params.set("q", query.trim());
  if (workspacePath) params.set("workspace", workspacePath);
  return params;
}
