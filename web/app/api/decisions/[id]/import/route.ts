import { NextRequest } from "next/server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspacePath } from "@/lib/workspaces/workspace-params";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { requireInternalAuth } from "@/lib/auth/internal-api-auth";
import { applyDecisionRunResult, type DecisionRunPhase } from "@/lib/decisions/decision-run-results";

export const dynamic = "force-dynamic";

const PHASES = new Set<DecisionRunPhase>([
  "research",
  "questions",
  "synthesis",
  "options",
  "plan",
  "retrospective",
]);

function parsePhase(value: unknown): DecisionRunPhase {
  if (typeof value !== "string" || !PHASES.has(value as DecisionRunPhase)) {
    throw new BadRequest("valid decision phase is required");
  }
  return value as DecisionRunPhase;
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  requireInternalAuth(request, "decision-import");

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json() as {
    phase?: unknown;
    runId?: unknown;
    result?: unknown;
    workspacePath?: unknown;
    selectedOptionId?: unknown;
  };

  if (!body.result) {
    throw new BadRequest("result is required");
  }

  const decision = await applyDecisionRunResult({
    namespaceId,
    orgId,
    decisionId: id,
    phase: parsePhase(body.phase),
    runId: typeof body.runId === "string" ? body.runId : undefined,
    result: body.result,
    workspacePath: typeof body.workspacePath === "string" ? body.workspacePath : getWorkspacePath(request),
    selectedOptionId: typeof body.selectedOptionId === "string" ? body.selectedOptionId : undefined,
  });

  return apiSuccess({ decision });
});
