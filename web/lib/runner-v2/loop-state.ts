import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface LoopState {
  visited: string[];
  round: number;
}

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

export function writeLoopState(runDir: string, state: LoopState): LoopState {
  const normalized = {
    visited: Array.from(new Set(state.visited)),
    round: normalizePositiveInteger(state.round, 1),
  };
  writeJsonAtomic(loopStatePath(runDir), normalized);
  writeShellLoopState(shellLoopStatePath(runDir), normalized.visited);
  return normalized;
}

export function recordLoopVisit(runDir: string, visitKey: string, round: number): LoopState {
  const state = readLoopState(runDir);
  return writeLoopState(runDir, {
    visited: [...state.visited, visitKey],
    round,
  });
}

function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, path);
}

function readShellVisits(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[^:\s]+:[^\s]+$/.test(line));
}

function writeShellLoopState(path: string, visited: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, visited.length > 0 ? `${visited.join("\n")}\n` : "");
  renameSync(tmp, path);
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}
