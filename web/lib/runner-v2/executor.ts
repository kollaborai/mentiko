import type { CompletionPipelineResult } from "@/lib/runner-v2/completion-pipeline";
import { createHash } from "node:crypto";
import type { RunQualityGateEventArtifactInput } from "@/lib/event-artifacts/event-artifact-runner";
import { shellEscape } from "@/lib/api/audit-exec";
import type { GenerationImportPlan } from "@/lib/runner-v2/completion-runner";
import { planCompletionEventSideEffects, type EventSideEffectPlan } from "@/lib/runner-v2/event-side-effects";
import { createFanGroupState, type FanGroupCompletionPlan, type FanGroupState } from "@/lib/runner-v2/fan-group";
import type { RunnerEventRecord } from "@/lib/runner-v2/events";
import type { RetryNoEventPlan } from "@/lib/runner-v2/retry-plan";
import { buildRoutedLaunchPlans, type RoutedLaunchContext, type RoutedLaunchPlan } from "@/lib/runner-v2/routed-launch-plan";
import { planAgentCompletion, planTerminalCompletion, planTerminalFailure, type AgentCompletionInput, type AgentCompletionPlan, type TerminalCompletionInput, type TerminalCompletionPlan, type TerminalFailurePlan } from "@/lib/runner-v2/terminal-plan";

export type TypedExecutorEffect =
  | { type: "event-side-effects"; plan: EventSideEffectPlan }
  | { type: "event-artifact"; plan: RunQualityGateEventArtifactInput }
  | { type: "generation-import"; plan: GenerationImportPlan }
  | { type: "fan-group-create"; group: FanGroupState }
  | { type: "retry"; plan: RetryNoEventPlan }
  | { type: "fan-group"; plan: FanGroupCompletionPlan; agentId?: string; status?: "complete" | "failed" }
  | { type: "agent-completion"; plan: AgentCompletionPlan }
  | { type: "terminal"; plan: TerminalCompletionPlan }
  | { type: "terminal-failure"; plan: TerminalFailurePlan }
  | { type: "run-terminal"; status: "completed" | "stopped" | "failed"; reason: string };

export interface TypedExecutorPlan {
  action: "already-completed" | "await-liveness" | "fail" | "retry" | "exhausted" | "generation-terminal" | "route" | "terminal" | "loop-complete" | "max-rounds-stop" | "fan-group-member" | "workspace-conflict";
  /** Stable identity for every replayable operation in this completion. */
  occurrenceId?: string;
  launches: RoutedLaunchPlan[];
  effects: TypedExecutorEffect[];
}

export interface TypedExecutorInput {
  pipeline: CompletionPipelineResult;
  routeContext: RoutedLaunchContext;
  allEvents?: RunnerEventRecord[];
  allAgentIds?: string[];
  terminal?: TerminalCompletionInput;
  agentCompletion?: AgentCompletionInput;
}

const AGENT_COMPLETE_ACTIONS = new Set([
  "route",
  "loop-complete",
  "max-rounds-stop",
  "terminal",
  "generation-terminal",
]);

export function buildTypedExecutorPlan(input: TypedExecutorInput): TypedExecutorPlan {
  const { decision } = input.pipeline;
  const effects: TypedExecutorEffect[] = [];
  const launches: RoutedLaunchPlan[] = [];
  let eventSideEffects: EventSideEffectPlan | undefined;

  if ("event" in decision) {
    eventSideEffects = planCompletionEventSideEffects(
      decision.event,
      input.allEvents || [decision.event],
      input.allAgentIds,
      {
        agentId: input.agentCompletion?.agentId,
        sessionName: input.agentCompletion?.sessionName,
      },
    );
    effects.push({
      type: "event-side-effects",
      plan: eventSideEffects,
    });
  }

  const acceptedOccurrenceId = eventSideEffects?.acceptedTrigger
    ? bindAcceptedEventOccurrence(
      input.agentCompletion?.occurrenceId
        || input.routeContext.env?.MENTIKO_COMPLETION_OCCURRENCE_ID,
      eventSideEffects.acceptedTrigger.occurrenceToken,
    )
    : input.agentCompletion?.occurrenceId
      || input.routeContext.env?.MENTIKO_COMPLETION_OCCURRENCE_ID;
  const routeContext: RoutedLaunchContext = acceptedOccurrenceId
    ? {
      ...input.routeContext,
      env: {
        ...input.routeContext.env,
        MENTIKO_COMPLETION_OCCURRENCE_ID: acceptedOccurrenceId,
      },
    }
    : input.routeContext;

  // per-agent side effects (agent-completed plugin/notification + chain-config
  // agent_complete webhook) mirror the shell handler for every completion that
  // marks the agent complete. fail/retry/exhausted verdicts do not fire these;
  // the failure paths carry their own agent-failed effects.
  if (input.agentCompletion && AGENT_COMPLETE_ACTIONS.has(decision.action)) {
    effects.push({
      type: "agent-completion",
      plan: planAgentCompletion({
        ...input.agentCompletion,
        ...(acceptedOccurrenceId ? { occurrenceId: acceptedOccurrenceId } : {}),
      }),
    });
  }

  if ("fanGroup" in decision && decision.fanGroup) {
    effects.push({
      type: "fan-group",
      plan: decision.fanGroup,
      agentId: decision.action === "fan-group-member" ? decision.agent.id : input.agentCompletion?.agentId,
      status: decision.action === "fail" || decision.action === "exhausted" ? "failed" : "complete",
    });
  }

  if (decision.action === "route") {
    if (decision.route.action === "stop") {
      effects.push({
        type: "terminal",
        plan: planTerminalCompletion(terminalInputForRoute(input, decision.event.event), "explicit-stop"),
      });
    } else if (decision.route.action === "wait") {
      if (decision.route.pending) {
        // downstream targets are already running or blocked on other
        // prerequisites: predecessor parity is a quiet exit (the retired handler
        // "downstream already active" / "waiting for prerequisites"). The run
        // stays running; the in-flight sibling's completion finalizes it.
      } else {
        // no downstream work exists for this event: this is the run-terminal
        // completion. Mirror the shell no-downstream finalization (task update,
        // chain_complete webhook, chain-complete event, plugins, notifications,
        // hooks, metadata webhooks, legacy webhook) instead of only flipping
        // run status.
        effects.push({
          type: "terminal",
          plan: planTerminalCompletion(terminalInputForRoute(input, decision.event.event), "no-downstream"),
        });
      }
    } else if (decision.route.action === "launch" && isFanOutRoute(decision.route)) {
      const fanGroupId = routeContext.fanGroupId || stableFanGroupId({
        runId: routeContext.env?.MENTIKO_RUN_ID,
        event: decision.event.event,
        occurrenceId: acceptedOccurrenceId,
      });
      effects.push({
        type: "fan-group-create",
        group: createFanGroupState({
          id: fanGroupId,
          event: decision.event.event,
          fanOutAgents: decision.route.agentIds,
          fanInAgent: decision.route.fanIn,
          waitFor: decision.route.waitFor,
          quorum: decision.route.quorum,
          onError: decision.route.onError,
          chainPath: routeContext.chainPath,
          runId: routeContext.env?.MENTIKO_RUN_ID,
        }),
      });
      launches.push(...buildRoutedLaunchPlans(decision.route, {
        ...routeContext,
        fanGroupId,
      }));
    } else {
      launches.push(...buildRoutedLaunchPlans(decision.route, routeContext));
    }
  } else if (decision.action === "retry") {
    effects.push({ type: "retry", plan: decision.retry });
    launches.push({
      kind: "single",
      command: buildRetryLaunchCommand(routeContext, decision.retry.launch.agentId, decision.retry.delaySeconds),
      env: {
        ...routeContext.env,
        MENTIKO_RETRY_ATTEMPT: String(decision.retry.nextAttempt),
        RETRY_ATTEMPT: String(decision.retry.nextAttempt),
      },
    });
  } else if (decision.action === "exhausted") {
    effects.push({ type: "retry", plan: decision.retry });
  } else if (decision.action === "generation-terminal") {
    effects.push({ type: "generation-import", plan: decision.generation });
    effects.push({ type: "terminal", plan: decision.terminal });
  } else if (decision.action === "terminal") {
    effects.push({ type: "terminal", plan: decision.terminal });
  } else if (decision.action === "loop-complete") {
    effects.push({ type: "run-terminal", status: "completed", reason: decision.loopGuard.reason });
  } else if (decision.action === "max-rounds-stop") {
    effects.push({ type: "run-terminal", status: "stopped", reason: decision.loopGuard.reason });
  } else if (decision.action === "fail") {
    effects.push({ type: "run-terminal", status: "failed", reason: decision.reason });
    effects.push({
      type: "terminal-failure",
      plan: planTerminalFailure({
        runId: input.terminal?.runId || input.routeContext.env?.MENTIKO_RUN_ID || "",
        chainId: input.terminal?.chainId || input.routeContext.env?.MENTIKO_CHAIN_ID,
        chainName: input.terminal?.chainName || "unknown",
        chainPath: input.terminal?.chainPath || input.routeContext.chainPath,
        // A supplied terminal context intentionally owns task provenance. Its
        // undefined taskId means this is a non-execution system run; falling
        // through to routeContext.taskId would reintroduce task mutation.
        taskId: input.terminal ? input.terminal.taskId : input.routeContext.taskId,
        agentId: input.terminal?.lastAgentId,
        reason: decision.reason,
        occurrenceId: acceptedOccurrenceId,
      }),
    });
  }

  return {
    action: decision.action,
    ...(acceptedOccurrenceId ? { occurrenceId: acceptedOccurrenceId } : {}),
    launches,
    effects,
  };
}

function bindAcceptedEventOccurrence(base: string | undefined, occurrenceToken: string): string {
  const digest = createHash("sha256")
    .update(base || "runner-v2-completion")
    .update("\0")
    .update(occurrenceToken)
    .digest("hex")
    .slice(0, 32);
  return `runner-v2-event-occurrence:${digest}:v1`;
}

function stableFanGroupId(input: { runId?: string; event: string; occurrenceId?: string }): string {
  const digest = createHash("sha256")
    .update(input.runId || "unknown-run")
    .update("\0")
    .update(input.event)
    .update("\0")
    .update(input.occurrenceId || "unknown-occurrence")
    .digest("hex")
    .slice(0, 32);
  return `fan-group-${digest}`;
}

function isFanOutRoute(route: { action: string; fanIn?: string; waitFor?: string; quorum?: number; onError?: string }): boolean {
  return Boolean(route.fanIn || route.waitFor || route.quorum || route.onError);
}

function terminalInputForRoute(input: TypedExecutorInput, eventName: string): TerminalCompletionInput {
  const base = input.terminal || {
    runId: input.routeContext.env?.MENTIKO_RUN_ID || "",
    chainId: input.routeContext.env?.MENTIKO_CHAIN_ID,
    chainName: "unknown",
    chainPath: input.routeContext.chainPath,
    taskId: input.routeContext.taskId,
  };
  // shell parity: the terminal webhook/event carry last_event from the
  // completion that ended the chain.
  return { ...base, lastEvent: base.lastEvent ?? eventName };
}

function buildFanGroupLaunchCommand(context: RoutedLaunchContext, agentId: string): string {
  const [plan] = buildRoutedLaunchPlans({
    action: "launch",
    agentIds: [agentId],
    reason: "typed executor single launch",
  }, context);
  return plan.command;
}

function buildRetryLaunchCommand(context: RoutedLaunchContext, agentId: string, delaySeconds: number): string {
  const command = buildFanGroupLaunchCommand(context, agentId);
  const delay = Number.isFinite(delaySeconds) && delaySeconds > 0 ? delaySeconds : 0;
  return delay > 0 ? `sleep ${shellEscape(String(delay))}; ${command}` : command;
}
