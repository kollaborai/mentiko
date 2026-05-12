import { NextRequest } from "next/server";
import { reconcileOrphanedRuns } from "@/lib/run-reconciler";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

// namespace/org-wide maintenance op. request scope is explicit so one tenant
// cannot reconcile another tenant's run/task/event roots.
export const POST = withErrorHandling(async (req: NextRequest) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req);
  if (blockResult?.blocked) return blockResult.response;

  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);

  const result = await reconcileOrphanedRuns({
    namespaceId,
    orgId,
    runsDir: resolveLinkRunsDir(namespaceId, orgId),
    eventsDir: orgPath(namespaceId, orgId, "events"),
  });
  return apiSuccess(result);
});
