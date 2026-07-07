// Diagnostic surfacing for the typed chain monitor: "stale != complete, dead !=
// succeeded". Ports monitor-agent-stalled (agent-functions.sh:589) and
// monitor-agent-died (:626). A stalled or dead-without-event agent is surfaced as
// a DIAGNOSTIC event whose source is "monitor" (never the agent id) so the
// completion matcher can never mistake it for a success handoff, plus a
// non-success run status. Death is EVENT-FIRST: a process that already emitted
// its declared event finished and merely exited.

export type MonitorDiagnosticKind = "agent-timeout" | "agent-error";

// ALWAYS "monitor" — never the agent id. The completion matcher accepts an event
// only when its source contains the agent id, so a "monitor"-sourced event can
// never route forward as a success handoff. This is the finding #1/#2 invariant.
export const MONITOR_DIAGNOSTIC_SOURCE = "monitor" as const;

export interface MonitorDiagnosticEvent {
  event: MonitorDiagnosticKind;
  source: typeof MONITOR_DIAGNOSTIC_SOURCE;
  runId: string;
  agent: string;
  reason: string;
  staleCount?: number;
  processed: false;
  // Own filename scheme (ts-runId-agentId-kind.event), deliberately NOT the
  // canonical handoff naming (runId-source-event.event), so it is never picked up
  // as a completion handoff by filename either.
  filename: string;
}

export function buildMonitorDiagnosticEvent(input: {
  kind: MonitorDiagnosticKind;
  runId: string;
  agentId: string;
  reason: string;
  staleCount?: number;
  timestamp: string; // caller supplies; no clock reads in here
}): MonitorDiagnosticEvent {
  const agent = input.agentId || "unknown";
  const event: MonitorDiagnosticEvent = {
    event: input.kind,
    source: MONITOR_DIAGNOSTIC_SOURCE,
    runId: input.runId,
    agent,
    reason: input.reason,
    processed: false,
    filename: `${input.timestamp}-${input.runId}-${agent}-${input.kind}.event`,
  };
  if (input.kind === "agent-timeout" && typeof input.staleCount === "number") {
    event.staleCount = input.staleCount;
  }
  return event;
}

// Stall: an alive-but-quiescent agent is BLOCKED (uncertain — the md5 heuristic
// is blind to spinner redraws), never failed and never complete. Lets the
// watchdog/reconciler/human take over while nothing routes forward as success.
export interface StalledVerdict {
  runStatus: "blocked";
  agentStatus: "blocked";
  diagnostic: MonitorDiagnosticEvent;
}

export function classifyStall(input: {
  runId: string;
  agentId: string;
  reason: string;
  staleCount: number;
  timestamp: string;
}): StalledVerdict {
  return {
    runStatus: "blocked",
    agentStatus: "blocked",
    diagnostic: buildMonitorDiagnosticEvent({ kind: "agent-timeout", ...input }),
  };
}

// Death is EVENT-FIRST: if the declared event already exists, the agent finished
// and the process merely exited -> complete normally (NOT a fabrication).
// Otherwise it died without its handoff -> FAILED, never a fabricated success.
export type DeathVerdict =
  | { outcome: "complete-normally" }
  | {
      outcome: "failed";
      runStatus: "failed";
      agentStatus: "failed";
      diagnostic: MonitorDiagnosticEvent;
    };

export function classifyDeath(input: {
  hasCompletionEvent: boolean;
  runId: string;
  agentId: string;
  reason: string;
  timestamp: string;
}): DeathVerdict {
  if (input.hasCompletionEvent) {
    return { outcome: "complete-normally" };
  }
  return {
    outcome: "failed",
    runStatus: "failed",
    agentStatus: "failed",
    diagnostic: buildMonitorDiagnosticEvent({
      kind: "agent-error",
      runId: input.runId,
      agentId: input.agentId,
      reason: input.reason,
      timestamp: input.timestamp,
    }),
  };
}
