import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspaceId, hasWorkspaceParam } from "@/lib/workspaces/workspace-params";
import { regenerateLegacyDecisionPlans } from "@/lib/decisions/legacy-decision-plan-regeneration";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";

export const dynamic = "force-dynamic";

async function inputs(request: NextRequest) {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspaceId(request);
  if (hasWorkspaceParam(request) && !workspacePath) throw new BadRequest("Tasks not initialized in this workspace.");
  return { request, namespaceId, orgId, workspacePath };
}

/** Dry run: list decisions that can safely be regenerated without starting a run. */
export const GET = withErrorHandling(async (request: NextRequest) => (
  apiSuccess({ results: await regenerateLegacyDecisionPlans(await inputs(request)) })
));

/** Starts one durable guided-plan run per explicitly confirmed eligible decision. */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  if (body?.confirm !== "regenerate-legacy-decision-plans") {
    throw new BadRequest("Explicit confirmation is required to regenerate legacy decision plans.");
  }
  return apiSuccess({ results: await regenerateLegacyDecisionPlans({ ...(await inputs(request)), apply: true }) });
});
