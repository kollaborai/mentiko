import { parseRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";

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

const DIAGNOSTIC_SOURCES = new Set(["monitor", "chain-runner-complete", "watchdog"]);

export function findCompletionEvent(input: CompletionMatchInput): CompletionMatchResult {
  const expectedEvent = normalize(input.agent.emits);
  if (!expectedEvent) {
    return { matched: false, reason: "agent has no declared emits event" };
  }

  for (const candidate of input.events) {
    let event: RunnerEventRecord;
    try {
      event = typeof candidate === "string" ? parseRunnerEvent(candidate) : candidate;
    } catch {
      continue;
    }
    const rejected = rejectCompletionEvent(event, input.agent, expectedEvent, input.runId, input.allAgentIds);
    if (!rejected) {
      return { matched: true, event };
    }
  }

  return { matched: false, reason: "no matching completion event" };
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
  const normalizedSource = normalize(source);
  if (!normalizedSource) {
    return false;
  }

  const candidates = [agent.id, agent.sessionPrefix]
    .map((value) => normalize(value))
    .filter((value): value is string => Boolean(value));

  // exact identity always wins.
  if (candidates.includes(normalizedSource)) {
    return true;
  }

  // Prefix match mirrors the shell's _event-belongs-to (lib/event-trigger.sh
  // L181-188, documented as intentional): a session-suffixed source like
  // "researcher-7f3a" must still be owned by bare agent id "researcher".
  // Guarded against the sibling-id collision this creates (owner "api"
  // wrongly claiming "api-reviewer" or "api-reviewer-run-123" -- structurally
  // identical to the legitimate session-suffix case): when the full chain
  // agent-id set is known, a source that names a DIFFERENT declared agent, with
  // or without that agent's session suffix, is never claimed via prefix match.
  // Callers that cannot supply allAgentIds keep the shell-parity substring
  // behavior unguarded.
  const namesAnotherAgent = allAgentIds?.some((id) => {
    const normalizedId = normalize(id);
    return normalizedId !== ""
      && !candidates.includes(normalizedId)
      && (normalizedSource === normalizedId || normalizedSource.startsWith(`${normalizedId}-`));
  });
  if (namesAnotherAgent) {
    return false;
  }

  return candidates.some((candidate) => normalizedSource.includes(candidate));
}

// Exact identity ownership. NO substring. Mirrors shell _event-belongs-to /
// archive-run-events (CURRENT_AGENT_ID exact). sessionName covers the paths that
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
