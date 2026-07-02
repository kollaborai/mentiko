import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orgPath } from "@/lib/config";
import { ensureDecisionCoreChains, type DecisionCoreChainId } from "@/lib/decisions/decision-core-chains";
import { startChainRun } from "@/lib/runs/chain-run-service";
import { getTemplate } from "@/lib/generation/generation-template-storage";
import { resolveTemplate } from "@/lib/system/template-resolver";
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

interface StartDecisionResearchInput {
  request: Request;
  namespaceId: string;
  orgId: string;
  decision: Decision;
  /** The raw, user-style ask to research (what a person would type/speak). */
  userPrompt: string;
  workspacePath?: string;
}

/**
 * Resolve the `decision_research` template around a user-style prompt and launch
 * the research phase. This is the SINGLE path for turning a raw decision ask into
 * a briefed decision (clean title, brief, context, options). Both the interactive
 * research route and autonomous callers (e.g. completion-audit) go through here,
 * so an auto-created decision packages identically to one created by hand.
 */
export async function startDecisionResearch({
  request,
  namespaceId,
  orgId,
  decision,
  userPrompt,
  workspacePath,
}: StartDecisionResearchInput) {
  const ws = workspacePath ?? decision.workspacePath;
  const workspaceContext = ws
    ? `\nWORKSPACE CONTEXT:\n- Source checkout: ${ws}\n- If this decision involves code, inspect files under this checkout and cite repo-relative paths in references.\n`
    : "";
  const template = getTemplate(namespaceId, orgId, "decision_research");
  const researchPrompt = resolveTemplate(template.content, {
    USER_PROMPT: userPrompt,
    WORKSPACE_CONTEXT: workspaceContext,
  });
  return startDecisionChainRun({
    request,
    namespaceId,
    orgId,
    decision,
    phase: "research",
    prompt: researchPrompt,
    workspacePath: ws,
  });
}
