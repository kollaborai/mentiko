import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { taskList } from "@/lib/tasks/task-store";
import { isTerminalTaskStatus } from "@/lib/tasks/task-status";
import { filterVisibleTaskRecordsWithVisibleParents } from "@/lib/tasks/task-visibility";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/tasks/epics - get epic status with completion progress (requires view_tasks)
export const GET = requirePermission("view_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const workspaceId = getWorkspaceId(request);
    if (hasWorkspaceParam(request) && !workspaceId) {
      return apiSuccess({ epics: [] });
    }

    const allTasks = filterVisibleTaskRecordsWithVisibleParents(
      taskList(orgId, { status: "all" }, workspaceId, namespaceId),
    );
    const allEpics = allTasks.filter((task) => task.issue_type === "epic");

    const epics = allEpics.map((epic) => {
      // match children by parent_id field OR by ID prefix (legacy dot notation)
      const children = allTasks.filter(
        (t) =>
          t.parent_id === epic.id ||
          (t.id.startsWith(epic.id + ".") && t.issue_type !== "epic")
      );
      const closedChildren = children.filter((child) => isTerminalTaskStatus(child.status)).length;

      return {
        id: epic.id,
        title: epic.title,
        description: epic.description,
        status: epic.status,
        priority: epic.priority,
        total_children: children.length,
        closed_children: closedChildren,
      };
    });

    return apiSuccess({ epics });
  })
);
