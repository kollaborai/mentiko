export interface RunsListQueryInput {
  workspacePath?: string | null;
  taskFilter?: string | null;
  runIdFilter?: string | null;
  limit?: number;
}

export function buildRunsListQuery({
  workspacePath,
  taskFilter,
  limit = 100,
}: RunsListQueryInput): URLSearchParams {
  const params = new URLSearchParams();
  params.append("limit", String(limit));
  if (workspacePath) params.append("workspace", workspacePath);
  if (taskFilter) params.append("task", taskFilter);
  return params;
}
