import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import config from "@/lib/config";
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

  const timestamp = input.timestamp ?? new Date().toISOString();
  const content = serializeRunnerEvent({
    event: input.event,
    source: input.source,
    runId: input.runId,
    timestamp,
    processed: false,
    data: input.data,
    extensionFields: diagnosticExtensionFields(input),
  });
  const requestedFilename = buildRunnerEventFilename(input, timestamp);
  const temporaryPath = join(
    config.eventsDir,
    `.${basename(requestedFilename)}.${process.pid}.${randomUUID()}.tmp`,
  );

  mkdirSync(config.eventsDir, { recursive: true });
  writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
  try {
    return persistWithoutClobber({ requestedFilename, temporaryPath, content });
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

function diagnosticExtensionFields(input: EmitRunnerEventInput): Record<string, string> | undefined {
  if (input.filenameMode !== "diagnostic") return undefined;
  return {
    agent: input.diagnosticAgent!,
    reason: input.diagnosticReason!,
    ...(input.diagnosticStaleCount !== undefined
      ? { stale_count: String(input.diagnosticStaleCount) }
      : {}),
  };
}

function persistWithoutClobber(input: {
  requestedFilename: string;
  temporaryPath: string;
  content: string;
}): EmitRunnerEventResult {
  const requestedPath = join(config.eventsDir, input.requestedFilename);
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

  for (;;) {
    const collisionFilename = collisionSafeFilename(input.requestedFilename);
    const collisionPath = join(config.eventsDir, collisionFilename);
    try {
      linkSync(input.temporaryPath, collisionPath);
      return resultFor(collisionPath, collisionFilename, input.content);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
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

function collisionSafeFilename(filename: string): string {
  const stem = filename.endsWith(".event") ? filename.slice(0, -".event".length) : filename;
  return `${stem}-collision-${process.pid}-${randomUUID()}.event`;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
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
