import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";
import { orgPath } from "../config";

export type LogLevel = "error" | "warn" | "info";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  detail?: string;
}

export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info"];

/** A submission before it is trusted: shape asserted, nothing else. */
export interface SystemLogSubmission {
  level: LogLevel;
  source: string;
  message: string;
  detail?: string;
}

export type SystemLogNormalization =
  | { ok: true; submission: SystemLogSubmission }
  | { ok: false; error: string };

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Normalize a raw system-log submission from any caller. Both doors onto this
 * shape -- the HTTP route and the shell-facing CLI -- validate through here, so
 * an unrecognized level is rejected at the boundary rather than cast and
 * persisted.
 */
export function normalizeSystemLogSubmission(raw: unknown): SystemLogNormalization {
  if (!raw || typeof raw !== "object") return { ok: false, error: "submission must be an object" };
  const candidate = raw as Record<string, unknown>;

  const level = trimmedString(candidate.level);
  const source = trimmedString(candidate.source);
  const message = trimmedString(candidate.message);
  const detail = trimmedString(candidate.detail);

  if (!level || !source || !message) return { ok: false, error: "level, source, message required" };
  if (!LOG_LEVELS.includes(level as LogLevel)) {
    return { ok: false, error: `level must be one of ${LOG_LEVELS.join(", ")}` };
  }

  return { ok: true, submission: { level: level as LogLevel, source, message, ...(detail ? { detail } : {}) } };
}

function getLogPath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "logs", "system.jsonl");
}

export function writeLog(
  namespaceId: string,
  orgId: string,
  level: LogLevel,
  source: string,
  message: string,
  detail?: string
): void {
  try {
    const logPath = getLogPath(namespaceId, orgId);
    const dir = path.dirname(logPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entry: LogEntry = { ts: new Date().toISOString(), level, source, message };
    if (detail) entry.detail = detail;
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // never throw from logger
  }
}

export function readLogs(namespaceId: string, orgId: string, limit = 500): LogEntry[] {
  const logPath = getLogPath(namespaceId, orgId);
  if (!existsSync(logPath)) return [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    // return last N entries, newest first
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try { return JSON.parse(l) as LogEntry; } catch { return null; }
      })
      .filter(Boolean) as LogEntry[];
  } catch {
    return [];
  }
}
