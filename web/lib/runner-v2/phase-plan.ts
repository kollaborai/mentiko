import { evaluateQualityGate, type QualityGateInput, type QualityGateResult } from "@/lib/runner-v2/quality-gate";
import type { RoutingDecision } from "@/lib/runner-v2/routing";
import { planTerminalCompletion, type TerminalCompletionInput, type TerminalCompletionPlan } from "@/lib/runner-v2/terminal-plan";

export type CompletionPhaseStep =
  | { type: "quality-gate"; result: QualityGateResult }
  | { type: "generation-import"; jobId: string; generationKind: string }
  | { type: "generation-failed"; jobId: string; generationKind: string; reason: string }
  | { type: "route"; decision: RoutingDecision }
  | { type: "terminal-completion"; plan: TerminalCompletionPlan };

export interface CompletionPhasePlanInput {
  quality: QualityGateInput;
  generation?: {
    jobId?: string;
    generationKind?: string;
    importablePayload: boolean;
  };
  route: RoutingDecision;
  terminal?: TerminalCompletionInput;
}

export interface CompletionPhasePlan {
  steps: CompletionPhaseStep[];
  terminal: boolean;
}

export function planCompletionPhases(input: CompletionPhasePlanInput): CompletionPhasePlan {
  const quality = evaluateQualityGate(input.quality);
  const steps: CompletionPhaseStep[] = [{ type: "quality-gate", result: quality }];
  if (!quality.passed) {
    return { steps, terminal: true };
  }

  const generation = input.generation;
  if (generation?.jobId && generation.generationKind) {
    if (!generation.importablePayload) {
      steps.push({
        type: "generation-failed",
        jobId: generation.jobId,
        generationKind: generation.generationKind,
        reason: `generation import failed for job ${generation.jobId} (${generation.generationKind})`,
      });
      return { steps, terminal: true };
    }
    steps.push({
      type: "generation-import",
      jobId: generation.jobId,
      generationKind: generation.generationKind,
    });
  }

  steps.push({ type: "route", decision: input.route });
  if (input.route.action === "stop") {
    if (input.terminal) {
      steps.push({
        type: "terminal-completion",
        plan: planTerminalCompletion(input.terminal, "explicit-stop"),
      });
    }
    return { steps, terminal: true };
  }

  return { steps, terminal: false };
}
