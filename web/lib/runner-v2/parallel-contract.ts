import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

const GROUP_ID = /^parallel-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type ParallelStatus = "running" | "complete";
export type ParallelResult = { status: "success" | "failed"; exitCode?: number };

export interface ParallelGroup {
  id: string;
  status: ParallelStatus;
  started: string;
  agents: string[];
  pids: Record<string, number>;
  results: Record<string, ParallelResult>;
  completed?: string;
}

export function parallelDir(stateDir: string): string {
  if (!isAbsolute(stateDir)) throw new Error("state directory must be absolute");
  const root = resolve(stateDir);
  ensureDirectory(root, "state directory");
  const directory = join(root, "parallel");
  ensureDirectory(directory, "parallel state directory");
  return directory;
}

export function validateRawParallelGroup(text: string): { valid: true; value: Record<string, unknown> } | { valid: false } {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && !Array.isArray(value) ? { valid: true, value } : { valid: false };
  } catch {
    return { valid: false };
  }
}

export function validateParallelGroup(value: unknown): value is ParallelGroup {
  if (!isRecord(value) || !GROUP_ID.test(stringValue(value.id))) return false;
  if (value.status !== "running" && value.status !== "complete") return false;
  if (!isIsoDate(value.started) || !stringArray(value.agents) || value.agents.length === 0) return false;
  if (new Set(value.agents).size !== value.agents.length || value.agents.some((agent) => !AGENT_ID.test(agent))) return false;
  if (!recordMap(value.pids, value.agents, isPid)) return false;
  const results = value.results;
  if (!recordMap(results, value.agents, isParallelResult)) return false;

  const complete = value.agents.every((agent) => Object.hasOwn(results, agent));
  if (value.status === "complete" && (!complete || !isIsoDate(value.completed))) return false;
  if (value.status === "running" && value.completed !== undefined) return false;
  return true;
}

export function createParallelGroup(
  stateDir: string,
  agents: string[],
  id = `parallel-${Date.now()}-${randomUUID().slice(0, 8)}`,
): ParallelGroup {
  assertGroupId(id);
  if (!stringArray(agents) || agents.length === 0 || new Set(agents).size !== agents.length || agents.some((agent) => !AGENT_ID.test(agent))) {
    throw new Error("parallel group agents must be unique, non-empty ids");
  }
  const group: ParallelGroup = {
    id,
    status: "running",
    started: new Date().toISOString(),
    agents: [...agents],
    pids: {},
    results: {},
  };
  writeRecord(recordPath(stateDir, id), group);
  return group;
}

export function recordParallelPid(stateDir: string, id: string, agent: string, pid: number): ParallelGroup {
  assertPid(pid);
  return mutate(stateDir, id, (group) => {
    assertKnownAgent(group, agent);
    if (group.status === "complete") throw new Error(`parallel group is already complete: ${id}`);
    return { ...group, pids: { ...group.pids, [agent]: pid } };
  });
}

export function recordParallelResult(stateDir: string, id: string, agent: string, exitCode: number): ParallelGroup {
  if (!Number.isSafeInteger(exitCode)) throw new Error("parallel exit code must be a safe integer");
  return mutate(stateDir, id, (group) => {
    assertKnownAgent(group, agent);
    if (group.status === "complete") throw new Error(`parallel group is already complete: ${id}`);
    const results: Record<string, ParallelResult> = {
      ...group.results,
      [agent]: exitCode === 0 ? { status: "success" } : { status: "failed", exitCode },
    };
    const complete = group.agents.every((candidate) => Object.hasOwn(results, candidate));
    return {
      ...group,
      results,
      status: complete ? "complete" : "running",
      ...(complete ? { completed: new Date().toISOString() } : {}),
    };
  });
}

export function cleanupParallelGroups(stateDir: string, days: number): string[] {
  if (!Number.isSafeInteger(days) || days < 0) throw new Error("cleanup days must be a non-negative safe integer");
  const directory = parallelDir(stateDir);
  const cutoff = Date.now() - days * 86_400_000;
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(directory, name))
    .filter((path) => {
      const entry = lstatSync(path);
      if (entry.isSymbolicLink() || !entry.isFile()) return false;
      return entry.mtimeMs < cutoff;
    })
    .map((path) => {
      rmSync(path);
      return path;
    });
}

function mutate(stateDir: string, id: string, update: (group: ParallelGroup) => ParallelGroup): ParallelGroup {
  const path = recordPath(stateDir, id);
  const lock = `${path}.lock`;
  return withExclusiveFileClaim(lock, () => {
    assertRegularFile(path, "parallel group record");
    const raw = validateRawParallelGroup(readFileSync(path, "utf8"));
    if (!raw.valid || !validateParallelGroup(raw.value)) throw new Error(`invalid parallel group record: ${path}`);
    const next = update(raw.value);
    if (!validateParallelGroup(next)) throw new Error(`parallel group mutation produced invalid state: ${id}`);
    writeRecord(path, next);
    return next;
  });
}

function recordPath(stateDir: string, id: string): string {
  assertGroupId(id);
  return join(parallelDir(stateDir), `${id}.json`);
}

function writeRecord(path: string, group: ParallelGroup): void {
  const directory = dirname(path);
  ensureDirectory(directory, "parallel state directory");
  if (existsSync(path)) assertRegularFile(path, "parallel group record");
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(group, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

function ensureDirectory(path: string, label: string): void {
  if (existsSync(path)) {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a non-symlink directory: ${path}`);
    return;
  }
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a non-symlink directory: ${path}`);
}

function assertRegularFile(path: string, label: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} must be a non-symlink regular file: ${path}`);
}

function assertGroupId(value: string): void {
  if (!GROUP_ID.test(value)) throw new Error(`invalid parallel group id: ${value}`);
}

function assertKnownAgent(group: ParallelGroup, agent: string): void {
  if (!group.agents.includes(agent)) throw new Error(`agent is not part of parallel group: ${agent}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === "string"); }
function isPid(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function assertPid(value: number): void { if (!isPid(value)) throw new Error("parallel pid must be a non-negative safe integer"); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function recordMap<T>(value: unknown, agents: string[], predicate: (entry: unknown) => entry is T): value is Record<string, T> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([agent, entry]) => agents.includes(agent) && predicate(entry));
}
function isParallelResult(value: unknown): value is ParallelResult {
  if (!isRecord(value) || (value.status !== "success" && value.status !== "failed")) return false;
  return value.status === "success"
    ? value.exitCode === undefined
    : typeof value.exitCode === "number" && Number.isSafeInteger(value.exitCode);
}
