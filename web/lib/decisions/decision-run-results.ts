import { getDecision, updateDecision } from "@/lib/decisions/decision-storage";
import type {
  Decision,
  ExecutionPlan,
  GuidedFlow,
  PreferenceProfile,
  Recommendation,
  TailoredOption,
  TradeoffQuestion,
} from "@/lib/decisions/decision-types";
import { BadRequest, NotFound } from "@/lib/api-errors";

export type DecisionRunPhase =
  | "research"
  | "questions"
  | "synthesis"
  | "options"
  | "plan"
  | "retrospective";

export interface ApplyDecisionRunResultInput {
  namespaceId: string;
  orgId: string;
  decisionId: string;
  phase: DecisionRunPhase;
  result: unknown;
  runId?: string;
  selectedOptionId?: string;
  workspacePath?: string;
}

function ensureGuidedFlow(decision: Decision): GuidedFlow {
  return decision.guidedFlow || {
    currentRound: 0,
    round1: { status: "pending", questions: [], answers: [] },
    round2: { status: "pending", tailoredOptions: [] },
    round3: { status: "pending" },
  };
}

function resultObject(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new BadRequest("Decision result must be a JSON object");
  }
  return result as Record<string, unknown>;
}

export async function applyDecisionRunResult({
  namespaceId,
  orgId,
  decisionId,
  phase,
  result,
  runId,
  selectedOptionId,
  workspacePath,
}: ApplyDecisionRunResultInput): Promise<Decision> {
  const decision = getDecision(namespaceId, orgId, decisionId, workspacePath);
  if (!decision) throw new NotFound("Decision", decisionId);

  const decisionWs = decision.workspacePath ?? workspacePath;
  const parsed = resultObject(result);

  if (phase === "research") {
    return updateDecision(namespaceId, orgId, decisionId, {
      title: (parsed.title as string) || decision.prompt,
      priority: parsed.priority as string,
      category: parsed.category as string,
      brief: parsed.brief as Decision["brief"],
      context: parsed.context as Decision["context"],
      options: (parsed.options as Decision["options"]) || decision.options || [],
      recommendation: parsed.recommendation as Decision["recommendation"],
      status: "briefed",
      activeJobId: undefined,
      ...(runId ? { researchRunId: runId } : {}),
    }, decisionWs);
  }

  if (phase === "retrospective") {
    return updateDecision(namespaceId, orgId, decisionId, {
      retrospective: {
        summary: (parsed.summary as string) || "",
        outcome: (parsed.outcome as string) || "",
        lessonsLearned: (parsed.lessonsLearned as string[]) || [],
        completedAt: new Date().toISOString(),
      },
      status: "done",
      retroJobId: undefined,
      ...(runId ? { retroRunId: runId } : {}),
    }, decisionWs);
  }

  const guidedFlow = ensureGuidedFlow(decision);

  if (phase === "questions") {
    guidedFlow.currentRound = 1;
    guidedFlow.round1.status = "in_progress";
    guidedFlow.round1.questions = (parsed.questions as TradeoffQuestion[]) || [];
    guidedFlow.round1.generationJobId = undefined;
    if (runId) guidedFlow.round1.generationRunId = runId;
    guidedFlow.startedAt = guidedFlow.startedAt || new Date().toISOString();
    return updateDecision(namespaceId, orgId, decisionId, {
      guidedFlow,
      mode: "guided",
    }, decisionWs);
  }

  if (phase === "synthesis") {
    guidedFlow.round1.preferenceProfile = parsed as unknown as PreferenceProfile;
    guidedFlow.round1.status = "complete";
    guidedFlow.round1.synthesisJobId = undefined;
    return updateDecision(namespaceId, orgId, decisionId, { guidedFlow }, decisionWs);
  }

  if (phase === "options") {
    const options = (parsed.options as TailoredOption[]) || [];
    guidedFlow.currentRound = 2;
    guidedFlow.round2.status = "ready";
    guidedFlow.round2.tailoredOptions = options;
    guidedFlow.round2.generationJobId = undefined;
    if (runId) guidedFlow.round2.generationRunId = runId;
    return updateDecision(namespaceId, orgId, decisionId, {
      guidedFlow,
      options: options.map((option) => ({
        id: option.id,
        letter: option.letter,
        name: option.name,
        description: option.description,
        pros: option.pros,
        cons: option.cons,
        effort: option.effort,
        risk: option.risk,
      })),
      recommendation: parsed.recommendation as Recommendation,
    }, decisionWs);
  }

  if (phase === "plan") {
    guidedFlow.currentRound = 3;
    if (selectedOptionId) guidedFlow.round2.selectedOptionId = selectedOptionId;
    guidedFlow.round3.status = "ready";
    guidedFlow.round3.plan = parsed as unknown as ExecutionPlan;
    guidedFlow.round3.generationJobId = undefined;
    if (runId) guidedFlow.round3.generationRunId = runId;
    return updateDecision(namespaceId, orgId, decisionId, { guidedFlow }, decisionWs);
  }

  throw new BadRequest(`Unsupported decision phase: ${phase}`);
}
