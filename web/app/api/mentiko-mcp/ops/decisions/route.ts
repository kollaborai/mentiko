import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import { createDecision, getDecision, updateDecision } from "@/lib/decision-storage";
import { withErrorHandling } from "@/lib/api-response";
import { BadRequest, NotFound } from "@/lib/api-errors";
import type { DecisionMode, GuidedFlow } from "@/lib/decision-types";

export const dynamic = "force-dynamic";

function makeGuidedFlow(): GuidedFlow {
  return {
    currentRound: 1,
    startedAt: new Date().toISOString(),
    round1: { status: "pending", questions: [], answers: [] },
    round2: { status: "pending", tailoredOptions: [] },
    round3: { status: "pending" },
  };
}

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

  return NextResponse.json({ decision: flattened });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_tasks", "decisions:write");
  if (perm) return perm;

  const body = await request.json() as {
    topic?: string;
    mode?: DecisionMode;
  };
  const topic = body.topic?.trim();
  const mode: DecisionMode = body.mode === "classic" ? "classic" : "guided";

  if (!topic) {
    throw new BadRequest("topic is required");
  }

  const created = createDecision(
    ctx.namespaceId,
    ctx.orgId,
    { prompt: topic, source: "mentiko-mcp" },
    undefined,
  );

  const decision = await updateDecision(
    ctx.namespaceId,
    ctx.orgId,
    created.id,
    {
      mode,
      ...(mode === "guided" ? { guidedFlow: makeGuidedFlow() } : {}),
    },
    undefined,
  );

  return NextResponse.json({ decision }, { status: 201 });
});
