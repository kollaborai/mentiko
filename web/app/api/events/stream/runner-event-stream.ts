import {
  parseRunnerEvent,
  type RunnerEventRecord,
} from "@/lib/runner-v2/events";

export interface RunnerEventStreamFile {
  filename: string;
  event: string;
  source: string;
  runId: string;
  timestamp: string;
  processed: boolean;
  data: string;
}

export function runnerEventStreamType(event: RunnerEventRecord): "chain_complete" | null {
  return event.event === "chain-complete" ? "chain_complete" : null;
}

export function runnerEventBelongsToStream(event: RunnerEventStreamFile, runId: string): boolean {
  return event.runId === runId;
}

export function parseRunnerEventStreamFile(
  filename: string,
  content: string,
): { event: RunnerEventStreamFile; lifecycleType: "chain_complete" | null } {
  const parsed = parseRunnerEvent(content);
  return {
    event: {
      filename,
      event: parsed.event,
      source: parsed.source,
      runId: parsed.runId,
      timestamp: parsed.timestamp,
      processed: parsed.processed,
      data: parsed.data,
    },
    lifecycleType: runnerEventStreamType(parsed),
  };
}
