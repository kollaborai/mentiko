import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getCircuitState,
  resetCircuitState,
} from "@/lib/retry-storage";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/retry/circuit?chainId=xxx&agent=yyy - get circuit state
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chainId");
  const agentName = searchParams.get("agent");

  if (!chainId || !agentName) {
    throw new BadRequest("chainId and agent required", {
      fields: ["chainId", "agent"]
    });
  }

  const state = await getCircuitState(namespaceId, orgId, chainId, agentName);
  return apiSuccess({ state });
});

// POST /api/retry/circuit/reset - reset circuit state
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { chainId, agentName } = body as {
    chainId: string;
    agentName: string;
  };

  if (!chainId || !agentName) {
    throw new BadRequest("chainId and agentName required", {
      fields: ["chainId", "agentName"]
    });
  }

  await resetCircuitState(namespaceId, orgId, chainId, agentName);
  return apiSuccess({ reset: true });
});
