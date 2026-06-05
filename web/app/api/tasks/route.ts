import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { taskList } from "@/lib/tasks/task-store";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

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

    const issues = taskList(orgId, {
      status: status || undefined,
      issue_type: type || undefined,
      assignee: assignee || undefined,
      query: search || undefined,
    }, workspaceId, namespaceId);

    return apiSuccess({ issues });
  })
);
