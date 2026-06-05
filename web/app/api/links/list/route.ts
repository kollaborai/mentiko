import { getNamespaceConfig } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getAllLinks } from "@/lib/links/link-utils";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: Request) => {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  const namespaceConfig = await getNamespaceConfig(req);
  const links = getAllLinks(
    namespaceConfig.linksDir,
    namespaceConfig.namespaceId,
    namespaceConfig.orgId
  );

  return apiSuccess({ links, namespaceId: namespaceConfig.namespaceId });
});
