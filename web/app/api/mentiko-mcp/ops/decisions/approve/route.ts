import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { getDecision } from "@/lib/decisions/decision-storage";
import { resolveDecisionToTasks } from "@/lib/decisions/decision-resolution";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { getSessionUser } from "@/lib/auth/auth-bridge";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "decisions:write");
  if (perm) return perm;

  const session = await getSessionUser(request);
  if (!session?.id || session.id !== ctx.userId || session.sessionId !== ctx.sessionId) {
    throw new Unauthorized("Authenticated session user required");
  }

  const body = await request.json() as {
    decisionId: string;
    optionId?: string;
    selectedOptionId?: string;
    notes?: string;
    workspacePath?: string;
  };

  if (!body.decisionId) {
    throw new BadRequest("decisionId required");
  }

  const decision = getDecision(
    ctx.namespaceId,
    ctx.orgId,
    body.decisionId,
    body.workspacePath,
  );
  if (!decision) {
    throw new NotFound("Decision", body.decisionId);
  }

  const selectedOptionId =
    body.selectedOptionId ||
    body.optionId ||
    decision.guidedFlow?.round2.selectedOptionId ||
    decision.recommendation?.choiceId;

  if (!selectedOptionId) {
    throw new BadRequest("selectedOptionId required");
  }

  const result = await resolveDecisionToTasks({
    namespaceId: ctx.namespaceId,
    orgId: ctx.orgId,
    decisionId: body.decisionId,
    selectedOptionId,
    notes: body.notes,
    workspaceId: body.workspacePath,
    workspacePath: body.workspacePath,
    actor: {
      user_id: session.id,
      ...(session.sessionId ? { session_id: session.sessionId } : {}),
      ...(session.role ? { org_role: session.role } : {}),
    },
    channel: "mentiko-mcp",
  });

  return apiSuccess(result);
});
