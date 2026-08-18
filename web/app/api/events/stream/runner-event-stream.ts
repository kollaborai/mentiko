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

/**
 * A runner agent .state record belongs to a stream when its durable session key
 * carries the stream's runId. stateDir is the shared execution root (every org's
 * agents), so the SSE watcher must scope broadcasts through this. Matches the
 * session-includes-runId filter in readRunnerAgentStateDirectory.
 */
export function runnerStateBelongsToStream(state: { session: string }, runId: string): boolean {
  return state.session.includes(runId);
}

/**
 * A job belongs to a stream when it IS the subscribed job (job-id mode) or is
 * owned by the subscribed run (run-id mode). jobsDir is shared across orgs.
 */
export function jobBelongsToStream(jobId: string, job: { runId?: string }, runId: string): boolean {
  return jobId === runId || job.runId === runId;
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
