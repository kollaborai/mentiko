import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth } from "@/lib/mentiko-mcp-ops-auth";
import { getDecision } from "@/lib/decision-storage";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, NotFound } from "@/lib/api-errors";
import type { GuidedFlow } from "@/lib/decision-types";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    throw new BadRequest("id query parameter required");
  }

  const decision = getDecision(namespaceId, orgId, id);
  if (!decision) {
    throw new NotFound("Decision", id);
  }

  const guidedFlow = decision.guidedFlow as GuidedFlow | undefined;
  if (!guidedFlow) {
    throw new BadRequest("No guided flow in decision");
  }

  // pendingQuestions: only unanswered ones (filter against round1.answers)
  const answered = new Set(
    guidedFlow.round1?.answers?.map((a) => a.questionId) || []
  );
  const pendingQuestions = (guidedFlow.round1?.questions || [])
    .filter((q) => !answered.has(q.id))
    .map((q) => ({
      id: q.id,
      questionText: q.text,
      optionA: q.optionA,
      optionB: q.optionB,
    }));

  // flatten decision state for the agent
  const flattened = {
    id: decision.id,
    topic: decision.prompt || decision.title || "",
    status: decision.status,
    mode: decision.mode || "guided",
    round1Status: guidedFlow.round1?.status || "pending",
    round2Status: guidedFlow.round2?.status || "pending",
    round3Status: guidedFlow.round3?.status || "pending",
    pendingQuestions,
    options: (guidedFlow.round2?.tailoredOptions || []).map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      matchScore: o.matchScore,
      effort: o.effort,
      risk: o.risk,
    })),
    selectedOptionId: guidedFlow.round2?.selectedOptionId || null,
    plan: guidedFlow.round3?.plan || null,
  };

  return apiSuccess({ decision: flattened });
});
