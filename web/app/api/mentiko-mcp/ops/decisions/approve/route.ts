import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/ai-engine/mentiko-mcp-ops-auth";
import { getDecision } from "@/lib/decisions/decision-storage";
import { resolveDecisionToTasks } from "@/lib/decisions/decision-resolution";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, NotFound } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "decisions:write");
  if (perm) return perm;

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
    selectedBy: "mentiko-mcp",
  });

  return apiSuccess(result);
});
