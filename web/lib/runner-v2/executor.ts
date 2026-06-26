import type { CompletionPipelineResult } from "@/lib/runner-v2/completion-pipeline";
import type { RunQualityGateEventArtifactInput } from "@/lib/event-artifacts/event-artifact-runner";
import type { GenerationImportPlan } from "@/lib/runner-v2/completion-runner";
import { planCompletionEventSideEffects, type EventSideEffectPlan } from "@/lib/runner-v2/event-side-effects";
import { createFanGroupState, type FanGroupCompletionPlan, type FanGroupState } from "@/lib/runner-v2/fan-group";
import type { RunnerEventRecord } from "@/lib/runner-v2/events";
import type { RetryNoEventPlan } from "@/lib/runner-v2/retry-plan";
import { buildRoutedLaunchPlans, type RoutedLaunchContext, type RoutedLaunchPlan } from "@/lib/runner-v2/routed-launch-plan";
import { planTerminalCompletion, type TerminalCompletionInput, type TerminalCompletionPlan } from "@/lib/runner-v2/terminal-plan";

export type TypedExecutorEffect =
  | { type: "event-side-effects"; plan: EventSideEffectPlan }
  | { type: "event-artifact"; plan: RunQualityGateEventArtifactInput }
  | { type: "generation-import"; plan: GenerationImportPlan }
  | { type: "fan-group-create"; group: FanGroupState }
  | { type: "retry"; plan: RetryNoEventPlan }
  | { type: "fan-group"; plan: FanGroupCompletionPlan }
  | { type: "terminal"; plan: TerminalCompletionPlan }
  | { type: "run-terminal"; status: "completed" | "stopped" | "failed"; reason: string };

export interface TypedExecutorPlan {
  action: "fail" | "retry" | "exhausted" | "generation-terminal" | "route" | "terminal" | "loop-complete" | "max-rounds-stop";
  launches: RoutedLaunchPlan[];
  effects: TypedExecutorEffect[];
}

export interface TypedExecutorInput {
  pipeline: CompletionPipelineResult;
  routeContext: RoutedLaunchContext;
  allEvents?: RunnerEventRecord[];
  terminal?: TerminalCompletionInput;
}

export function buildTypedExecutorPlan(input: TypedExecutorInput): TypedExecutorPlan {
  const { decision } = input.pipeline;
  const effects: TypedExecutorEffect[] = [];
  const launches: RoutedLaunchPlan[] = [];

  if ("event" in decision) {
    effects.push({
      type: "event-side-effects",
      plan: planCompletionEventSideEffects(decision.event, input.allEvents || [decision.event]),
    });
  }

  if ("fanGroup" in decision && decision.fanGroup) {
    effects.push({ type: "fan-group", plan: decision.fanGroup });
    if (decision.fanGroup.launch) {
      launches.push({
        kind: "single",
        command: buildFanGroupLaunchCommand(input.routeContext, decision.fanGroup.launch.agentId),
        env: {
          ...input.routeContext.env,
          ...decision.fanGroup.launch.env,
        },
        detached: false,
      });
    }
  }

  if (decision.action === "route") {
    if (decision.route.action === "stop") {
      effects.push({
        type: "terminal",
        plan: planTerminalCompletion(input.terminal || {
          runId: input.routeContext.env?.MENTIKO_RUN_ID || "",
          chainName: "unknown",
          chainPath: input.routeContext.chainPath,
          taskId: input.routeContext.taskId,
          lastEvent: decision.event.event,
        }, "explicit-stop"),
      });
    } else if (decision.route.action === "wait") {
      effects.push({ type: "run-terminal", status: "completed", reason: "no downstream target" });
    } else if (decision.route.action === "launch" && isFanOutRoute(decision.route)) {
      const fanGroupId = input.routeContext.fanGroupId || `${decision.event.event}-${Date.now()}`;
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
          chainPath: input.routeContext.chainPath,
          runId: input.routeContext.env?.MENTIKO_RUN_ID,
        }),
      });
      launches.push(...buildRoutedLaunchPlans(decision.route, {
        ...input.routeContext,
        fanGroupId,
      }));
    } else {
      launches.push(...buildRoutedLaunchPlans(decision.route, input.routeContext));
    }
  } else if (decision.action === "retry") {
    effects.push({ type: "retry", plan: decision.retry });
    launches.push({
      kind: "single",
      command: buildFanGroupLaunchCommand(input.routeContext, decision.retry.launch.agentId),
      env: { ...input.routeContext.env },
      detached: false,
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
  }

  return {
    action: decision.action,
    launches,
    effects,
  };
}

function isFanOutRoute(route: { action: string; fanIn?: string; waitFor?: string; quorum?: number; onError?: string }): boolean {
  return Boolean(route.fanIn || route.waitFor || route.quorum || route.onError);
}

function buildFanGroupLaunchCommand(context: RoutedLaunchContext, agentId: string): string {
  const [plan] = buildRoutedLaunchPlans({
    action: "launch",
    agentIds: [agentId],
    reason: "typed executor single launch",
  }, context);
  return plan.command;
}
