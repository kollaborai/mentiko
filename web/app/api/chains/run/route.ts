import { NextRequest } from "next/server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { startChainRun } from "@/lib/runs/chain-run-service";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest, _context: { params: Promise<Record<string, string>> }) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const result = await startChainRun({
    request,
    namespaceId: await getNamespaceIdFromRequest(request),
    orgId: await getOrgIdFromRequest(request),
    body: await request.json(),
  });

  return apiSuccess(result);
});
