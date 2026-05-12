import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getChainRetryConfig,
  saveChainRetryConfig,
  deleteChainRetryConfig,
} from "@/lib/retry-storage";
import type { ChainRetryConfig } from "@/lib/retry-types";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// GET /api/retry/config?chainId=xxx - get retry config
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chainId");

  if (!chainId) {
    throw new BadRequest("chainId required", { field: "chainId" });
  }

  const config = await getChainRetryConfig(namespaceId, orgId, chainId);
  return apiSuccess({ config });
});

// POST /api/retry/config - save retry config
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { chainId, config: retryConfig } = body as {
    chainId: string;
    config: ChainRetryConfig;
  };

  if (!chainId || !retryConfig) {
    throw new BadRequest("chainId and config required", { fields: ["chainId", "config"] });
  }

  await saveChainRetryConfig(namespaceId, orgId, chainId, retryConfig);
  return apiSuccess({ success: true, config: retryConfig });
});

// DELETE /api/retry/config?chainId=xxx - delete retry config
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chainId");

  if (!chainId) {
    throw new BadRequest("chainId required", { field: "chainId" });
  }

  await deleteChainRetryConfig(namespaceId, orgId, chainId);
  return apiSuccess({ success: true });
});
