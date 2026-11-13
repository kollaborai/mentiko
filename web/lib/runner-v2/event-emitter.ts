import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import config from "@/lib/config";
import { requireConfiguredEventsDir } from "@/lib/runner-v2/event-lifecycle";
import { withEventSourceClaim } from "@/lib/runner-v2/event-source-claim";
import { parseRunnerEvent, serializeRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";

export type RunnerEventFilenameMode = "canonical" | "diagnostic" | "api";
export type RunnerEventScope = "run" | "ingress";

const RUN_LIFECYCLE_EVENTS = new Set([
  "chain-started",
  "chain-complete",
  "chain-error",
  "agent-started",
  "agent-complete",
  "agent-error",
  "agent-timeout",
  "agent-context-exhausted",
  "fan-in-complete",
  "fan-out-complete",
  "run-stalled",
  "run-error",
  "run-complete",
  "task-status-updated",
]);

export interface EmitRunnerEventInput {
  event: string;
  source: string;
  runId: string;
  scope: RunnerEventScope;
  data: string;
  filenameMode: RunnerEventFilenameMode;
  /** Explicit typed event root for request/run-scoped callers. */
  eventsDir?: string;
  /** Stable identity for one completion operation across process replay. */
  idempotencyKey?: string;
  /** Existing direct filename retained by compatibility producers. */
  filename?: string;
  /** Distinguishes legitimate later attempts or loop visits. */
  occurrenceId?: string;
  diagnosticAgent?: string;
  diagnosticReason?: string;
  diagnosticStaleCount?: number;
  timestamp?: string;
}

export interface EmitRunnerEventResult {
  path: string;
  filename: string;
  occurrenceId: string;
  contentSha256: string;
  record: RunnerEventRecord;
}

/**
 * The typed writer for shell-facing and smoke-agent runner event emission.
 *
 * The event root comes only from typed config. Callers provide semantic event
 * inputs; this writer owns filename construction, timestamps, serialization,
 * validation, and the atomic filesystem write.
 */
export function emitRunnerEvent(input: EmitRunnerEventInput): EmitRunnerEventResult {
  assertModeRequirements(input);

  const eventsDir = requireConfiguredEventsDir(input.eventsDir || config.eventsDir);
  const timestamp = input.timestamp ?? new Date().toISOString();
  const semanticExtensions = eventExtensionFields(input);
  const contentSha256 = eventContentSha256({
    scope: input.scope,
    event: input.event,
    source: input.source,
    runId: input.runId,
    data: input.data,
    extensionFields: semanticExtensions,
  });
  const occurrenceId = buildOccurrenceId(input, contentSha256);
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp,
    processed: false,
    data: input.data,
    extensionFields: {
      ...semanticExtensions,
      occurrence_id: occurrenceId,
      content_sha256: contentSha256,
    },
  });
  const requestedFilename = input.filename || buildRunnerEventFilename(input, timestamp);
  const logicalSource = input.filenameMode === "diagnostic"
    ? input.diagnosticAgent!
    : input.source;

  return withEventSourceClaim(eventsDir, {
    scope: input.scope,
    runId: input.runId,
    source: logicalSource,
  }, () => {
    const existing = input.idempotencyKey
      ? findIdempotentOccurrence(eventsDir, input, contentSha256)
      : undefined;
    if (existing) return existing;

    const temporaryPath = join(
      eventsDir,
      `.${basename(requestedFilename)}.${process.pid}.${randomUUID()}.tmp`,
    );
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    try {
      return persistWithoutClobber({
        eventsDir,
        requestedFilename,
        temporaryPath,
        content,
        occurrenceId,
        contentSha256,
        idempotencyKey: input.idempotencyKey,
      });
    } finally {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // The hard-link publish consumed the temporary path, or the write failed.
      }
    }
  });
}

export function diagnosticEventData(input: {
  agent: string;
  reason: string;
  staleCount?: number;
}): string {
  if (!input.agent) throw new Error("Diagnostic event agent must not be empty.");
  if (!input.reason) throw new Error("Diagnostic event reason must not be empty.");
  return JSON.stringify({
    agent: input.agent,
    reason: input.reason,
    ...(input.staleCount !== undefined ? { stale_count: input.staleCount } : {}),
  });
}

function assertModeRequirements(input: EmitRunnerEventInput): void {
  if (input.filename !== undefined
    && (basename(input.filename) !== input.filename || !input.filename.endsWith(".event"))) {
    throw new Error("Runner event filename must be a direct *.event filename.");
  }
  if (input.idempotencyKey !== undefined && !input.idempotencyKey.trim()) {
    throw new Error("Event idempotency key must not be empty.");
  }
  if (input.scope === "run" && !input.runId) {
    throw new Error("run-scoped events require a run id.");
  }
  if (input.scope === "ingress" && input.runId) {
    throw new Error("ingress events must not carry a run id.");
  }
  if (input.scope === "ingress" && RUN_LIFECYCLE_EVENTS.has(input.event)) {
    throw new Error(`run lifecycle event ${input.event} cannot use ingress scope.`);
  }
  if (input.filenameMode === "diagnostic" && input.scope !== "run") {
    throw new Error("diagnostic events require run scope.");
  }
  if (input.filenameMode === "diagnostic" && !input.diagnosticAgent) {
    throw new Error("Diagnostic events require an agent id for filename ownership.");
  }
  if (input.filenameMode === "diagnostic" && !input.diagnosticReason) {
    throw new Error("Diagnostic events require a reason.");
  }
  if (input.diagnosticStaleCount !== undefined
    && (!Number.isSafeInteger(input.diagnosticStaleCount) || input.diagnosticStaleCount < 0)) {
    throw new Error("Diagnostic stale count must be a non-negative integer.");
  }
}

function eventExtensionFields(input: EmitRunnerEventInput): Record<string, string> | undefined {
  const fields = {
    ...(input.filenameMode === "diagnostic"
      ? {
        agent: input.diagnosticAgent!,
        reason: input.diagnosticReason!,
        ...(input.diagnosticStaleCount !== undefined
          ? { stale_count: String(input.diagnosticStaleCount) }
          : {}),
      }
      : {}),
    ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
    ...(input.occurrenceId ? { completion_occurrence_id: input.occurrenceId } : {}),
  };
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function persistWithoutClobber(input: {
  eventsDir: string;
  requestedFilename: string;
  temporaryPath: string;
  content: string;
  occurrenceId: string;
  contentSha256: string;
  idempotencyKey?: string;
}): EmitRunnerEventResult {
  const requestedPath = join(input.eventsDir, input.requestedFilename);
  try {
    linkSync(input.temporaryPath, requestedPath);
    return resultFor(requestedPath, input.content);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  const existing = readExistingEvent(requestedPath);
  if (existing && isSameOccurrence(existing.record, input)) return resultFor(requestedPath, existing.content);

  for (let attempt = 0; ; attempt += 1) {
    if (input.idempotencyKey && attempt > 0) {
      throw new Error(`Event occurrence path is occupied by different content: ${requestedPath}`);
    }
    const collisionFilename = collisionSafeFilename(input.requestedFilename, input.occurrenceId, attempt > 0);
    const collisionPath = join(input.eventsDir, collisionFilename);
    try {
      linkSync(input.temporaryPath, collisionPath);
      return resultFor(collisionPath, input.content);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const collision = readExistingEvent(collisionPath);
    if (collision && isSameOccurrence(collision.record, input)) return resultFor(collisionPath, collision.content);
  }
}

function resultFor(path: string, content: string): EmitRunnerEventResult {
  const record = parseRunnerEvent(content);
  return {
    path,
    filename: basename(path),
    occurrenceId: record.fields.occurrence_id || "",
    contentSha256: record.fields.content_sha256 || "",
    record: { ...record, path },
  };
}

function findIdempotentOccurrence(
  eventsDir: string,
  input: EmitRunnerEventInput,
  contentSha256: string,
): EmitRunnerEventResult | undefined {
  for (const root of [eventsDir, join(eventsDir, "archive")]) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".event")) continue;
      const path = join(root, entry.name);
      const existing = readExistingEvent(path);
      if (!existing || !sameLogicalSource(existing.record, input)) continue;
      if (existing.record.fields.idempotency_key !== input.idempotencyKey) continue;
      if (existing.record.fields.content_sha256 === contentSha256
        || eventContentSha256FromRecord(existing.record, input.scope) === contentSha256) {
        return resultFor(path, existing.content);
      }
      throw new Error(`Event idempotency key was reused with different content: ${input.idempotencyKey}`);
    }
  }
  return undefined;
}

function readExistingEvent(path: string): { content: string; record: RunnerEventRecord } | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return undefined;
  }
  try {
    if (!fstatSync(descriptor).isFile()) return undefined;
    const content = readFileSync(descriptor, "utf8");
    return { content, record: parseRunnerEvent(content) };
  } catch {
    return undefined;
  } finally {
    closeSync(descriptor);
  }
}

function isSameOccurrence(
  event: RunnerEventRecord,
  input: { occurrenceId: string; contentSha256: string; idempotencyKey?: string },
): boolean {
  return event.fields.occurrence_id === input.occurrenceId
    && event.fields.content_sha256 === input.contentSha256
    && event.fields.idempotency_key === input.idempotencyKey;
}

function sameLogicalSource(event: RunnerEventRecord, input: EmitRunnerEventInput): boolean {
  return event.event === input.event
    && event.source === input.source
    && event.runId === input.runId;
}

function eventContentSha256(input: {
  scope: RunnerEventScope;
  event: string;
  source: string;
  runId: string;
  data: string;
  extensionFields?: Record<string, string>;
}): string {
  const extensionFields = Object.fromEntries(Object.entries(input.extensionFields || {})
    .filter(([field]) => field !== "idempotency_key")
    .sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify({
    scope: input.scope,
    event: input.event,
    source: input.source,
    runId: input.runId,
    data: input.data,
    extensionFields,
  })).digest("hex");
}

function eventContentSha256FromRecord(event: RunnerEventRecord, scope: RunnerEventScope): string {
  const extensionFields = Object.fromEntries(Object.entries(event.fields)
    .filter(([field]) => !["event", "source", "run_id", "timestamp", "processed", "data", "idempotency_key", "occurrence_id", "content_sha256"].includes(field))
    .sort(([left], [right]) => left.localeCompare(right)));
  return eventContentSha256({
    scope,
    event: event.event,
    source: event.source,
    runId: event.runId,
    data: event.data,
    extensionFields,
  });
}

function buildOccurrenceId(input: EmitRunnerEventInput, contentSha256: string): string {
  if (!input.idempotencyKey) return randomUUID();
  return createHash("sha256").update(JSON.stringify([
    input.scope,
    input.runId,
    input.source,
    input.idempotencyKey,
    contentSha256,
  ])).digest("hex");
}

function collisionSafeFilename(filename: string, occurrenceId: string, randomSuffix: boolean): string {
  const stem = filename.endsWith(".event") ? filename.slice(0, -".event".length) : filename;
  const suffix = randomSuffix ? `-${process.pid}-${randomUUID()}` : `-${occurrenceId}`;
  const preferred = `${stem}-occurrence${suffix}.event`;
  return Buffer.byteLength(preferred, "utf8") <= 255
    ? preferred
    : `event-occurrence-${occurrenceId}${randomSuffix ? `-${randomUUID()}` : ""}.event`;
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "EEXIST";
}

function buildRunnerEventFilename(input: EmitRunnerEventInput, timestamp: string): string {
  const event = filenameComponent(input.event);
  const source = filenameComponent(input.source);
  const runId = input.runId ? `${filenameComponent(input.runId)}-` : "";

  if (input.filenameMode === "diagnostic") {
    const agent = filenameComponent(input.diagnosticAgent!);
    return `${filenameTimestamp(timestamp)}-${runId}${agent}-${event}.event`;
  }
  if (input.filenameMode === "api") return `${source}-${event}.event`;
  return `${runId}${source}-${event}.event`;
}

function filenameTimestamp(timestamp: string): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

function filenameComponent(value: string): string {
  const sanitized = value
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized === "" || sanitized === "." || sanitized === ".." ? "_" : sanitized;
}
