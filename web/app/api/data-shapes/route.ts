import type { NextRequest } from "next/server";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { buildRuntimeDataShapeCatalog } from "@/lib/data-shapes/runtime-catalog";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const permissionError = await requirePermission(request, "view_audit");
  if (permissionError) return permissionError;

  const [namespaceId, orgId] = await Promise.all([
    getNamespaceIdFromRequest(request),
    getOrgIdFromRequest(request),
  ]);

  return apiSuccess(buildRuntimeDataShapeCatalog(namespaceId, orgId));
});
