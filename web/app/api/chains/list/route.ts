import { getNamespaceConfig } from "@/lib/namespace-config";
import config from "@/lib/config";
import { requirePermission } from "@/lib/rbac-auth";
import { getAllChains } from "@/lib/chain-utils";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: Request) => {
  const perm = await requirePermission(req, "view_chains");
  if (perm) return perm;

  const namespaceConfig = await getNamespaceConfig(req);
  const runsDir = config.runsDir;
  const chains = getAllChains(namespaceConfig.chainsDir, config.cliBin, runsDir, namespaceConfig.namespaceId, namespaceConfig.orgId);
  return apiSuccess({ chains, namespaceId: namespaceConfig.namespaceId });
});
