import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getRetryState,
  listRetryStates,
} from "@/lib/runs/retry-storage";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// GET /api/retry/state?runId=xxx or ?chainId=xxx - get retry state(s)
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get("runId");
  const chainId = searchParams.get("chainId");

  if (runId) {
    // get specific run state
    const state = await getRetryState(namespaceId, orgId, runId);
    return apiSuccess({ state });
  } else if (chainId) {
    // list all states for chain
    const states = await listRetryStates(namespaceId, orgId, chainId);
    return apiSuccess({ states });
  } else {
    throw new BadRequest("runId or chainId required");
  }
});
