import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspaceId, getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { resolveDecisionToTasks } from "@/lib/decisions/decision-resolution";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const session = await getSessionUser(request);
  if (!session?.id) {
    throw new Unauthorized("Authenticated session user required");
  }

  const { id } = await context.params;
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspaceId = getWorkspaceId(request);
  const workspacePath = getWorkspacePath(request);

  const { selectedOptionId, notes, autoApprovedByWorkspacePolicy } = await request.json();

  if (!selectedOptionId) {
    throw new BadRequest("selectedOptionId is required");
  }

  const autoApproved = autoApprovedByWorkspacePolicy === true
    && session.authMethod === "internal-service";
  const channel = autoApproved
    ? "workspace-auto-approve"
    : session.authMethod === "internal-service"
      ? "internal-service"
      : "human";

  const result = await resolveDecisionToTasks({
    namespaceId: nsId,
    orgId,
    decisionId: id,
    selectedOptionId,
    notes,
    workspaceId,
    workspacePath,
    actor: {
      user_id: session.id,
      ...(session.sessionId ? { session_id: session.sessionId } : {}),
      ...(session.role ? { org_role: session.role } : {}),
    },
    channel,
  });

  return apiSuccess(result);
});
