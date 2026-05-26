import { opsGet, opsPost } from "./ops-client.js";

interface FlattenedDecision {
  id: string;
  topic: string;
  status: string;
  mode: string;
  round1Status: string;
  round2Status: string;
  round3Status: string;
  pendingQuestions: Array<{
    id: string;
    questionText: string;
    optionA: { label: string; value: string; icon?: string };
    optionB: { label: string; value: string; icon?: string };
  }>;
  options: Array<{
    id: string;
    name: string;
    description: string;
    matchScore: number;
    effort: string;
    risk: string;
  }>;
  selectedOptionId: string | null;
  plan?: any;
}

interface StartedDecision {
  id: string;
  prompt?: string;
  title?: string;
  status?: string;
  mode?: string;
}

export async function getDecision(id: string): Promise<FlattenedDecision> {
  return await opsGet<{ decision: FlattenedDecision }>(
    "/api/mentiko-mcp/ops/decisions",
    { id }
  ).then((r) => r.decision);
}

export async function startNewDecision(
  topic: string,
  mode: "guided" | "classic" = "guided"
): Promise<StartedDecision> {
  return await opsPost<{ decision: StartedDecision }>(
    "/api/mentiko-mcp/ops/decisions",
    { topic, mode }
  ).then((r) => r.decision);
}

export async function answerDecisionQuestion(
  decisionId: string,
  questionId: string,
  choice: "a" | "b" | "skip"
): Promise<any> {
  return await opsPost(
    "/api/mentiko-mcp/ops/decisions/answer",
    { decisionId, questionId, choice }
  );
}

export async function selectDecisionOption(
  decisionId: string,
  optionId: string
): Promise<any> {
  return await opsPost(
    "/api/mentiko-mcp/ops/decisions/select",
    { decisionId, optionId }
  );
}

export async function approveDecision(
  decisionId: string,
  selectedOptionId?: string,
  workspacePath?: string,
  notes?: string
): Promise<any> {
  return await opsPost(
    "/api/mentiko-mcp/ops/decisions/approve",
    { decisionId, selectedOptionId, workspacePath, notes }
  );
}

export async function pollDecisionReady(
  decisionId: string,
  round: 1 | 2 | 3
): Promise<{ ready: boolean; status: string }> {
  const decision = await getDecision(decisionId);

  if (round === 1) {
    const ready = decision.round1Status === "complete" ||
                  decision.round1Status === "synthesizing" ||
                  decision.round1Status === "in_progress";
    return { ready, status: decision.round1Status };
  } else if (round === 2) {
    const ready = decision.round2Status === "ready" ||
                  decision.round2Status === "complete";
    return { ready, status: decision.round2Status };
  } else if (round === 3) {
    const ready = decision.round3Status === "ready" ||
                  decision.round3Status === "complete";
    return { ready, status: decision.round3Status };
  }

  return { ready: false, status: "unknown" };
}
