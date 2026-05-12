import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getDecision, updateDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import type { GuidedFlow, TradeoffAnswer } from "@/lib/decision-types";
import { Unauthorized, NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  // inbox-key bypass for MCP ops routes
  const inboxKey = request.headers.get("X-Mentiko-Inbox-Key");
  const skipAuth = inboxKey && inboxKey === process.env.MENTIKO_INBOX_KEY;

  if (!skipAuth && !(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspacePath(request);

  const body = await request.json() as {
    questionId: string;
    choice: "a" | "b" | "skip";
  };

  if (!body.questionId || !body.choice) {
    throw new BadRequest("questionId and choice required");
  }

  const decision = getDecision(namespaceId, orgId, id, workspacePath);
  if (!decision) throw new NotFound("Decision", id);

  const guidedFlow = decision.guidedFlow as GuidedFlow;
  if (!guidedFlow) throw new BadRequest("No guided flow");

  const answer: TradeoffAnswer = {
    questionId: body.questionId,
    choice: body.choice,
    answeredAt: new Date().toISOString(),
  };

  const existingIdx = guidedFlow.round1.answers.findIndex(
    (a) => a.questionId === body.questionId
  );
  if (existingIdx >= 0) {
    guidedFlow.round1.answers[existingIdx] = answer;
  } else {
    guidedFlow.round1.answers.push(answer);
  }

  const allAnswered = guidedFlow.round1.questions.length > 0 &&
    guidedFlow.round1.answers.length >= guidedFlow.round1.questions.length;

  if (allAnswered) {
    // mark as in_progress (not complete) - synthesis step comes next
    guidedFlow.round1.status = "in_progress";
    // build a legacy-compat preference snapshot (synthesis route produces the real profile)
    const profile: Record<string, string> = {};
    for (const a of guidedFlow.round1.answers) {
      const q = guidedFlow.round1.questions.find((qq) => qq.id === a.questionId);
      if (q && a.choice !== "skip") {
        profile[q.category] = a.choice === "a" ? q.optionA.value : q.optionB.value;
      }
    }
    guidedFlow.round1.preferenceProfile = {
      summary: Object.entries(profile).map(([k, v]) => `${k}: ${v}`).join(", "),
      priorities: [],
      willing_to_sacrifice: [],
      non_negotiables: [],
      risk_profile: "moderate",
      time_horizon: "medium_term",
      decision_style: "",
      preferences: profile,
      constraints: [],
    };
  }

  const updated = await updateDecision(namespaceId, orgId, id, { guidedFlow }, workspacePath);
  return apiSuccess({
    decision: updated,
    allAnswered,
    answersCount: guidedFlow.round1.answers.length,
    totalQuestions: guidedFlow.round1.questions.length,
  });
});
