import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import config from "@/lib/config";
import { requireConfiguredEventsDir } from "@/lib/runner-v2/event-lifecycle";
import { parseRunnerEvent, serializeRunnerEvent, type RunnerEventRecord } from "@/lib/runner-v2/events";

export type RunnerEventFilenameMode = "canonical" | "diagnostic";
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
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp,
    processed: false,
    data: input.data,
    extensionFields: eventExtensionFields(input),
  });
  const requestedFilename = buildRunnerEventFilename(input, timestamp);
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
      idempotencyKey: input.idempotencyKey,
    });
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The hard-link claim may already have consumed cleanup in another branch.
    }
  }
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
  idempotencyKey?: string;
}): EmitRunnerEventResult {
  const requestedPath = join(input.eventsDir, input.requestedFilename);
  try {
    linkSync(input.temporaryPath, requestedPath);
    return resultFor(requestedPath, input.requestedFilename, input.content);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  const existingContent = readFileSync(requestedPath, "utf8");
  if (eventsAreSemanticallyIdentical(existingContent, input.content)) {
    return resultFor(requestedPath, input.requestedFilename, existingContent);
  }

  for (let attempt = 0;; attempt += 1) {
    const collisionFilename = collisionSafeFilename(
      input.requestedFilename,
      attempt === 0 ? input.idempotencyKey : undefined,
    );
    const collisionPath = join(input.eventsDir, collisionFilename);
    try {
      linkSync(input.temporaryPath, collisionPath);
      return resultFor(collisionPath, collisionFilename, input.content);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const collisionContent = readFileSync(collisionPath, "utf8");
    if (eventsAreSemanticallyIdentical(collisionContent, input.content)) {
      return resultFor(collisionPath, collisionFilename, collisionContent);
    }
  }
}

function resultFor(path: string, filename: string, content: string): EmitRunnerEventResult {
  return {
    path,
    filename,
    record: { ...parseRunnerEvent(content), path },
  };
}

function eventsAreSemanticallyIdentical(left: string, right: string): boolean {
  try {
    const leftEvent = parseRunnerEvent(left);
    const rightEvent = parseRunnerEvent(right);
    return semanticEventFields(leftEvent) === semanticEventFields(rightEvent);
  } catch {
    return false;
  }
}

function semanticEventFields(event: RunnerEventRecord): string {
  return JSON.stringify(Object.entries(event.fields)
    .filter(([field]) => field !== "timestamp")
    .sort(([left], [right]) => left.localeCompare(right)));
}

function collisionSafeFilename(filename: string, idempotencyKey?: string): string {
  const stem = filename.endsWith(".event") ? filename.slice(0, -".event".length) : filename;
  if (idempotencyKey) {
    const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20);
    return `${stem}-occurrence-${digest}.event`;
  }
  return `${stem}-collision-${process.pid}-${randomUUID()}.event`;
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
