import { completeAgent, type CompleteAgentInput, type CompletionRunnerDecision } from "@/lib/runner-v2/completion-runner";
import { readLoopState, recordLoopVisit, type LoopState } from "@/lib/runner-v2/loop-state";

export interface CompletionPipelineInput extends Omit<CompleteAgentInput, "loopGuard"> {
  runDir: string;
  maxRounds?: number;
}

export interface CompletionPipelineResult {
  decision: CompletionRunnerDecision;
  loopStateBefore: LoopState;
  loopStateAfter?: LoopState;
}

export function runCompletionPipeline(input: CompletionPipelineInput): CompletionPipelineResult {
  const loopStateBefore = readLoopState(input.runDir);
  const decision = completeAgent({
    ...input,
    loopGuard: {
      visited: loopStateBefore.visited,
      currentRound: loopStateBefore.round,
      maxRounds: input.maxRounds,
    },
  });

  const loopStateAfter = recordLoopDecision(input.runDir, decision);
  return {
    decision,
    loopStateBefore,
    ...(loopStateAfter ? { loopStateAfter } : {}),
  };
}

function recordLoopDecision(runDir: string, decision: CompletionRunnerDecision): LoopState | undefined {
  if (decision.action === "route" && decision.loopGuard?.action === "continue") {
    return recordLoopVisit(runDir, decision.loopGuard.visitKey, decision.loopGuard.round);
  }
  if (decision.action === "max-rounds-stop") {
    return recordLoopVisit(runDir, decision.loopGuard.visitKey, decision.loopGuard.round);
  }
  return undefined;
}
