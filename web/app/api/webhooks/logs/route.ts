import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWebhookLogs } from "@/lib/webhook-storage";
import { apiSuccess, apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/webhooks/logs - list webhook events
export async function GET(request: NextRequest) {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const chainId = searchParams.get("chainId");
    const source = searchParams.get("source");
    const type = searchParams.get("type");

    let events = await getWebhookLogs(namespaceId, orgId, Math.min(limit, 1000));

    // filter by chainId if specified
    if (chainId) {
      events = events.filter((e) => e.chainId === chainId);
    }

    // filter by source if specified
    if (source) {
      events = events.filter((e) => e.source === source);
    }

    // filter by type if specified
    if (type) {
      events = events.filter((e) => e.type === type);
    }

    return apiSuccess({ events, count: events.length });
  } catch (error: unknown) {
    return apiError(error);
  }
}
