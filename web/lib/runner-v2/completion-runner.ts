import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { findCompletionEvent, type CompletionAgentRef } from "@/lib/runner-v2/completion";
import { readRunJson, updateRunAgent, updateRunStatus, type RunMutationObserver, type RunRecord } from "@/lib/runner-v2/run-state";
import { decideNextRoute, routingContextForEvents, type RoutingChain, type RoutingDecision } from "@/lib/runner-v2/routing";
import type { RunnerEventRecord } from "@/lib/runner-v2/events";
import { planTerminalCompletion, shouldCompleteEmptyEmitsAgent, type TerminalCompletionInput, type TerminalCompletionPlan } from "@/lib/runner-v2/terminal-plan";
import { planNoEventRetry, type RetryNoEventPlan, type RetryPolicy } from "@/lib/runner-v2/retry-plan";
import { completeFanGroupMember, type FanGroupCompletionPlan, type FanGroupState } from "@/lib/runner-v2/fan-group";
import { applyLoopGuardToRoute, routeAgentIds, type LoopGuardDecision } from "@/lib/runner-v2/loop-guard";
import {
  markAgentAttemptCompletedFromCrossRunEvent,
  markAgentAttemptCompletedFromDurableMarker,
  markAgentAttemptCompletedFromEmptyEmits,
  markAgentAttemptCompletedFromEvent,
  markAgentAttemptCompletedFromGeneration,
  markAgentAttemptCompletedFromHandoffArtifact,
  markAgentAttemptFailedNoCompletion,
  markAgentAttemptRetriesExhausted,
  readRunnerV2AttemptState,
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
  /** Exact AgentAttempt owned by this completion handoff. */
  attemptId?: string;
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
    occurrenceId?: string;
  };
  fanGroup?: FanGroupState;
  generation?: GenerationImportPlan & { importablePayload?: boolean };
  // Recovery evidence can only be introduced by the typed monitor after it
  // validates the corresponding durable proof. It is intentionally distinct
  // from a declared event so the run record does not claim an event was
  // accepted when recovery actually came from a marker or a guarded cross-run
  // adoption.
  completionRecoveryEvidence?: CompletionRecoveryEvidence;
  loopGuard?: {
    visited?: string[];
    currentRound?: number;
    maxRounds?: number;
  };
  liveness?: AgentLivenessInput;
  now?: Date;
  onRunMutation?: RunMutationObserver;
}

export type CompletionRecoveryEvidence =
  | "durable-marker"
  | "accepted-cross-run-event";

type CompletionEvidenceProvenance =
  | "declared-event"
  | "durable-marker"
  | "accepted-cross-run-event"
  | "handoff-artifact";

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
  let completionEvidence: CompletionEvidenceProvenance = "declared-event";
  let match = findCompletionEvent({
    agent: input.agent,
    runId: input.runId,
    events: input.events,
    allAgentIds: input.chain.agents.map((candidate) => candidate.id),
  });

  if (!match.matched) {
    // Only adopt a leftover handoff artifact once the agent is no longer
    // actively working. Salvaging before the liveness check (below) would
    // falsely complete a still-live agent that merely wrote an interim summary,
    // preempting the grace window. A dead/silent-timeout agent with a fresh
    // artifact is the real "event lost but work finished" case this salvages.
    const salvageLiveness = evaluateAgentLiveness(input.liveness);
    if (salvageLiveness.disposition !== "working" && salvageLiveness.disposition !== "grace") {
      const salvaged = synthesizeCompletionEventFromHandoff(input);
      if (salvaged) {
        match = { matched: true, event: salvaged };
        completionEvidence = "handoff-artifact";
      }
    }
  }

  // Core generation completion has two required proofs: an agent completion
  // signal AND a current, kind-compatible JSON handoff. A declared event or a
  // durable AGENT_COMPLETE marker without that payload is a failed generation,
  // not a completed run. This is the producer-side guard for the clean-project
  // workflow: bad model data must enter the bounded retry path instead of
  // becoming a poisoned `complete` job that blocks the task graph forever.
  if (
    input.generation?.jobId
    && input.generation.generationKind
    && input.generation.importablePayload === false
    && (match.matched || input.completionRecoveryEvidence)
  ) {
    const reason = `generation agent completed without a valid ${input.generation.generationKind} JSON payload`;
    const fanGroup = planFanGroupCompletion(input, "failed");
    updateRunAgent(input.runJsonPath, input.agent.id, "failed", input.now, input.onRunMutation);
    const run = updateRunStatus(input.runJsonPath, "failed", reason, input.now, input.onRunMutation);
    markAgentAttemptFailedNoCompletion({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      agentId: input.agent.id,
      attemptId: input.attemptId,
      detail: reason,
      now: input.now,
      onMutation: input.onRunMutation,
    });
    return { action: "fail", reason, fanGroup, run };
  }

  if (!match.matched || !match.event) {
    if (input.generation?.jobId && input.generation.generationKind && input.generation.importablePayload) {
      updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now, input.onRunMutation);
      const run = updateRunStatus(input.runJsonPath, "completed", undefined, input.now, input.onRunMutation);
      markAgentAttemptCompletedFromGeneration({
        runJsonPath: input.runJsonPath,
        runId: input.runId,
        agentId: input.agent.id,
        attemptId: input.attemptId,
        detail: match.reason || "no matching completion event; generation payload accepted",
        now: input.now,
        onMutation: input.onRunMutation,
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

    if (input.completionRecoveryEvidence === "accepted-cross-run-event") {
      const salvaged = synthesizeCompletionEventFromAcceptedCrossRunEvent(input);
      if (salvaged) {
        match = { matched: true, event: salvaged };
        completionEvidence = "accepted-cross-run-event";
      }
    }
  }

  if (!match.matched || !match.event) {
    // AGENT_COMPLETE is a durable declaration that the agent has stopped
    // producing work. It is completion evidence for the monitor, not a routing
    // event. Once that marker is latched there is no liveness grace left to
    // wait out and no event to fabricate: fail the declared-event contract
    // immediately so the typed entrypoint terminalizes the run, preserves the
    // artifacts, and tears down the agent + monitor PTYs.
    const expectedEvent = input.agent.emits?.trim();
    if (input.completionRecoveryEvidence === "durable-marker" && expectedEvent) {
      const reason = `agent ${input.agent.id} reported AGENT_COMPLETE without declared event '${expectedEvent}'`;
      const fanGroup = planFanGroupCompletion(input, "failed");
      updateRunAgent(input.runJsonPath, input.agent.id, "failed", input.now, input.onRunMutation);
      const run = updateRunStatus(input.runJsonPath, "failed", reason, input.now, input.onRunMutation);
      markAgentAttemptFailedNoCompletion({
        runJsonPath: input.runJsonPath,
        runId: input.runId,
        agentId: input.agent.id,
        attemptId: input.attemptId,
        detail: `declared completion event '${expectedEvent}' missing after AGENT_COMPLETE`,
        now: input.now,
        onMutation: input.onRunMutation,
      });
      return {
        action: "fail",
        reason,
        fanGroup,
        run,
      };
    }

    const liveness = evaluateAgentLiveness(input.liveness);
    // A durable marker is a sticky "the agent is done" latch. For the
    // backward-compatible empty-emits terminal-agent case, bypass liveness and
    // let the explicit terminal rule below complete without inventing an event.
    // Declared-event agents already failed above when their event was absent.
    const markerLatched = input.completionRecoveryEvidence === "durable-marker";
    if (!markerLatched && (liveness.disposition === "working" || liveness.disposition === "grace")) {
      return {
        action: "await-liveness",
        reason: match.reason || "no matching completion event",
        liveness,
        run: readCurrentRun(input.runJsonPath),
      };
    }

    if (shouldCompleteEmptyEmitsAgent(input.agent.emits, hasDownstreamForAgent(input.chain, input.agent.id))) {
      updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now, input.onRunMutation);
      const run = updateRunStatus(input.runJsonPath, "completed", undefined, input.now, input.onRunMutation);
      markAgentAttemptCompletedFromEmptyEmits({
        runJsonPath: input.runJsonPath,
        runId: input.runId,
        agentId: input.agent.id,
        attemptId: input.attemptId,
        detail: "empty emits last agent accepted as terminal completion",
        now: input.now,
        onMutation: input.onRunMutation,
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
        occurrenceId: input.retry.occurrenceId,
      });

      if (retry.action === "retry") {
        return {
          action: "retry",
          reason: match.reason || "no matching completion event",
          retry,
          run: readCurrentRun(input.runJsonPath),
        };
      }

      updateRunAgent(input.runJsonPath, input.agent.id, "failed", input.now, input.onRunMutation);
      const run = updateRunStatus(
        input.runJsonPath,
        "stopped",
        `agent ${input.agent.id} completed without declared event; retries exhausted`,
        input.now,
        input.onRunMutation,
      );
      markAgentAttemptRetriesExhausted({
        runJsonPath: input.runJsonPath,
        runId: input.runId,
        agentId: input.agent.id,
        attemptId: input.attemptId,
        detail: "declared completion event missing; retries exhausted",
        now: input.now,
        onMutation: input.onRunMutation,
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
    updateRunAgent(input.runJsonPath, input.agent.id, "failed", input.now, input.onRunMutation);
    const run = updateRunStatus(
      input.runJsonPath,
      "failed",
      `agent ${input.agent.id} completed without declared event: ${match.reason}`,
      input.now,
      input.onRunMutation,
    );
    markAgentAttemptFailedNoCompletion({
      runJsonPath: input.runJsonPath,
      runId: input.runId,
      agentId: input.agent.id,
      attemptId: input.attemptId,
      detail: `declared completion event missing: ${match.reason}`,
      now: input.now,
      onMutation: input.onRunMutation,
    });
    return {
      action: "fail",
      reason: match.reason || "no matching completion event",
      fanGroup,
      run,
    };
  }

  const fanGroup = planFanGroupCompletion(input, "complete");
  updateRunAgent(input.runJsonPath, input.agent.id, "complete", input.now, input.onRunMutation);
  markCompletionEvidence({
    runJsonPath: input.runJsonPath,
    runId: input.runId,
    agentId: input.agent.id,
    attemptId: input.attemptId,
    event: match.event.event,
    evidence: completionEvidence,
    now: input.now,
    onMutation: input.onRunMutation,
  });
  // Older generated chains may have a one-member fan-out whose fan-in names
  // that same member. Do not short-circuit normal completion into a second
  // launch; the fan-group planner marks it complete without a launch and the
  // ordinary route below performs terminal completion or the real next route.
  if (input.fanGroup && !isSelfReferentialFanIn(input.fanGroup, input.agent.id)) {
    return {
      action: "fan-group-member",
      event: match.event,
      agent: input.agent,
      fanGroup: fanGroup!,
      run: readCurrentRun(input.runJsonPath),
    };
  }
  const route = decideNextRoute(
    input.chain,
    match.event.event,
    match.event.timestamp,
    routingContextForEvents(input.events, input.runId, match.event.event),
  );
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
    const run = updateRunStatus(input.runJsonPath, "completed", undefined, input.now, input.onRunMutation);
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
      input.onRunMutation,
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

function synthesizeCompletionEventFromAcceptedCrossRunEvent(input: CompleteAgentInput): RunnerEventRecord | null {
  if (!input.agent.emits) return null;
  const timestamp = (input.now || new Date()).toISOString();
  return {
    event: input.agent.emits,
    source: input.agent.id,
    runId: input.runId,
    timestamp,
    processed: false,
    data: "salvaged-from-accepted-cross-run-event",
    fields: {
      event: input.agent.emits,
      source: input.agent.id,
      run_id: input.runId,
      timestamp,
      processed: "false",
      data: "salvaged-from-accepted-cross-run-event",
    },
  };
}

function markCompletionEvidence(input: {
  runJsonPath: string;
  runId: string;
  agentId: string;
  attemptId?: string;
  event: string;
  evidence: CompletionEvidenceProvenance;
  now?: Date;
  onMutation?: RunMutationObserver;
}): void {
  const common = {
    runJsonPath: input.runJsonPath,
    runId: input.runId,
    agentId: input.agentId,
    attemptId: input.attemptId,
    now: input.now,
    onMutation: input.onMutation,
  };
  switch (input.evidence) {
    case "durable-marker":
      markAgentAttemptCompletedFromDurableMarker({
        ...common,
        detail: `durable AGENT_COMPLETE marker recovered declared completion ${input.event}`,
      });
      return;
    case "accepted-cross-run-event":
      markAgentAttemptCompletedFromCrossRunEvent({
        ...common,
        detail: `accepted cross-run completion event recovered declared completion ${input.event}`,
      });
      return;
    case "handoff-artifact":
      markAgentAttemptCompletedFromHandoffArtifact({
        ...common,
        detail: `fresh handoff artifact recovered declared completion ${input.event}`,
      });
      return;
    case "declared-event":
      markAgentAttemptCompletedFromEvent({
        ...common,
        detail: `matched declared completion event ${input.event}`,
      });
  }
}

function synthesizeCompletionEventFromHandoff(input: CompleteAgentInput): RunnerEventRecord | null {
  if (!input.agent.emits) return null;
  const runDir = dirname(input.runJsonPath);
  const artifactsDir = join(runDir, "artifacts");
  const candidates = [
    join(artifactsDir, `${input.agent.id}-summary.json`),
    join(artifactsDir, `${input.agent.id}-summary.md`),
  ];
  // Require the artifact to be at least as new as the current attempt so a
  // stale summary left by a PRIOR attempt (the filename is agent-id-keyed, not
  // attempt-keyed) cannot salvage-complete a fresh retry from old output.
  const attemptStartMs = attemptStartTimeMs(
    input.runJsonPath,
    input.runId,
    input.agent.id,
    input.attemptId,
  );
  const artifactPath = candidates.find((candidate) => {
    try {
      if (!existsSync(candidate)) return false;
      const stat = statSync(candidate);
      if (stat.size <= 0) return false;
      if (attemptStartMs !== null && stat.mtimeMs < attemptStartMs) return false;
      return true;
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

// Start time of the exact completion attempt when available; legacy callers
// without an attempt id retain the append-order fallback. This keeps a stale
// retry artifact from being attributed to an older completion handoff.
function attemptStartTimeMs(
  runJsonPath: string,
  runId: string,
  agentId: string,
  attemptId?: string,
): number | null {
  let attempts: ReturnType<typeof readRunnerV2AttemptState>["attempts"];
  try {
    attempts = readRunnerV2AttemptState(runJsonPath).attempts
      .filter((attempt) => attempt.runId === runId && attempt.agentId === agentId);
  } catch {
    return null;
  }
  if (attempts.length === 0) return null;
  const attempt = attemptId
    ? attempts.find((candidate) => candidate.id === attemptId)
    : attempts[attempts.length - 1];
  if (!attempt) throw new Error(`completion AgentAttempt not found: ${attemptId}`);
  const startedMs = new Date(attempt.createdAt).getTime();
  return Number.isFinite(startedMs) ? startedMs : null;
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

function isSelfReferentialFanIn(group: FanGroupState, agentId: string): boolean {
  return group.fanInAgent === agentId && group.fanOutAgents.includes(agentId);
}
