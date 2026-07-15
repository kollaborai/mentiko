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
  extensionFields?: Record<string, string>;
}

export type RunnerEventRawIssueCode =
  | "malformed-line"
  | "empty-key"
  | "duplicate-field"
  | "noncanonical-key"
  | "missing-field"
  | "empty-field"
  | "invalid-timestamp"
  | "invalid-processed";

export interface RunnerEventRawIssue {
  code: RunnerEventRawIssueCode;
  message: string;
  field?: string;
  line?: number;
}

export interface RunnerEventRawValidation {
  valid: boolean;
  fields: Record<string, string>;
  issues: RunnerEventRawIssue[];
}

export type RunnerEventRecordIssueCode =
  | "invalid-record"
  | "invalid-field-type"
  | "empty-field"
  | "invalid-timestamp"
  | "invalid-processed"
  | "field-mismatch";

export interface RunnerEventRecordIssue {
  code: RunnerEventRecordIssueCode;
  message: string;
  field?: string;
}

export interface RunnerEventRecordValidation {
  valid: boolean;
  issues: RunnerEventRecordIssue[];
}

export const RUNNER_EVENT_RAW_FIELDS = [
  "event",
  "source",
  "run_id",
  "timestamp",
  "processed",
  "data",
] as const;

export interface RunnerEventTrigger {
  event?: string;
  source_chain?: string;
  enabled?: boolean;
  condition?: string;
  pass_data?: boolean;
  [key: string]: unknown;
}

export function parseRunnerEvent(content: string): RunnerEventRecord {
  const raw = validateRawRunnerEvent(content);
  if (!raw.valid) {
    const summary = raw.issues.map((issue) => issue.code).join(", ");
    throw new Error(`Invalid runner event file: ${summary}`);
  }

  const record: RunnerEventRecord = {
    event: raw.fields.event,
    source: raw.fields.source,
    runId: raw.fields.run_id,
    timestamp: raw.fields.timestamp,
    processed: parseProcessed(raw.fields.processed),
    data: raw.fields.data,
    fields: raw.fields,
  };
  const normalized = validateRunnerEventRecord(record);
  if (!normalized.valid) {
    const summary = normalized.issues.map((issue) => issue.code).join(", ");
    throw new Error(`Invalid normalized runner event: ${summary}`);
  }
  return record;
}

/**
 * Validates the physical line-oriented file before normalization maps field
 * names and types. Unknown extension fields are allowed, but canonical
 * fields must be present exactly once and carry usable values where required.
 */
export function validateRawRunnerEvent(content: string): RunnerEventRawValidation {
  const fields: Record<string, string> = {};
  const issues: RunnerEventRawIssue[] = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 0) {
      issues.push({
        code: "malformed-line",
        line: index + 1,
        message: "Non-empty lines must use key: value syntax.",
      });
      continue;
    }

    const rawKey = line.slice(0, separator).trim();
    const key = rawKey.toLowerCase();
    if (!key) {
      issues.push({ code: "empty-key", line: index + 1, message: "Field name is empty." });
      continue;
    }
    if (rawKey !== key) {
      issues.push({
        code: "noncanonical-key",
        field: key,
        line: index + 1,
        message: `Field ${key} must use lowercase canonical casing.`,
      });
    }
    if (fields[key] !== undefined) {
      issues.push({
        code: "duplicate-field",
        field: key,
        line: index + 1,
        message: `Field ${key} appears more than once.`,
      });
      continue;
    }
    fields[key] = line.slice(separator + 1).trim();
  }

  for (const field of RUNNER_EVENT_RAW_FIELDS) {
    if (fields[field] === undefined) {
      issues.push({ code: "missing-field", field, message: `Missing required field ${field}.` });
    }
  }

  for (const field of ["event", "source", "timestamp"] as const) {
    if (fields[field] !== undefined && fields[field] === "") {
      issues.push({ code: "empty-field", field, message: `Field ${field} must not be empty.` });
    }
  }

  if (fields.timestamp && !Number.isFinite(new Date(fields.timestamp).getTime())) {
    issues.push({
      code: "invalid-timestamp",
      field: "timestamp",
      message: "Field timestamp must be a parseable date-time.",
    });
  }

  if (fields.processed !== undefined && !/^(?:true|false)$/.test(fields.processed)) {
    issues.push({
      code: "invalid-processed",
      field: "processed",
      message: "Field processed must be true or false.",
    });
  }

  return { valid: issues.length === 0, fields, issues };
}

/**
 * Validates the normalized TypeScript record independently from the physical
 * line contract. This catches drift in hand-built records and keeps the raw
 * parser contract distinct from the normalized Data Shapes contract.
 */
export function validateRunnerEventRecord(value: unknown): RunnerEventRecordValidation {
  const issues: RunnerEventRecordIssue[] = [];
  if (!isPlainRecord(value)) {
    return {
      valid: false,
      issues: [{ code: "invalid-record", message: "Runner event must be an object." }],
    };
  }

  for (const field of ["event", "source", "runId", "timestamp", "data"] as const) {
    if (typeof value[field] !== "string") {
      issues.push({
        code: "invalid-field-type",
        field,
        message: `Normalized field ${field} must be a string.`,
      });
    }
  }
  for (const field of ["event", "source", "timestamp"] as const) {
    if (typeof value[field] === "string" && value[field] === "") {
      issues.push({ code: "empty-field", field, message: `Normalized field ${field} must not be empty.` });
    }
  }
  if (typeof value.timestamp === "string" && !Number.isFinite(new Date(value.timestamp).getTime())) {
    issues.push({
      code: "invalid-timestamp",
      field: "timestamp",
      message: "Normalized field timestamp must be a parseable date-time.",
    });
  }
  if (typeof value.processed !== "boolean") {
    issues.push({
      code: "invalid-processed",
      field: "processed",
      message: "Normalized field processed must be a boolean.",
    });
  }
  if (value.path !== undefined && typeof value.path !== "string") {
    issues.push({
      code: "invalid-field-type",
      field: "path",
      message: "Normalized field path must be a string when present.",
    });
  }

  if (!isStringRecord(value.fields)) {
    issues.push({
      code: "invalid-field-type",
      field: "fields",
      message: "Normalized field fields must map strings to strings.",
    });
  } else {
    const expectedFields: Array<[string, unknown]> = [
      ["event", value.event],
      ["source", value.source],
      ["run_id", value.runId],
      ["timestamp", value.timestamp],
      ["processed", typeof value.processed === "boolean" ? String(value.processed) : undefined],
      ["data", value.data],
    ];
    for (const [field, expected] of expectedFields) {
      if (typeof expected === "string" && value.fields[field] !== expected) {
        issues.push({
          code: "field-mismatch",
          field: `fields.${field}`,
          message: `Normalized field fields.${field} must match ${field === "run_id" ? "runId" : field}.`,
        });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

export function serializeRunnerEvent(event: RunnerEventInput): string {
  const runId = event.runId ?? "";
  const data = event.data ?? "";
  assertSerializableField("event", event.event, false);
  assertSerializableField("source", event.source, false);
  assertSerializableField("run_id", runId, true);
  assertSerializableField("timestamp", event.timestamp, false);
  assertSerializableField("data", data, true);
  if (!Number.isFinite(new Date(event.timestamp).getTime())) {
    throw new Error("Cannot serialize runner event: timestamp must be a parseable date-time.");
  }
  if (event.processed !== undefined && typeof event.processed !== "boolean") {
    throw new Error("Cannot serialize runner event: processed must be a boolean.");
  }

  const extensionLines = serializeExtensionFields(event.extensionFields);
  const content = [
    `event: ${event.event}`,
    `source: ${event.source}`,
    `run_id: ${runId}`,
    `timestamp: ${event.timestamp}`,
    `processed: ${event.processed === true ? "true" : "false"}`,
    `data: ${data}`,
    ...extensionLines,
  ].join("\n") + "\n";
  const validation = validateRawRunnerEvent(content);
  if (!validation.valid) {
    throw new Error(`Cannot serialize runner event: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }
  const roundTrip = parseRunnerEvent(content);
  const expected = {
    event: event.event,
    source: event.source,
    runId,
    timestamp: event.timestamp,
    processed: event.processed === true,
    data,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (roundTrip[field as keyof typeof expected] !== value) {
      throw new Error(`Cannot serialize runner event: ${field} does not round-trip exactly.`);
    }
  }
  return content;
}

function serializeExtensionFields(fields: Record<string, string> | undefined): string[] {
  if (!fields) return [];
  return Object.entries(fields).map(([field, value]) => {
    if (!/^[a-z][a-z0-9_]*$/.test(field)) {
      throw new Error(`Cannot serialize runner event: extension field ${field} must use lowercase snake_case.`);
    }
    if ((RUNNER_EVENT_RAW_FIELDS as readonly string[]).includes(field)) {
      throw new Error(`Cannot serialize runner event: extension field ${field} duplicates a canonical field.`);
    }
    assertSerializableField(field, value, true);
    return `${field}: ${value}`;
  });
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
  return value === "true";
}

function assertSerializableField(field: string, value: unknown, allowEmpty: boolean): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Cannot serialize runner event: ${field} must be a string.`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new Error(`Cannot serialize runner event: ${field} must not be empty.`);
  }
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Cannot serialize runner event: ${field} must be a single line.`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
