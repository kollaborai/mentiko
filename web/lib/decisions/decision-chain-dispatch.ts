import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orgPath } from "@/lib/config";
import { ensureDecisionCoreChains, type DecisionCoreChainId } from "@/lib/decisions/decision-core-chains";
import { startChainRun } from "@/lib/runs/chain-run-service";
import type { Decision } from "@/lib/decisions/decision-types";
import type { Chain } from "@/lib/types";

export type DecisionChainPhase = "research" | "questions" | "synthesis" | "options" | "plan" | "retrospective";

const PHASE_TO_CHAIN_ID: Record<DecisionChainPhase, DecisionCoreChainId> = {
  research: "decision-research",
  questions: "decision-guided-questions",
  synthesis: "decision-preference-synthesis",
  options: "decision-guided-options",
  plan: "decision-guided-plan",
  retrospective: "decision-retrospective",
};

interface StartDecisionChainRunInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  decision: Decision;
  phase: DecisionChainPhase;
  prompt: string;
  workspacePath?: string;
  selectedOptionId?: string;
}

function loadCoreChain(namespaceId: string, orgId: string, chainId: DecisionCoreChainId): Chain {
  ensureDecisionCoreChains(namespaceId, orgId);
  const chainPath = join(orgPath(namespaceId, orgId, "chains", chainId), "chain.json");
  return JSON.parse(readFileSync(chainPath, "utf8")) as Chain;
}

export async function startDecisionChainRun({
  request,
  namespaceId,
  orgId,
  decision,
  phase,
  prompt,
  workspacePath,
  selectedOptionId,
}: StartDecisionChainRunInput) {
  const chainId = PHASE_TO_CHAIN_ID[phase];
  const resolvedWorkspacePath = workspacePath ?? decision.workspacePath;
  return startChainRun({
    request,
    namespaceId,
    orgId,
    body: {
      chain: loadCoreChain(namespaceId, orgId, chainId),
      chainId,
      userPrompt: [
        `DECISION_ID: ${decision.id}`,
        `DECISION_PHASE: ${phase}`,
        selectedOptionId ? `SELECTED_OPTION_ID: ${selectedOptionId}` : "",
        resolvedWorkspacePath ? `WORKSPACE_PATH: ${resolvedWorkspacePath}` : "",
        "",
        prompt,
      ].filter(Boolean).join("\n"),
      workspacePath: resolvedWorkspacePath,
      metadata: {
        decisionId: decision.id,
        decisionPhase: phase,
        ...(resolvedWorkspacePath ? { workspacePath: resolvedWorkspacePath } : {}),
        ...(selectedOptionId ? { selectedOptionId } : {}),
      },
    },
  });
}
