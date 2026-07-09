import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { findCompletionEvent, type CompletionAgentRef } from "@/lib/runner-v2/completion";
import { readRunJson, updateRunAgent, updateRunStatus, type RunRecord } from "@/lib/runner-v2/run-state";
import { decideNextRoute, type RoutingChain, type RoutingDecision } from "@/lib/runner-v2/routing";
import type { RunnerEventRecord } from "@/lib/runner-v2/events";
import { planTerminalCompletion, shouldCompleteEmptyEmitsAgent, type TerminalCompletionInput, type TerminalCompletionPlan } from "@/lib/runner-v2/terminal-plan";
import { planNoEventRetry, type RetryNoEventPlan, type RetryPolicy } from "@/lib/runner-v2/retry-plan";
import { completeFanGroupMember, type FanGroupCompletionPlan, type FanGroupState } from "@/lib/runner-v2/fan-group";
import { applyLoopGuardToRoute, routeAgentIds, type LoopGuardDecision } from "@/lib/runner-v2/loop-guard";
import {
  markAgentAttemptCompletedFromEmptyEmits,
  markAgentAttemptCompletedFromEvent,
  markAgentAttemptCompletedFromGeneration,
  markAgentAttemptFailedNoCompletion,
  markAgentAttemptRetriesExhausted,
} from "@/lib/runner-v2/agent-attempt";

export type CompletionRunnerDecision =
  | { action: "await-liveness"; reason: string; liveness: AgentLivenessDecision; run: RunRecord }
  | { action: "fail"; reason: string; run: RunRecord; fanGroup?: FanGroupCompletionPlan }
  | { action: "retry"; reason: string; retry: Extract<RetryNoEventPlan, { action: "retry" }>; run: RunRecord }
  | { action: "exhausted"; reason: string; retry: Extract<RetryNoEventPlan, { action: "exhausted" }>; run: RunRecord; fanGroup?: FanGroupCompletionPlan }
  | { action: "generation-terminal"; reason: string; generation: GenerationImportPlan; terminal: TerminalCompletionPlan; run: RunRecord }
  | { action: "fan-group-member"; event: RunnerEventRecord; agent: CompletionAgentRef; run: RunRecord; fanGroup: FanGroupCompletionPlan }
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
    chainId?: string;
    chainPath?: string;
    workspacePath?: string;
    taskId?: string;
    startSha?: string;
    debug?: boolean;
  };
  fanGroup?: FanGroupState;
  generation?: GenerationImportPlan & { importablePayload?: boolean };
  agentCompleteMarker?: boolean;
  loopGuard?: {
    visited?: string[];
    currentRound?: number;
    maxRounds?: number;
  };
  liveness?: AgentLivenessInput;
  now?: Date;
}

export interface AgentLivenessInput {
  sessionAlive?: boolean;
  processAlive?: boolean;
  outputChanged?: boolean;
  extensionCount?: number;
  maxExtensions?: number;
}

export interface AgentLivenessDecision {
  disposition: "working" | "grace" | "silent-timeout" | "dead";
  reason: string;
}

export interface GenerationImportPlan {
  jobId: string;
  generationKind: string;
  runId: string;
  artifactsDir: string;
  namespaceId?: string;
  orgId?: string;
  webUrl?: string;
}

export function evaluateAgentLiveness(input?: AgentLivenessInput): AgentLivenessDecision {
  if (!input || input.sessionAlive === false) {
    return { disposition: "dead", reason: "no live completion session" };
  }

  const extensionCount = input.extensionCount ?? 0;
  const maxExtensions = input.maxExtensions ?? 6;
  if (extensionCount >= maxExtensions) {
    return { disposition: "silent-timeout", reason: "completion liveness extension cap reached" };
  }

  if (input.processAlive || input.outputChanged) {
    return { disposition: "working", reason: "completion session still active" };
  }

  return { disposition: "grace", reason: "completion session alive but silent; bounded grace active" };
}

export function completeAgent(input: CompleteAgentInput): CompletionRunnerDecision {
  let match = findCompletionEvent({
    agent: input.agent,
    runId: input.runId,
    events: input.events,
  });

  if (!match.matched) {
    const salvaged = synthesizeCompletionEventFromHandoff(input);
    if (salvaged) {
      match = { matched: true, event: salvaged };
    }
  }

  if (!match.matched || !match.event) {
    if (input.generation?.jobId && input.generation.generationKind && input.generation.importablePayload) {
      updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now);
      const run = updateRunStatus(input.runJsonPath, "completed", undefined, input.now);
      markAgentAttemptCompletedFromGeneration({
        runJsonPath: input.runJsonPath,
        runId: input.runId,
        agentId: input.agent.id,
        detail: match.reason || "no matching completion event; generation payload accepted",
        now: input.now,
      });
      return {
        action: "generation-terminal",
        reason: match.reason || "no matching completion event; generation payload accepted",
        generation: input.generation,
        terminal: planTerminalCompletion(input.terminal || {
          runId: input.runId,
          chainId: input.chain.id,
          chainName: input.chain.name || input.chain.id || "unknown",
          lastAgentId: input.agent.id,
        }, "explicit-stop"),
        run,
      };
    }

    if (input.agentCompleteMarker) {
      const salvaged = synthesizeCompletionEventFromAgentCompleteMarker(input);
      if (salvaged) {
        match = { matched: true, event: salvaged };
      }
    }
  }

  if (!match.matched || !match.event) {
    const liveness = evaluateAgentLiveness(input.liveness);
    if (liveness.disposition === "working" || liveness.disposition === "grace") {
      return {
        action: "await-liveness",
        reason: match.reason || "no matching completion event",
        liveness,
        run: readCurrentRun(input.runJsonPath),
      };
    }

    if (shouldCompleteEmptyEmitsAgent(input.agent.emits, hasDownstreamForAgent(input.chain, input.agent.id))) {
      updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now);
      const run = updateRunStatus(input.runJsonPath, "completed", undefined, input.now);
      markAgentAttemptCompletedFromEmptyEmits({
        runJsonPath: input.runJsonPath,
        runId: input.runId,
        agentId: input.agent.id,
        detail: "empty emits last agent accepted as terminal completion",
        now: input.now,
      });
      return {
        action: "terminal",
        reason: "empty-emits-last-agent",
        terminal: planTerminalCompletion(input.terminal || {
          runId: input.runId,
          chainId: input.chain.id,
          chainName: input.chain.name || input.chain.id || "unknown",
          lastAgentId: input.agent.id,
        }, "empty-emits-last-agent"),
        run,
      };
    }

    if (input.retry) {
      const retry = planNoEventRetry({
        runId: input.runId,
        chainId: input.chain.id,
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
      markAgentAttemptRetriesExhausted({
        runJsonPath: input.runJsonPath,
        runId: input.runId,
        agentId: input.agent.id,
        detail: "declared completion event missing; retries exhausted",
        now: input.now,
      });
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
    markAgentAttemptFailedNoCompletion({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      agentId: input.agent.id,
      detail: `declared completion event missing: ${match.reason}`,
      now: input.now,
    });
    return {
      action: "fail",
      reason: match.reason || "no matching completion event",
      fanGroup,
      run,
    };
  }

  const fanGroup = planFanGroupCompletion(input, "complete");
  updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now);
  markAgentAttemptCompletedFromEvent({
    runJsonPath: input.runJsonPath,
    runId: input.runId,
    agentId: input.agent.id,
    detail: `matched completion event ${match.event.event}`,
    now: input.now,
  });
  if (input.fanGroup) {
    return {
      action: "fan-group-member",
      event: match.event,
      agent: input.agent,
      fanGroup: fanGroup!,
      run: readCurrentRun(input.runJsonPath),
    };
  }
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

function synthesizeCompletionEventFromAgentCompleteMarker(input: CompleteAgentInput): RunnerEventRecord | null {
  if (!input.agent.emits) return null;
  const timestamp = (input.now || new Date()).toISOString();
  return {
    event: input.agent.emits,
    source: input.agent.id,
    runId: input.runId,
    timestamp,
    processed: false,
    data: "salvaged-from-agent-complete-marker",
    fields: {
      event: input.agent.emits,
      source: input.agent.id,
      run_id: input.runId,
      timestamp,
      processed: "false",
      data: "salvaged-from-agent-complete-marker",
    },
  };
}

function synthesizeCompletionEventFromHandoff(input: CompleteAgentInput): RunnerEventRecord | null {
  if (!input.agent.emits) return null;
  const runDir = dirname(input.runJsonPath);
  const artifactsDir = join(runDir, "artifacts");
  const candidates = [
    join(artifactsDir, `${input.agent.id}-summary.json`),
    join(artifactsDir, `${input.agent.id}-summary.md`),
  ];
  const artifactPath = candidates.find((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).size > 0;
    } catch {
      return false;
    }
  });
  if (!artifactPath) return null;

  return {
    event: input.agent.emits,
    source: input.agent.id,
    runId: input.runId,
    timestamp: (input.now || new Date()).toISOString(),
    processed: false,
    data: "salvaged-from-agent-handoff-artifacts",
    fields: {
      event: input.agent.emits,
      source: input.agent.id,
      run_id: input.runId,
      timestamp: (input.now || new Date()).toISOString(),
      processed: "false",
      data: "salvaged-from-agent-handoff-artifacts",
      artifact_path: artifactPath,
    },
    path: artifactPath,
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
