import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import { taskGetActivity } from "@/lib/task-store";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspace-params";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Validate duration format (e.g., "24h", "7d", "4w", "1m")
function validateDuration(duration: string): string {
  if (!/^(\d+)[hdwm]$/.test(duration)) {
    throw new InternalServerError("Invalid duration format. Use: <number><h|d|w|m> (e.g., 24h, 7d, 4w, 1m)");
  }
  return duration;
}

// GET /api/tasks/activity?since=24h - get recent activity feed (requires view_tasks)
export const GET = requirePermission("view_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const workspaceId = getWorkspaceId(request);
    if (hasWorkspaceParam(request) && !workspaceId) {
      return apiSuccess({ activity: [] });
    }

    const { searchParams } = new URL(request.url);
    const since = searchParams.get("since") || "24h";

    const safeSince = validateDuration(since);
    const match = safeSince.match(/^(\d+)([hdwm])$/);
    if (!match) {
      return apiSuccess({ activity: [] });
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    let msAgo = 0;

    switch (unit) {
      case "h":
        msAgo = value * 60 * 60 * 1000;
        break;
      case "d":
        msAgo = value * 24 * 60 * 60 * 1000;
        break;
      case "w":
        msAgo = value * 7 * 24 * 60 * 60 * 1000;
        break;
      case "m":
        msAgo = value * 30 * 24 * 60 * 60 * 1000;
        break;
    }

    const sinceTimestamp = Date.now() - msAgo;
    const issues = taskGetActivity(orgId, sinceTimestamp, workspaceId, namespaceId);

    // Synthesize activity entries from recently updated issues
    const activity = issues.map((issue) => ({
      timestamp: issue.updated_at,
      type: issue.status === "closed" ? "closed" : "updated",
      issue_id: issue.id,
      symbol: "",
      message: `${issue.status === "closed" ? "closed" : "updated"}: ${issue.id} - ${issue.title}`,
    }));

    return apiSuccess({ activity });
  })
);
