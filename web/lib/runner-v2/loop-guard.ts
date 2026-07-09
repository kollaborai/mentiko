import { normalizeRouteEvent, type RoutingChain, type RoutingDecision } from "@/lib/runner-v2/routing";

export interface LoopGuardInput {
  currentAgentId: string;
  eventName?: string;
  nextAgentIds: string[];
  chain: RoutingChain;
  routeKind?: "single" | "parallel" | "fan-out";
  visited?: string[];
  currentRound?: number;
  maxRounds?: number;
}

export type LoopGuardDecision =
  | { action: "complete"; reason: "visited-agent-event"; visitKey: string; runStatus: "completed"; taskStatus: "completed" }
  | { action: "stop"; reason: "max-rounds-exceeded"; visitKey: string; round: number; maxRounds: number; runStatus: "stopped"; taskStatus: "stopped" }
  | { action: "continue"; visitKey: string; round: number; recordVisit: boolean };

export function applyLoopGuardToRoute(input: LoopGuardInput): LoopGuardDecision {
  const eventName = input.eventName || "none";
  // note: visitKey intentionally stays keyed on the raw event name (not
  // normalizeRouteEvent) — normalizing it risks prematurely completing
  // legitimate multi-round loops that reuse the same base event per round.
  const visitKey = `${input.currentAgentId}:${eventName}`;

  if ((input.visited || []).includes(visitKey)) {
    return {
      action: "complete",
      reason: "visited-agent-event",
      visitKey,
      runStatus: "completed",
      taskStatus: "completed",
    };
  }

  const currentRound = normalizePositiveInteger(input.currentRound, 1);
  const nextRound = shouldIncrementRound(input)
    ? currentRound + 1
    : currentRound;
  const maxRounds = normalizePositiveInteger(input.maxRounds, 3);

  if (nextRound > maxRounds) {
    return {
      action: "stop",
      reason: "max-rounds-exceeded",
      visitKey,
      round: nextRound,
      maxRounds,
      runStatus: "stopped",
      taskStatus: "stopped",
    };
  }

  return {
    action: "continue",
    visitKey,
    round: nextRound,
    recordVisit: true,
  };
}

export function routeAgentIds(decision: RoutingDecision): string[] {
  return decision.action === "launch" ? decision.agentIds : [];
}

function shouldIncrementRound(input: LoopGuardInput): boolean {
  if (input.routeKind && input.routeKind !== "single") {
    return false;
  }
  if (input.nextAgentIds.includes(input.currentAgentId)) {
    return true;
  }

  const currentAgent = input.chain.agents.find((agent) => agent.id === input.currentAgentId);
  const eventName = input.eventName;
  if (!eventName) {
    return false;
  }
  // routing.ts matches triggers via normalizeRouteEvent (strips
  // -round-N/-revision-N suffixes, lowercases). A round-suffixed cyclic event
  // (e.g. "content-ready-round-2") must be matched the same way here, or a
  // routed loop silently bypasses the maxRounds guard below.
  return Boolean(currentAgent?.triggers?.some((trigger) => normalizeRouteEvent(trigger) === normalizeRouteEvent(eventName)));
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
