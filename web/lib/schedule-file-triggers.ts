import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import type { Schedule } from "./types";
import type { ScheduleTriggerPayload } from "./schedule-targets";

export interface FileSnapshot {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface FileTriggerStateEntry {
  lastSeenAtMs: number;
  lastProcessedSignature?: string;
}

export type FileTriggerState = Record<string, Record<string, FileTriggerStateEntry>>;

export interface FileTriggerEvent {
  schedule: Schedule;
  payload: ScheduleTriggerPayload;
}

interface ScanOptions {
  maxDepth?: number;
  maxFiles?: number;
}

const DEFAULT_MAX_SCAN_DEPTH = 8;
const DEFAULT_MAX_SCAN_FILES = 1000;
const PROTECTED_ROOTS = [
  "/",
  "/etc",
  "/System",
  "/Library",
  "/private/etc",
  "/var/db",
  "/var/root",
  homedir(),
];

export function collectFileTriggerEvents({
  schedule,
  files,
  state,
  nowMs,
}: {
  schedule: Schedule;
  files: FileSnapshot[];
  state: FileTriggerState;
  nowMs: number;
}): { events: FileTriggerEvent[]; state: FileTriggerState } {
  const trigger = schedule.trigger;
  if (!trigger || trigger.type !== "file") return { events: [], state };

  const nextState: FileTriggerState = {
    ...state,
    [schedule.id]: { ...(state[schedule.id] || {}) },
  };
  const scheduleState = nextState[schedule.id];
  const stableForMs = trigger.stableForMs ?? 5000;
  const events: FileTriggerEvent[] = [];

  for (const file of files) {
    const rel = relativeForGlob(trigger.directory, file.path);
    if (!matchesScheduleGlob(rel, trigger.glob)) continue;

    const signature = `${file.mtimeMs}:${file.size}`;
    const entry = scheduleState[file.path] || { lastSeenAtMs: nowMs };
    scheduleState[file.path] = entry;

    if (nowMs - file.mtimeMs < stableForMs) continue;
    if (entry.lastProcessedSignature === signature) continue;

    entry.lastProcessedSignature = signature;
    entry.lastSeenAtMs = nowMs;
    events.push({
      schedule,
      payload: {
        triggeredAt: new Date(nowMs).toISOString(),
        file: {
          path: file.path,
          name: path.basename(file.path),
          directory: path.dirname(file.path),
          extension: path.extname(file.path),
        },
      },
    });
  }

  return { events, state: nextState };
}

export function scanFileTriggerDirectory(
  directory: string,
  glob: string,
  { maxDepth = DEFAULT_MAX_SCAN_DEPTH, maxFiles = DEFAULT_MAX_SCAN_FILES }: ScanOptions = {},
): FileSnapshot[] {
  if (!isAllowedScanDirectory(directory)) return [];
  const recursive = glob.includes("/") || glob.includes("**");
  const files: FileSnapshot[] = [];

  function scan(dir: string, depth: number) {
    if (depth > maxDepth || files.length >= maxFiles) return;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= maxFiles) return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) scan(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(fullPath);
      files.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }

  scan(path.resolve(directory), 0);
  return files;
}

function isAllowedScanDirectory(directory: string): boolean {
  if (!path.isAbsolute(directory) || !existsSync(directory)) return false;
  const resolved = path.resolve(directory);
  return !PROTECTED_ROOTS.some((root) => resolved === path.resolve(root));
}

export function matchesScheduleGlob(relativePath: string, glob: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const normalizedGlob = glob.replace(/\\/g, "/");
  const pattern = globToRegExp(normalizedGlob);
  return pattern.test(normalizedPath);
}

function relativeForGlob(directory: string, filePath: string): string {
  const rel = path.relative(directory, filePath);
  return rel && !rel.startsWith("..") ? rel.replace(/\\/g, "/") : path.basename(filePath);
}

function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    const next = glob[i + 1];
    if (ch === "*" && next === "*") {
      out += ".*";
      i++;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += escapeRegExp(ch);
    }
  }
  out += "$";
  return new RegExp(out);
}

function escapeRegExp(ch: string): string {
  return /[\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
}
