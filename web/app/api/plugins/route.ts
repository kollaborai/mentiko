import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getPlugins, maskConfig } from "@/lib/system/plugin-registry";
import { InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/plugins - list all plugins with their status
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  try {
    const plugins = getPlugins(namespaceId, orgId).map((p) => ({
      ...p,
      config: maskConfig(p.config, p.manifest.configSchema),
    }));
    return apiSuccess({ plugins });
  } catch (err) {
    console.error("[plugins] list error:", err);
    throw new InternalServerError("Failed to load plugins");
  }
});
