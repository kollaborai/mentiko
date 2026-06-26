export interface RunnerEventRecord {
  event: string;
  source: string;
  runId: string;
  timestamp: string;
  processed: boolean;
  data: string;
  fields: Record<string, string>;
  path?: string;
}

export interface RunnerEventInput {
  event: string;
  source: string;
  runId?: string;
  timestamp: string;
  processed?: boolean;
  data?: string;
}

export interface RunnerEventTrigger {
  event?: string;
  source_chain?: string;
  enabled?: boolean;
  condition?: string;
  pass_data?: boolean;
  [key: string]: unknown;
}

export function parseRunnerEvent(content: string): RunnerEventRecord {
  const fields: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    if (!key || fields[key] !== undefined) {
      continue;
    }

    fields[key] = line.slice(separator + 1).trim();
  }

  return {
    event: fields.event ?? "",
    source: fields.source ?? fields.agent ?? "",
    runId: fields.run_id ?? fields.runid ?? "",
    timestamp: fields.timestamp ?? "",
    processed: parseProcessed(fields.processed),
    data: fields.data ?? "",
    fields,
  };
}

export function serializeRunnerEvent(event: RunnerEventInput): string {
  return [
    `event: ${event.event}`,
    `source: ${event.source}`,
    `run_id: ${event.runId ?? ""}`,
    `timestamp: ${event.timestamp}`,
    `processed: ${event.processed === true ? "true" : "false"}`,
    `data: ${event.data ?? ""}`,
  ].join("\n") + "\n";
}

export function eventMatchesRunId(event: RunnerEventRecord, runId?: string): boolean {
  if (!runId) {
    return true;
  }
  return event.runId === runId;
}

export function isUnprocessedRunnerEvent(event: RunnerEventRecord): boolean {
  return !event.processed;
}

export function filterEnabledEventTriggers<T extends RunnerEventTrigger>(triggers: T[]): T[] {
  return triggers.filter((trigger) => trigger.enabled !== false);
}

export function eventMatchesTrigger(
  event: RunnerEventRecord,
  trigger: RunnerEventTrigger,
): boolean {
  if (trigger.enabled === false) {
    return false;
  }
  if (!trigger.event || trigger.event !== event.event) {
    return false;
  }
  if (trigger.source_chain && trigger.source_chain !== event.source) {
    return false;
  }
  return true;
}

function parseProcessed(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}
