export interface RoutingAgent {
  id: string;
  emits?: string;
  triggers?: string[];
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

export function decideNextRoute(chain: RoutingChain, eventName: string, eventTimestamp?: string): RoutingDecision {
  const branch = findBranch(chain.branches, eventName);
  if (branch !== undefined) {
    return decisionFromBranch(branch, chain.agents, eventName, eventTimestamp);
  }

  const triggerMatches = chain.agents
    .filter((agent) => triggerListMatches(agent.triggers || [], eventName))
    .map((agent) => agent.id);

  return decisionFromTargets(triggerMatches, chain.agents, "trigger match", eventTimestamp);
}

export function normalizeRouteEvent(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+(round|revision|rev)[-_\s]*\d+$/i, "")
    .replace(/\s+/g, "-");
}

function decisionFromBranch(branch: unknown, agents: RoutingAgent[], eventName: string, eventTimestamp?: string): RoutingDecision {
  if (typeof branch === "string") {
    if (branch === "stop") {
      return { action: "stop", reason: "explicit stop branch" };
    }
    return decisionFromTargets([branch], agents, "branch match", eventTimestamp);
  }

  if (Array.isArray(branch)) {
    return decisionFromTargets(branch.filter((value): value is string => typeof value === "string"), agents, "branch fan-out", eventTimestamp);
  }

  if (isFanOutBranch(branch)) {
    const decision = decisionFromTargets(branch.fan_out, agents, "branch fan-out", eventTimestamp);
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
    return target ? decisionFromTargets([target], agents, "branch condition", eventTimestamp) : { action: "wait", reason: "no conditional branch matched" };
  }

  return { action: "wait", reason: "unsupported branch shape" };
}

function decisionFromTargets(targets: string[], agents: RoutingAgent[], reason: string, eventTimestamp?: string): RoutingDecision {
  const runnable = targets.filter((target) => {
    const agent = agents.find((candidate) => candidate.id === target);
    return agent && !agentIsActiveOrDoneForOccurrence(agent, eventTimestamp) && prerequisitesComplete(agent, agents);
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

// NOTE (2026-07-12): multi-trigger MERGE semantics are only half-solved here.
// `.every()` treats multiple triggers as AND (all upstream must complete) — correct
// for a parallel fan-in, but it deadlocks an OR-merge of MUTUALLY-EXCLUSIVE branches
// (e.g. a "diamond": investigator routes to remover OR repointer, then a verifier
// joins on either fix's event — only one sibling ever runs, so AND can never be
// satisfied). Fixing that correctly needs the set of events that ACTUALLY fired
// (a brancher's static `emits` is one of several conditional runtime events, so
// static-emits reachability guesses wrong on the untaken branch), which is not
// available at this call site. `completion-entrypoint` hydrates agent status and
// latest attempt time, but no persisted actually-fired event set is passed into
// decideNextRoute at completion-runner/recovery/reconcile.
function prerequisitesComplete(target: RoutingAgent, agents: RoutingAgent[]): boolean {
  const triggers = target.triggers || [];
  if (triggers.length <= 1) return true;
  return triggers.every((trigger) => {
    const emitters = agents.filter((agent) => normalizeRouteEvent(agent.emits || "") === normalizeRouteEvent(trigger));
    return emitters.length === 0 || emitters.some((agent) => agent.status === "complete" || agent.status === "completed");
  });
}

// Does this agent have a trigger already produced by a COMPLETED in-chain emitter?
// Used by run resume to pick the true frontier (a trigger-eligible agent) instead of
// the first pending agent by array order. The caller MUST hydrate agent statuses from
// run.json (the resume route does). Correct for merge triggers whose direct emitter
// has a single unambiguous `emits`; a chain whose upstream emits a *conditional*
// (branch-key) event differing from its static `emits` needs the actually-fired event
// set instead — same gap as prerequisitesComplete above.
export function hasCompletedTrigger(target: RoutingAgent, agents: RoutingAgent[]): boolean {
  const triggers = target.triggers || [];
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
