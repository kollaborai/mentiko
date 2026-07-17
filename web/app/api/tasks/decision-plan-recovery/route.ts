import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { reconcileLegacyDecisionPlans } from "@/lib/decisions/legacy-decision-plan-recovery";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";

export const dynamic = "force-dynamic";

async function inputs(request: NextRequest) {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspaceId(request);
  if (hasWorkspaceParam(request) && !workspacePath) {
    throw new BadRequest("Tasks not initialized in this workspace.");
  }
  return { namespaceId, orgId, workspacePath };
}

/**
 * Reports whether quarantined legacy decision tasks can be restored from the
 * current persisted decision plan. This endpoint never creates a contract.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  return apiSuccess(reconcileLegacyDecisionPlans(await inputs(request)));
});

/**
 * Applies only proven repairs. Tasks without an authoritative contract become
 * visibly blocked with a regeneration-required reason instead of remaining an
 * opaque auto-run pause. An explicit body prevents background polling from
 * changing old task trees behind the user's back.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== "repair-legacy-decision-plans") {
    throw new BadRequest("Explicit confirmation is required to change legacy decision tasks.");
  }
  return apiSuccess(reconcileLegacyDecisionPlans({ ...(await inputs(request)), apply: true }));
});
