import { findCompletionEvent, type CompletionAgentRef } from "@/lib/runner-v2/completion";
import { readRunJson, updateRunAgent, updateRunStatus, type RunRecord } from "@/lib/runner-v2/run-state";
import { decideNextRoute, type RoutingChain, type RoutingDecision } from "@/lib/runner-v2/routing";
import type { RunnerEventRecord } from "@/lib/runner-v2/events";
import { planTerminalCompletion, shouldCompleteEmptyEmitsAgent, type TerminalCompletionInput, type TerminalCompletionPlan } from "@/lib/runner-v2/terminal-plan";
import { planNoEventRetry, type RetryNoEventPlan, type RetryPolicy } from "@/lib/runner-v2/retry-plan";
import { completeFanGroupMember, type FanGroupCompletionPlan, type FanGroupState } from "@/lib/runner-v2/fan-group";
import { applyLoopGuardToRoute, routeAgentIds, type LoopGuardDecision } from "@/lib/runner-v2/loop-guard";

export type CompletionRunnerDecision =
  | { action: "fail"; reason: string; run: RunRecord; fanGroup?: FanGroupCompletionPlan }
  | { action: "retry"; reason: string; retry: Extract<RetryNoEventPlan, { action: "retry" }>; run: RunRecord }
  | { action: "exhausted"; reason: string; retry: Extract<RetryNoEventPlan, { action: "exhausted" }>; run: RunRecord; fanGroup?: FanGroupCompletionPlan }
  | { action: "route"; event: RunnerEventRecord; route: RoutingDecision; loopGuard?: LoopGuardDecision; run: RunRecord; fanGroup?: FanGroupCompletionPlan }
  | { action: "loop-complete"; event: RunnerEventRecord; loopGuard: Extract<LoopGuardDecision, { action: "complete" }>; run: RunRecord; fanGroup?: FanGroupCompletionPlan }
  | { action: "max-rounds-stop"; event: RunnerEventRecord; loopGuard: Extract<LoopGuardDecision, { action: "stop" }>; run: RunRecord; fanGroup?: FanGroupCompletionPlan }
  | { action: "terminal"; reason: "empty-emits-last-agent"; terminal: TerminalCompletionPlan; run: RunRecord };

export interface CompleteAgentInput {
  runJsonPath: string;
  runId: string;
  agent: CompletionAgentRef;
  chain: RoutingChain;
  events: Array<RunnerEventRecord | string>;
  terminal?: TerminalCompletionInput;
  retry?: {
    policy?: RetryPolicy;
    currentAttempt?: number;
    onError?: string;
    chainPath?: string;
    workspacePath?: string;
    taskId?: string;
    startSha?: string;
    debug?: boolean;
  };
  fanGroup?: FanGroupState;
  loopGuard?: {
    visited?: string[];
    currentRound?: number;
    maxRounds?: number;
  };
  now?: Date;
}

export function completeAgent(input: CompleteAgentInput): CompletionRunnerDecision {
  const match = findCompletionEvent({
    agent: input.agent,
    runId: input.runId,
    events: input.events,
  });

  if (!match.matched || !match.event) {
    if (shouldCompleteEmptyEmitsAgent(input.agent.emits, hasDownstreamForAgent(input.chain, input.agent.id))) {
      updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now);
      const run = updateRunStatus(input.runJsonPath, "completed", undefined, input.now);
      return {
        action: "terminal",
        reason: "empty-emits-last-agent",
        terminal: planTerminalCompletion(input.terminal || {
          runId: input.runId,
          chainName: input.chain.name || input.chain.id || "unknown",
          lastAgentId: input.agent.id,
        }, "empty-emits-last-agent"),
        run,
      };
    }

    if (input.retry) {
      const retry = planNoEventRetry({
        runId: input.runId,
        chainName: input.chain.name || input.chain.id || "unknown",
        chainPath: input.retry.chainPath,
        workspacePath: input.retry.workspacePath,
        taskId: input.retry.taskId,
        agentId: input.agent.id,
        agentName: input.agent.name,
        currentAttempt: input.retry.currentAttempt,
        retry: input.retry.policy,
        onError: input.retry.onError,
        startSha: input.retry.startSha,
        debug: input.retry.debug,
      });

      if (retry.action === "retry") {
        return {
          action: "retry",
          reason: match.reason || "no matching completion event",
          retry,
          run: readCurrentRun(input.runJsonPath),
        };
      }

      updateRunAgent(input.runJsonPath, input.agent.id, "failed", input.now);
      const run = updateRunStatus(
        input.runJsonPath,
        "stopped",
        `agent ${input.agent.id} completed without declared event; retries exhausted`,
        input.now,
      );
      return {
        action: "exhausted",
        reason: match.reason || "no matching completion event",
        retry,
        fanGroup: planFanGroupCompletion(input, "failed"),
        run,
      };
    }

    const fanGroup = planFanGroupCompletion(input, "failed");
    updateRunAgent(input.runJsonPath, input.agent.id, "failed", input.now);
    const run = updateRunStatus(
      input.runJsonPath,
      "failed",
      `agent ${input.agent.id} completed without declared event: ${match.reason}`,
      input.now,
    );
    return {
      action: "fail",
      reason: match.reason || "no matching completion event",
      fanGroup,
      run,
    };
  }

  const fanGroup = planFanGroupCompletion(input, "complete");
  updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now);
  const route = decideNextRoute(input.chain, match.event.event);
  const loopGuard = input.loopGuard ? applyLoopGuardToRoute({
    currentAgentId: input.agent.id,
    eventName: match.event.event,
    nextAgentIds: routeAgentIds(route),
    chain: input.chain,
    routeKind: route.action === "launch" && route.fanIn ? "fan-out" : route.action === "launch" && route.agentIds.length > 1 ? "parallel" : "single",
    visited: input.loopGuard.visited,
    currentRound: input.loopGuard.currentRound,
    maxRounds: input.loopGuard.maxRounds,
  }) : undefined;

  if (loopGuard?.action === "complete") {
    const run = updateRunStatus(input.runJsonPath, "completed", undefined, input.now);
    return {
      action: "loop-complete",
      event: match.event,
      loopGuard,
      fanGroup,
      run,
    };
  }

  if (loopGuard?.action === "stop") {
    const run = updateRunStatus(
      input.runJsonPath,
      "stopped",
      `max rounds exceeded (${loopGuard.maxRounds})`,
      input.now,
    );
    return {
      action: "max-rounds-stop",
      event: match.event,
      loopGuard,
      fanGroup,
      run,
    };
  }

  const run = readCurrentRun(input.runJsonPath);
  return {
    action: "route",
    event: match.event,
    route,
    loopGuard,
    fanGroup,
    run,
  };
}

function hasDownstreamForAgent(chain: RoutingChain, agentId: string): boolean {
  const agent = chain.agents.find((candidate) => candidate.id === agentId);
  if (!agent?.emits) return false;
  return chain.agents.some((candidate) => (candidate.triggers || []).includes(agent.emits || ""));
}

function readCurrentRun(runJsonPath: string): RunRecord {
  return readRunJson(runJsonPath);
}

function planFanGroupCompletion(input: CompleteAgentInput, status: "complete" | "failed"): FanGroupCompletionPlan | undefined {
  if (!input.fanGroup) return undefined;
  return completeFanGroupMember({
    group: input.fanGroup,
    agentId: input.agent.id,
    status,
  });
}
