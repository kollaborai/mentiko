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
    const event = typeof candidate === "string" ? parseRunnerEvent(candidate) : candidate;
    const rejected = rejectCompletionEvent(event, input.agent, expectedEvent, input.runId);
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
  if (!sourceMatchesAgent(event.source, agent)) {
    return "event source does not match agent";
  }
  return null;
}

export function sourceMatchesAgent(source: string, agent: CompletionAgentRef): boolean {
  const normalizedSource = normalize(source);
  if (!normalizedSource) {
    return false;
  }

  const candidates = [agent.id, agent.sessionPrefix]
    .map((value) => normalize(value))
    .filter((value): value is string => Boolean(value));

  return candidates.some((candidate) => normalizedSource.includes(candidate));
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
