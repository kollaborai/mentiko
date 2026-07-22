// GET /api/operations/timeline — the Operations Timeline read model.
//
// One authenticated, namespace/org/workspace-aware endpoint returning the full
// operational view (system health, attention, running now, expected next,
// waiting, human gates, accomplishments, timeline). Clients never fan out into
// per-task attempts/deps/runs requests — this route is the aggregation.

import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import {
  buildOperationsView,
  emitOperationsNotifications,
} from "@/lib/operations/operations-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = requirePermission("view_tasks")(
  withErrorHandling(async (request: NextRequest) => {
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const workspaceId = getWorkspaceId(request);
    if (hasWorkspaceParam(request) && !workspaceId) {
      return apiSuccess({ view: null });
    }

    const view = await buildOperationsView(namespaceId, orgId, workspaceId);

    // Durable-transition notifications, idempotent per transition anchor —
    // repeated polls re-derive the same keys and dedupe in the store.
    let notifications = { created: 0, failed: 0 };
    try {
      notifications = emitOperationsNotifications(namespaceId, view);
    } catch {
      // Notification store trouble must not take down the operational view.
    }

    // Shell indicator polls with ?summary=1 — verdict and counts only.
    if (new URL(request.url).searchParams.get("summary") === "1") {
      return apiSuccess({
        summary: {
          generatedAt: view.generatedAt,
          overall: view.overall,
          overallDetail: view.overallDetail,
          counts: view.counts,
        },
        notifications,
      });
    }

    return apiSuccess({ view, notifications });
  })
);
