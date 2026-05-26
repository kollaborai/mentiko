import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspaceId, getWorkspacePath } from "@/lib/workspace-params";
import { resolveDecisionToTasks } from "@/lib/decision-resolution";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const { id } = await context.params;
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspaceId = getWorkspaceId(request);
  const workspacePath = getWorkspacePath(request);

  const { selectedOptionId, notes } = await request.json();

  if (!selectedOptionId) {
    throw new BadRequest("selectedOptionId is required");
  }

  const result = await resolveDecisionToTasks({
    namespaceId: nsId,
    orgId,
    decisionId: id,
    selectedOptionId,
    notes,
    workspaceId,
    workspacePath,
    selectedBy: "user",
  });

  return apiSuccess(result);
});
