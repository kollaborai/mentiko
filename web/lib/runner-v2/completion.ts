import {
  parseRunnerEvent,
  validateRunnerEventRecord,
  type RunnerEventRecord,
} from "@/lib/runner-v2/events";
import { runnerEventIdentityMatches } from "@/lib/runner-v2/event-identity";

export interface CompletionAgentRef {
  id: string;
  name?: string;
  emits?: string;
  sessionPrefix?: string;
}

export interface CompletionMatchInput {
  agent: CompletionAgentRef;
  runId?: string;
  events: Array<RunnerEventRecord | string>;
  // Full chain agent-id set, used only to disambiguate a source that exactly
  // names a DIFFERENT declared agent from a legitimate session-prefix match.
  allAgentIds?: string[];
}

export interface CompletionMatchResult {
  matched: boolean;
  event?: RunnerEventRecord;
  reason?: string;
}

// The retired source label remains read-only compatibility for pre-cutover diagnostics.
const DIAGNOSTIC_SOURCES = new Set(["monitor", "chain-runner-complete", "watchdog"]);

export function findCompletionEvent(input: CompletionMatchInput): CompletionMatchResult {
  const expectedEvent = normalize(input.agent.emits);
  if (!expectedEvent) {
    return { matched: false, reason: "agent has no declared emits event" };
  }

  let rejectedInvalidRecordCount = 0;
  for (const candidate of input.events) {
    let event: RunnerEventRecord;
    try {
      event = typeof candidate === "string" ? parseRunnerEvent(candidate) : candidate;
    } catch {
      rejectedInvalidRecordCount += 1;
      continue;
    }
    // Most candidates came through scanRunnerEventFiles and are already
    // validated. Keep this boundary strict for typed callers that supply a
    // hand-built record: a structurally invalid object must not become a
    // completion just because it bypassed the raw file scanner.
    if (!validateRunnerEventRecord(event).valid) {
      rejectedInvalidRecordCount += 1;
      continue;
    }
    const rejected = rejectCompletionEvent(event, input.agent, expectedEvent, input.runId, input.allAgentIds);
    if (!rejected) {
      return { matched: true, event };
    }
  }

  return {
    matched: false,
    reason: rejectedInvalidRecordCount > 0
      ? `no matching completion event; rejected ${rejectedInvalidRecordCount} invalid event record${rejectedInvalidRecordCount === 1 ? "" : "s"}`
      : "no matching completion event",
  };
}

export function rejectCompletionEvent(
  event: RunnerEventRecord,
  agent: CompletionAgentRef,
  expectedEvent: string,
  runId?: string,
  allAgentIds?: string[],
): string | null {
  if (event.processed) {
    return "event already processed";
  }
  if (runId && event.runId !== runId) {
    return "event run_id mismatch";
  }
  if (normalize(event.event) !== normalize(expectedEvent)) {
    return "event name mismatch";
  }
  if (DIAGNOSTIC_SOURCES.has(normalize(event.source))) {
    return "diagnostic source cannot complete agent";
  }
  if (!sourceMatchesAgent(event.source, agent, allAgentIds)) {
    return "event source does not match agent";
  }
  return null;
}

export function sourceMatchesAgent(
  source: string,
  agent: CompletionAgentRef,
  allAgentIds?: string[],
): boolean {
  return runnerEventIdentityMatches(
    source,
    agent.id,
    agent.sessionPrefix,
    allAgentIds,
  );
}

// Exact identity ownership. NO substring. The current agent id is exact;
// sessionName covers the paths that
// stamp source with the session id instead of the bare agent id.
export function agentOwnsEvent(
  event: RunnerEventRecord,
  agent: { id: string; sessionPrefix?: string },
  sessionName?: string,
): boolean {
  const owners = [agent.id, agent.sessionPrefix, sessionName]
    .map(normalize)
    .filter((v): v is string => Boolean(v));
  const candidates = [event.source, event.fields.agent, event.fields.source]
    .map(normalize)
    .filter((v): v is string => Boolean(v));
  return candidates.some((c) => owners.includes(c)); // EXACT equality only
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
