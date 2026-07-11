import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { taskList } from "@/lib/tasks/task-store";
import { filterVisibleTaskRecordsWithVisibleParents } from "@/lib/tasks/task-visibility";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveTaskAutoRunDefault } from "@/lib/tasks/task-auto-run-default";

export const dynamic = "force-dynamic";

// GET /api/tasks - list, search, or query tasks (requires view_tasks)
export const GET = requirePermission("view_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("q") || searchParams.get("search");
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const assignee = searchParams.get("assignee");
    const workspaceId = getWorkspaceId(request);

    // workspace was explicitly requested but has no tasks
    if (hasWorkspaceParam(request) && !workspaceId) {
      return apiSuccess({ issues: [] });
    }

    // Hide superseded decision gates the same way detail/deps/graph already
    // do (task-visibility.ts) -- otherwise a superseded gate shows up in this
    // list and then 404s when clicked through to /api/tasks/[id].
    const issues = filterVisibleTaskRecordsWithVisibleParents(taskList(orgId, {
      status: status || undefined,
      issue_type: type || undefined,
      assignee: assignee || undefined,
      query: search || undefined,
    }, workspaceId, namespaceId));

    // Enrich each record with its workspace auto-run default so the client-side
    // toTask() can resolve Task.autoRun (the workspace default is fs-backed and
    // can only be read here). Cached per workspace path -> one read per workspace.
    const wsDefaultCache = new Map<string, boolean>();
    const enriched = issues.map((issue) => {
      const wsPath = typeof issue.workspace_id === "string" ? issue.workspace_id : "";
      if (!wsPath) return { ...issue, workspace_auto_run_default: false };
      let wsDefault = wsDefaultCache.get(wsPath);
      if (wsDefault === undefined) {
        wsDefault = resolveTaskAutoRunDefault({ namespaceId, orgId, workspacePath: wsPath });
        wsDefaultCache.set(wsPath, wsDefault);
      }
      return { ...issue, workspace_auto_run_default: wsDefault };
    });

    return apiSuccess({ issues: enriched });
  })
);
