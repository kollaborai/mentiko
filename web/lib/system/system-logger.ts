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
