export interface RoutingAgent {
  id: string;
  emits?: string;
  triggers?: string[];
  status?: string;
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
  | { action: "wait"; reason: string };

const ACTIVE_OR_DONE = new Set(["running", "complete", "completed"]);

export function decideNextRoute(chain: RoutingChain, eventName: string): RoutingDecision {
  const branch = findBranch(chain.branches, eventName);
  if (branch !== undefined) {
    return decisionFromBranch(branch, chain.agents, eventName);
  }

  const triggerMatches = chain.agents
    .filter((agent) => triggerListMatches(agent.triggers || [], eventName))
    .map((agent) => agent.id);

  return decisionFromTargets(triggerMatches, chain.agents, "trigger match");
}

export function normalizeRouteEvent(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+(round|revision|rev)[-_\s]*\d+$/i, "")
    .replace(/\s+/g, "-");
}

function decisionFromBranch(branch: unknown, agents: RoutingAgent[], eventName: string): RoutingDecision {
  if (typeof branch === "string") {
    if (branch === "stop") {
      return { action: "stop", reason: "explicit stop branch" };
    }
    return decisionFromTargets([branch], agents, "branch match");
  }

  if (Array.isArray(branch)) {
    return decisionFromTargets(branch.filter((value): value is string => typeof value === "string"), agents, "branch fan-out");
  }

  if (isFanOutBranch(branch)) {
    const decision = decisionFromTargets(branch.fan_out, agents, "branch fan-out");
    if (decision.action !== "launch") return decision;
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
    return target ? decisionFromTargets([target], agents, "branch condition") : { action: "wait", reason: "no conditional branch matched" };
  }

  return { action: "wait", reason: "unsupported branch shape" };
}

function decisionFromTargets(targets: string[], agents: RoutingAgent[], reason: string): RoutingDecision {
  const runnable = targets.filter((target) => {
    const agent = agents.find((candidate) => candidate.id === target);
    return agent && !ACTIVE_OR_DONE.has(agent.status || "") && prerequisitesComplete(agent, agents);
  });

  if (runnable.length === 0) {
    return { action: "wait", reason: targets.length > 0 ? "targets already active or complete" : "no downstream target" };
  }

  return { action: "launch", agentIds: Array.from(new Set(runnable)), reason };
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

function prerequisitesComplete(target: RoutingAgent, agents: RoutingAgent[]): boolean {
  const triggers = target.triggers || [];
  if (triggers.length <= 1) return true;
  return triggers.every((trigger) => {
    const emitters = agents.filter((agent) => normalizeRouteEvent(agent.emits || "") === normalizeRouteEvent(trigger));
    return emitters.length === 0 || emitters.some((agent) => agent.status === "complete" || agent.status === "completed");
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
