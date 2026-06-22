const TASK_DETAIL_PATH_RE = /^\/tasks\/([^/?#]+)\/?$/;

export function taskDetailHref(taskId: string, search?: string | URLSearchParams): string {
  const params = new URLSearchParams(search);
  params.set("task", taskId);
  return `/tasks?${params.toString()}`;
}

export function normalizeEmbeddedTaskSelectionSearch(
  search: string | URLSearchParams,
  taskId: string,
  taskType: string,
): string {
  const params = new URLSearchParams(search);
  params.set("task", taskId);

  if (taskType === "decision") {
    params.set("type", "decision");
  } else if (params.get("type") === "decision") {
    params.delete("type");
  }

  return params.toString();
}

export function normalizeTaskNavigationRoute(route: string): string {
  if (!route) return route;

  try {
    const url = new URL(route, "http://localhost:3000");
    const match = url.pathname.match(TASK_DETAIL_PATH_RE);
    if (!match?.[1]) return route;
    return taskDetailHref(decodeURIComponent(match[1]), url.searchParams);
  } catch {
    const [pathAndQuery] = route.split("#", 1);
    const [path, rawQuery = ""] = pathAndQuery.split("?", 2);
    const match = path.match(TASK_DETAIL_PATH_RE);
    if (!match?.[1]) return route;
    return taskDetailHref(decodeURIComponent(match[1]), rawQuery);
  }
}
