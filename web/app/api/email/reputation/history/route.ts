import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getHistory } from "@/lib/email/email-reputation";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/email/reputation/history?days=30 - return daily metrics
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { searchParams } = new URL(request.url);
  const daysParam = searchParams.get("days");
  const days = daysParam ? Math.min(parseInt(daysParam, 10) || 30, 90) : 30;

  const history = await getHistory(namespaceId, orgId, days);

  return apiSuccess({
    history,
    count: history.length,
  });
});
