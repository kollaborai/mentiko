import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { withRunJsonLock } from "@/lib/runs/run-json-lock";

export interface LoopState {
  visited: string[];
  round: number;
}

export interface LoopFileSnapshot {
  path: string;
  existed: boolean;
  content?: string;
}

export interface LoopFileMutation {
  before: LoopFileSnapshot;
  after: LoopFileSnapshot;
}

export type LoopMutationObserver = (mutation: LoopFileMutation) => void;

export function loopStatePath(runDir: string): string {
  return join(runDir, "chain-loop-state.json");
}

export function shellLoopStatePath(runDir: string): string {
  return join(runDir, "chain_loop_tracker.txt");
}

export function readLoopState(runDir: string): LoopState {
  const path = loopStatePath(runDir);
  const parsed = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8")) as Partial<LoopState>
    : {};
  const jsonVisited = Array.isArray(parsed.visited)
    ? parsed.visited.filter((value): value is string => typeof value === "string")
    : [];
  const shellVisited = readShellVisits(shellLoopStatePath(runDir));
  return {
    visited: Array.from(new Set([...jsonVisited, ...shellVisited])),
    round: normalizePositiveInteger(parsed.round, 1),
  };
}

export function writeLoopState(
  runDir: string,
  state: LoopState,
  onMutation?: LoopMutationObserver,
): LoopState {
  return withLoopStateLock(runDir, () => writeLoopStateUnlocked(runDir, state, onMutation));
}

function writeLoopStateUnlocked(
  runDir: string,
  state: LoopState,
  onMutation?: LoopMutationObserver,
): LoopState {
  const normalized = {
    visited: Array.from(new Set(state.visited)),
    round: normalizePositiveInteger(state.round, 1),
  };
  writeJsonAtomic(loopStatePath(runDir), normalized, onMutation);
  writeShellLoopState(shellLoopStatePath(runDir), normalized.visited, onMutation);
  return normalized;
}

export function recordLoopVisit(
  runDir: string,
  visitKey: string,
  round: number,
  onMutation?: LoopMutationObserver,
): LoopState {
  return withLoopStateLock(runDir, () => {
    const state = readLoopState(runDir);
    return writeLoopStateUnlocked(runDir, {
      visited: [...state.visited, visitKey],
      round,
    }, onMutation);
  });
}

/**
 * Reverse completion-owned loop writes while holding the same owner-bearing
 * claim used by every typed loop writer. Exact after-image checks happen
 * inside the claim, closing the compare/restore race.
 */
export function restoreLoopMutations(
  mutations: LoopFileMutation[],
  beforeRestore?: (mutation: LoopFileMutation) => void,
): void {
  if (mutations.length === 0) return;
  const runDirs = Array.from(new Set(mutations.map((mutation) => dirname(mutation.after.path))));
  if (runDirs.length !== 1) {
    throw new Error(`loop mutation journal spans multiple run directories: ${runDirs.join(", ")}`);
  }
  withLoopStateLock(runDirs[0], () => {
    for (const mutation of [...mutations].reverse()) {
      const current = snapshotLoopFile(mutation.after.path);
      if (!loopFileSnapshotEqual(current, mutation.after)) continue;
      beforeRestore?.(mutation);
      restoreLoopFileAtomic(mutation.before);
    }
  });
}

function writeJsonAtomic(path: string, data: unknown, onMutation?: LoopMutationObserver): void {
  const before = snapshotLoopFile(path);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
  onMutation?.({ before, after: snapshotLoopFile(path) });
}

function readShellVisits(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^:\s]+:[^\s]+$/.test(line));
}

function writeShellLoopState(
  path: string,
  visited: string[],
  onMutation?: LoopMutationObserver,
): void {
  const before = snapshotLoopFile(path);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, visited.length > 0 ? `${visited.join("\n")}\n` : "");
  renameSync(tmp, path);
  onMutation?.({ before, after: snapshotLoopFile(path) });
}

function snapshotLoopFile(path: string): LoopFileSnapshot {
  return existsSync(path)
    ? { path, existed: true, content: readFileSync(path, "utf8") }
    : { path, existed: false };
}

function restoreLoopFileAtomic(snapshot: LoopFileSnapshot): void {
  if (!snapshot.existed) {
    rmSync(snapshot.path, { force: true });
    return;
  }
  mkdirSync(dirname(snapshot.path), { recursive: true });
  const tmp = `${snapshot.path}.restore.${process.pid}.${randomUUID()}`;
  writeFileSync(tmp, snapshot.content || "", { flag: "wx" });
  renameSync(tmp, snapshot.path);
}

function loopFileSnapshotEqual(left: LoopFileSnapshot, right: LoopFileSnapshot): boolean {
  return left.path === right.path
    && left.existed === right.existed
    && left.content === right.content;
}

function withLoopStateLock<T>(runDir: string, fn: () => T): T {
  // Reuse the cross-process owner/PID lock protocol. The path parameter only
  // selects the adjacent `${path}.lock`; the protected payload need not be JSON.
  return withRunJsonLock(loopStatePath(runDir), fn);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
