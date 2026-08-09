import { parseRunnerEvent, validateRunnerEventRecord, type RunnerEventRecord } from "@/lib/runner-v2/events";

export type RoutingWaitStrategy = "all" | "any" | "quorum";

export interface RoutingWaitForEvents {
  events: string[];
  wait_for?: RoutingWaitStrategy;
  quorum?: number;
}

export interface RoutingContext {
  /** Validated event names already fired for this exact run. */
  firedEvents?: readonly string[];
  /** The event currently being routed; supplied by decideNextRoute. */
  currentEvent?: string;
}

export interface RoutingAgent {
  id: string;
  emits?: string;
  triggers?: string[];
  wait_for_events?: RoutingWaitForEvents;
  status?: string;
  lastAttemptCreatedAt?: string;
}

export interface RoutingChain {
  id?: string;
  name?: string;
  branches?: Record<string, unknown>;
  agents: RoutingAgent[];
}

export type RoutingDecision =
  | { action: "stop"; reason: string }
  | { action: "launch"; agentIds: string[]; reason: string; fanIn?: string; waitFor?: string; quorum?: number; onError?: string }
  // pending=true means downstream work is still in flight (targets already
  // running/complete or waiting on other prerequisites) — the run is NOT over.
  // A wait without pending means the chain has no further work for this event.
  | { action: "wait"; reason: string; pending?: boolean };

const ACTIVE_OR_DONE = new Set(["running", "complete", "completed"]);

export function decideNextRoute(
  chain: RoutingChain,
  eventName: string,
  eventTimestamp?: string,
  context?: RoutingContext,
): RoutingDecision {
  const routingContext = { ...context, currentEvent: eventName };
  const branch = findBranch(chain.branches, eventName);
  if (branch !== undefined) {
    return decisionFromBranch(branch, chain.agents, eventName, eventTimestamp, routingContext);
  }

  const triggerMatches = chain.agents
    .filter((agent) => triggerListMatches(routeTriggers(agent), eventName))
    .map((agent) => agent.id);

  return decisionFromTargets(triggerMatches, chain.agents, "trigger match", eventTimestamp, routingContext);
}

export function normalizeRouteEvent(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+(round|revision|rev)[-_\s]*\d+$/i, "")
    .replace(/\s+/g, "-");
}

function decisionFromBranch(
  branch: unknown,
  agents: RoutingAgent[],
  eventName: string,
  eventTimestamp?: string,
  context?: RoutingContext,
): RoutingDecision {
  if (typeof branch === "string") {
    if (branch === "stop") {
      return { action: "stop", reason: "explicit stop branch" };
    }
    return decisionFromTargets([branch], agents, "branch match", eventTimestamp, context);
  }

  if (Array.isArray(branch)) {
    return decisionFromTargets(
      branch.filter((value): value is string => typeof value === "string"),
      agents,
      "branch fan-out",
      eventTimestamp,
      context,
    );
  }

  if (isFanOutBranch(branch)) {
    const decision = decisionFromTargets(branch.fan_out, agents, "branch fan-out", eventTimestamp, context);
    if (decision.action !== "launch") return decision;
    // A generated chain once used the same agent as the fan-out member and
    // fan-in target. That launches the agent normally, then launches it again
    // when its own completion satisfies the one-member group. Treat the
    // redundant join declaration as a plain route so persisted/generated
    // single-target chains execute exactly once.
    if (branch.fan_in && decision.agentIds.includes(branch.fan_in)) {
      return decision;
    }
    return {
      ...decision,
      fanIn: branch.fan_in,
      waitFor: branch.wait_for,
      quorum: branch.quorum,
      onError: branch.on_error,
    };
  }

  if (isConditionalBranch(branch)) {
    const target = branch.conditions.find((condition) => routeConditionMatches(condition.if, eventName))?.then
      ?? branch.default;
    return target
      ? decisionFromTargets([target], agents, "branch condition", eventTimestamp, context)
      : { action: "wait", reason: "no conditional branch matched" };
  }

  return { action: "wait", reason: "unsupported branch shape" };
}

function decisionFromTargets(
  targets: string[],
  agents: RoutingAgent[],
  reason: string,
  eventTimestamp?: string,
  context?: RoutingContext,
): RoutingDecision {
  const runnable = targets.filter((target) => {
    const agent = agents.find((candidate) => candidate.id === target);
    return agent
      && !agentIsActiveOrDoneForOccurrence(agent, eventTimestamp)
      && prerequisitesComplete(agent, agents, context);
  });

  if (runnable.length === 0) {
    const knownTargets = targets.filter((target) => agents.some((agent) => agent.id === target));
    if (knownTargets.length > 0) {
      // at least one target is a real agent that's running/complete or
      // blocked on other prerequisites: v1 exits quietly here
      // (the predecessor completion path's "downstream already active" / "waiting for
      // prerequisites") — the run must stay running.
      return { action: "wait", reason: "targets already active or complete", pending: true };
    }
    if (targets.length > 0) {
      // every target names an agent id that doesn't exist in this chain, so
      // it will never launch — reporting pending here would hang the run
      // forever (this is reachable: dirty chains with branch targets that
      // match no agent id).
      return { action: "wait", reason: "targets reference unknown agents", pending: false };
    }
    return { action: "wait", reason: "no downstream target" };
  }

  return { action: "launch", agentIds: Array.from(new Set(runnable)), reason };
}

function agentIsActiveOrDoneForOccurrence(agent: RoutingAgent, eventTimestamp?: string): boolean {
  if (!ACTIVE_OR_DONE.has(agent.status || "")) return false;
  if (!["complete", "completed"].includes(agent.status || "")) return true;
  const eventAt = eventTimestamp ? Date.parse(eventTimestamp) : Number.NaN;
  const attemptAt = agent.lastAttemptCreatedAt ? Date.parse(agent.lastAttemptCreatedAt) : Number.NaN;
  // A completed target whose latest generation predates this event is eligible
  // for a new loop visit. If either timestamp is absent, preserve the original
  // conservative de-duplication behavior.
  return !(Number.isFinite(eventAt) && Number.isFinite(attemptAt) && eventAt > attemptAt);
}

function findBranch(branches: Record<string, unknown> | undefined, eventName: string): unknown {
  if (!branches) return undefined;
  if (branches[eventName] !== undefined) return branches[eventName];
  const normalizedEvent = normalizeRouteEvent(eventName);
  const key = Object.keys(branches).find((candidate) => normalizeRouteEvent(candidate) === normalizedEvent);
  return key ? branches[key] : undefined;
}

function routeTriggers(agent: RoutingAgent): string[] {
  const configured = agent.wait_for_events?.events;
  return configured && configured.length > 0 ? configured : agent.triggers || [];
}

function triggerListMatches(triggers: string[], eventName: string): boolean {
  const normalizedEvent = normalizeRouteEvent(eventName);
  return triggers.some((trigger) => normalizeRouteEvent(trigger) === normalizedEvent);
}

function routeConditionMatches(condition: string, eventName: string): boolean {
  if (condition === eventName || normalizeRouteEvent(condition) === normalizeRouteEvent(eventName)) {
    return true;
  }
  try {
    return new RegExp(condition).test(eventName);
  } catch {
    return false;
  }
}

// Explicit wait_for_events policies use the validated same-run event history
// supplied by completion, recovery, reconcile, and resume. Legacy multi-trigger
// chains retain their historical AND fallback when no policy is declared.
function prerequisitesComplete(target: RoutingAgent, agents: RoutingAgent[], context?: RoutingContext): boolean {
  const triggers = routeTriggers(target);
  if (triggers.length <= 1) return true;

  const fired = normalizedFiredEvents(context);
  if (target.wait_for_events) {
    const evidence = context?.firedEvents !== undefined
      ? fired
      : new Set([
          ...fired,
          ...agents
            .filter((agent) => agent.status === "complete" || agent.status === "completed")
            .map((agent) => normalizeRouteEvent(agent.emits || "")),
        ]);
    return waitPolicySatisfied(
      triggers,
      evidence,
      target.wait_for_events.wait_for || "all",
      target.wait_for_events.quorum,
      true,
    );
  }

  // Preserve the pre-existing legacy-chain AND behavior when no explicit
  // wait_for_events policy exists. A supplied fired-event set is authoritative
  // for conditional outcomes; static `emits` is only the compatibility
  // fallback for callers that have no event history.
  if (context?.firedEvents !== undefined) {
    return triggers.every((trigger) => fired.has(normalizeRouteEvent(trigger)));
  }
  return legacyStaticPrerequisitesComplete(triggers, agents);
}

function legacyStaticPrerequisitesComplete(triggers: string[], agents: RoutingAgent[]): boolean {
  return triggers.every((trigger) => {
    const emitters = agents.filter((agent) => normalizeRouteEvent(agent.emits || "") === normalizeRouteEvent(trigger));
    return emitters.length === 0 || emitters.some((agent) => agent.status === "complete" || agent.status === "completed");
  });
}

function normalizedFiredEvents(context?: RoutingContext): Set<string> {
  const fired = new Set((context?.firedEvents || []).map(normalizeRouteEvent));
  if (context?.currentEvent) fired.add(normalizeRouteEvent(context.currentEvent));
  return fired;
}

function waitPolicySatisfied(
  triggers: string[],
  fired: Set<string>,
  strategy: RoutingWaitStrategy,
  quorum: number | undefined,
  hasEventHistory: boolean,
): boolean {
  // An explicit policy without history must not guess from static declarations
  // for all/quorum. The current event is still included in `fired`, so an
  // explicit any policy remains routable in direct callers and live completion.
  if (!hasEventHistory && strategy !== "any") return false;
  const normalizedTriggers = new Set(triggers.map(normalizeRouteEvent));
  const matched = [...normalizedTriggers].filter((trigger) => fired.has(trigger)).length;
  if (strategy === "any") return matched >= 1;
  if (strategy === "quorum") return matched >= Math.max(1, quorum || 0);
  return matched === normalizedTriggers.size;
}

/** Build routing evidence from valid event records belonging to one run. */
export function routingContextForEvents(
  events: Iterable<RunnerEventRecord | string>,
  runId: string,
  currentEvent?: string,
): RoutingContext {
  const fired = new Set<string>();
  for (const candidate of events) {
    let event: RunnerEventRecord;
    try {
      event = typeof candidate === "string" ? parseRunnerEvent(candidate) : candidate;
    } catch {
      continue;
    }
    if (event.runId !== runId || !validateRunnerEventRecord(event).valid) continue;
    fired.add(normalizeRouteEvent(event.event));
  }
  return {
    firedEvents: [...fired],
    ...(currentEvent ? { currentEvent } : {}),
  };
}

// Does this agent have a trigger already produced by a COMPLETED in-chain emitter?
// Used by run resume to pick the true frontier (a trigger-eligible agent) instead of
// the first pending agent by array order. The caller MUST hydrate agent statuses from
// run.json (the resume route does). Correct for merge triggers whose direct emitter
// has a single unambiguous `emits`; a chain whose upstream emits a *conditional*
// (branch-key) event differing from its static `emits` needs the actually-fired event
// set supplied by the caller instead of static declarations.
export function hasCompletedTrigger(target: RoutingAgent, agents: RoutingAgent[], context?: RoutingContext): boolean {
  const triggers = routeTriggers(target);
  if (target.wait_for_events) {
    const fired = context?.firedEvents !== undefined
      ? normalizedFiredEvents(context)
      : new Set(
          agents
            .filter((agent) => agent.status === "complete" || agent.status === "completed")
            .map((agent) => normalizeRouteEvent(agent.emits || "")),
        );
    return waitPolicySatisfied(
      triggers,
      fired,
      target.wait_for_events.wait_for || "all",
      target.wait_for_events.quorum,
      true,
    );
  }
  if (context?.firedEvents !== undefined) {
    const fired = normalizedFiredEvents(context);
    return triggers.some((trigger) => fired.has(normalizeRouteEvent(trigger)));
  }
  return triggers.some((trigger) => {
    const normalized = normalizeRouteEvent(trigger);
    return agents.some((agent) =>
      !!agent.emits
      && normalizeRouteEvent(agent.emits) === normalized
      && (agent.status === "complete" || agent.status === "completed"),
    );
  });
}

function isFanOutBranch(value: unknown): value is {
  fan_out: string[];
  fan_in?: string;
  wait_for?: string;
  quorum?: number;
  on_error?: string;
} {
  if (!value || typeof value !== "object") return false;
  const fanOut = (value as { fan_out?: unknown }).fan_out;
  return Array.isArray(fanOut) && fanOut.every((item) => typeof item === "string");
}

function isConditionalBranch(value: unknown): value is {
  conditions: Array<{ if: string; then: string }>;
  default?: string;
} {
  if (!value || typeof value !== "object") return false;
  const branch = value as { conditions?: unknown; default?: unknown };
  return Array.isArray(branch.conditions)
    && branch.conditions.every((condition) => {
      if (!condition || typeof condition !== "object") return false;
      const item = condition as { if?: unknown; then?: unknown };
      return typeof item.if === "string" && typeof item.then === "string";
    })
    && (branch.default === undefined || typeof branch.default === "string");
}
