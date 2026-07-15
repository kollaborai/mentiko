import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import config from "../config";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

const BREAKPOINT_DIR = config.debugDir;
const CLAIM_WAIT_MS = 1_000;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export interface Breakpoint {
  agentId: string;
  enabled: boolean;
  condition?: string;
  hitCount?: number;
}

export interface BreakpointState {
  chainId: string;
  breakpoints: Breakpoint[];
  pausedAt?: string;
  pausedAtTimestamp?: string;
  resumeRequested: boolean;
  lastUpdated: string;
}

export class BreakpointRecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BreakpointRecordValidationError";
  }
}

export interface BreakpointPaths {
  debugDir: string;
  chainDir: string;
  recordPath: string;
}

/** Resolve a contained, canonical path. The configured debug root may be a symlink, but chain and record paths may not. */
export function resolveBreakpointPaths(chainId: string, debugDir = BREAKPOINT_DIR): BreakpointPaths {
  assertSegment(chainId, "chain id");
  if (!debugDir || !isAbsolute(debugDir)) throw new BreakpointRecordValidationError("Breakpoint debug directory must be absolute.");
  mkdirSync(debugDir, { recursive: true, mode: 0o700 });
  const canonicalDebugDir = realpathSync(debugDir);
  const chainDir = contained(canonicalDebugDir, chainId);
  if (existsSync(chainDir) && lstatSync(chainDir).isSymbolicLink()) {
    throw new BreakpointRecordValidationError("Breakpoint chain directory must not be a symlink.");
  }
  const recordPath = contained(chainDir, "breakpoints.json");
  if (pathPresent(recordPath)) assertRegularFile(recordPath);
  return { debugDir: canonicalDebugDir, chainDir, recordPath };
}

export function loadBreakpoints(chainId: string, debugDir = BREAKPOINT_DIR): BreakpointState {
  const { recordPath } = resolveBreakpointPaths(chainId, debugDir);
  if (!pathPresent(recordPath)) return emptyState(chainId);
  return parseBreakpointState(readFileSync(recordPath, "utf8"), chainId);
}

export function saveBreakpoints(state: BreakpointState, debugDir = BREAKPOINT_DIR): BreakpointState {
  const valid = validateBreakpointState(state, state.chainId);
  const paths = resolveBreakpointPaths(valid.chainId, debugDir);
  return withExclusiveFileClaim(`${paths.recordPath}.lock`, () => writeBreakpointState(paths, valid), { waitTimeoutMs: CLAIM_WAIT_MS });
}

export function setBreakpoint(chainId: string, agentId: string, enabled = true, debugDir = BREAKPOINT_DIR): BreakpointState {
  assertSegment(agentId, "agent id");
  if (typeof enabled !== "boolean") throw new BreakpointRecordValidationError("Breakpoint enabled must be boolean.");
  return mutateBreakpoints(chainId, debugDir, (state) => {
    const current = state.breakpoints.find((breakpoint) => breakpoint.agentId === agentId);
    if (current) current.enabled = enabled;
    else state.breakpoints.push({ agentId, enabled, hitCount: 0 });
    return state;
  });
}

export function replaceBreakpoints(chainId: string, breakpoints: Breakpoint[], debugDir = BREAKPOINT_DIR): BreakpointState {
  if (!Array.isArray(breakpoints)) throw new BreakpointRecordValidationError("Breakpoints must be an array.");
  return mutateBreakpoints(chainId, debugDir, (state) => ({
    ...state,
    breakpoints: breakpoints.map((breakpoint) => validateBreakpoint(breakpoint)),
    pausedAt: undefined,
    pausedAtTimestamp: undefined,
    resumeRequested: false,
  }));
}

export function clearBreakpoint(chainId: string, agentId: string, debugDir = BREAKPOINT_DIR): BreakpointState {
  assertSegment(agentId, "agent id");
  return mutateBreakpoints(chainId, debugDir, (state) => ({ ...state, breakpoints: state.breakpoints.filter((breakpoint) => breakpoint.agentId !== agentId) }));
}

export function clearAllBreakpoints(chainId: string, debugDir = BREAKPOINT_DIR): BreakpointState {
  return mutateBreakpoints(chainId, debugDir, (state) => ({ ...state, breakpoints: [], pausedAt: undefined, pausedAtTimestamp: undefined, resumeRequested: false }));
}

export function shouldPause(chainId: string, agentId: string, debugDir = BREAKPOINT_DIR): boolean {
  assertSegment(agentId, "agent id");
  return loadBreakpoints(chainId, debugDir).breakpoints.some((breakpoint) => breakpoint.agentId === agentId && breakpoint.enabled);
}

export function pauseAt(chainId: string, agentId: string, debugDir = BREAKPOINT_DIR): BreakpointState {
  assertSegment(agentId, "agent id");
  return mutateBreakpoints(chainId, debugDir, (state) => {
    return {
      ...state,
      pausedAt: agentId,
      pausedAtTimestamp: new Date().toISOString(),
      resumeRequested: false,
      breakpoints: state.breakpoints.map((candidate) => candidate.agentId === agentId
        ? { ...candidate, hitCount: (candidate.hitCount ?? 0) + 1 }
        : candidate),
    };
  });
}

export function requestResume(chainId: string, debugDir = BREAKPOINT_DIR): BreakpointState {
  return mutateBreakpoints(chainId, debugDir, (state) => ({ ...state, resumeRequested: true }));
}

export function isResumeRequested(chainId: string, debugDir = BREAKPOINT_DIR): boolean {
  return loadBreakpoints(chainId, debugDir).resumeRequested;
}

export function breakpointRecordExists(chainId: string, debugDir = BREAKPOINT_DIR): boolean {
  return pathPresent(resolveBreakpointPaths(chainId, debugDir).recordPath);
}

/** Atomically test-and-clear resume so a newly posted request cannot be lost between shell polling and clearing. */
export function consumeResumeRequest(chainId: string, debugDir = BREAKPOINT_DIR): boolean {
  if (!breakpointRecordExists(chainId, debugDir)) return false;
  let consumed = false;
  mutateBreakpoints(chainId, debugDir, (state) => {
    consumed = state.resumeRequested;
    return consumed ? { ...state, resumeRequested: false, pausedAt: undefined, pausedAtTimestamp: undefined } : state;
  });
  return consumed;
}

export function clearPause(chainId: string, debugDir = BREAKPOINT_DIR): BreakpointState {
  return mutateBreakpoints(chainId, debugDir, (state) => ({ ...state, pausedAt: undefined, pausedAtTimestamp: undefined, resumeRequested: false }));
}

export function listBreakpointChains(debugDir = BREAKPOINT_DIR): string[] {
  if (!debugDir || !isAbsolute(debugDir) || !existsSync(debugDir)) return [];
  const root = realpathSync(debugDir);
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SEGMENT.test(entry.name))
      .filter((entry) => {
        try { return existsSync(resolveBreakpointPaths(entry.name, root).recordPath); } catch { return false; }
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function mutateBreakpoints(chainId: string, debugDir: string, mutation: (state: BreakpointState) => BreakpointState): BreakpointState {
  const paths = resolveBreakpointPaths(chainId, debugDir);
  return withExclusiveFileClaim(`${paths.recordPath}.lock`, () => {
    const current = pathPresent(paths.recordPath) ? parseBreakpointState(readFileSync(paths.recordPath, "utf8"), chainId) : emptyState(chainId);
    return writeBreakpointState(paths, validateBreakpointState(mutation(clone(current)), chainId));
  }, { waitTimeoutMs: CLAIM_WAIT_MS });
}

function writeBreakpointState(paths: BreakpointPaths, state: BreakpointState): BreakpointState {
  mkdirSync(paths.chainDir, { recursive: true, mode: 0o700 });
  if (lstatSync(paths.chainDir).isSymbolicLink()) throw new BreakpointRecordValidationError("Breakpoint chain directory must not be a symlink.");
  if (pathPresent(paths.recordPath)) assertRegularFile(paths.recordPath);
  const published = { ...state, lastUpdated: new Date().toISOString() };
  const temporary = join(paths.chainDir, `.${basename(paths.recordPath)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(published, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, paths.recordPath);
  return published;
}

function parseBreakpointState(raw: string, expectedChainId: string): BreakpointState {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new BreakpointRecordValidationError("Breakpoint record contains invalid JSON."); }
  return validateBreakpointState(value, expectedChainId);
}

function validateBreakpointState(value: unknown, expectedChainId: string): BreakpointState {
  const record = object(value, "Breakpoint record");
  rejectUnknown(record, ["chainId", "breakpoints", "pausedAt", "pausedAtTimestamp", "resumeRequested", "lastUpdated"], "Breakpoint record");
  const chainId = string(record.chainId, "Breakpoint chainId");
  assertSegment(chainId, "chain id");
  if (chainId !== expectedChainId) throw new BreakpointRecordValidationError("Breakpoint record chainId does not match its path.");
  if (!Array.isArray(record.breakpoints)) throw new BreakpointRecordValidationError("Breakpoint record breakpoints must be an array.");
  const breakpoints = record.breakpoints.map(validateBreakpoint);
  if (new Set(breakpoints.map((breakpoint) => breakpoint.agentId)).size !== breakpoints.length) throw new BreakpointRecordValidationError("Breakpoint record has duplicate agent ids.");
  const pausedAt = optionalString(record.pausedAt, "Breakpoint pausedAt");
  if (pausedAt) assertSegment(pausedAt, "agent id");
  const pausedAtTimestamp = optionalTimestamp(record.pausedAtTimestamp, "Breakpoint pausedAtTimestamp");
  if ((pausedAt && !pausedAtTimestamp) || (!pausedAt && pausedAtTimestamp)) throw new BreakpointRecordValidationError("Breakpoint pause fields must be present together.");
  if (typeof record.resumeRequested !== "boolean") throw new BreakpointRecordValidationError("Breakpoint resumeRequested must be boolean.");
  const lastUpdated = timestamp(record.lastUpdated, "Breakpoint lastUpdated");
  return { chainId, breakpoints, ...(pausedAt ? { pausedAt, pausedAtTimestamp } : {}), resumeRequested: record.resumeRequested, lastUpdated };
}

function validateBreakpoint(value: unknown): Breakpoint {
  const record = object(value, "Breakpoint");
  rejectUnknown(record, ["agentId", "enabled", "condition", "hitCount"], "Breakpoint");
  const agentId = string(record.agentId, "Breakpoint agentId");
  assertSegment(agentId, "agent id");
  if (typeof record.enabled !== "boolean") throw new BreakpointRecordValidationError("Breakpoint enabled must be boolean.");
  const condition = optionalString(record.condition, "Breakpoint condition");
  const hitCount = record.hitCount;
  if (hitCount !== undefined && (typeof hitCount !== "number" || !Number.isSafeInteger(hitCount) || hitCount < 0)) throw new BreakpointRecordValidationError("Breakpoint hitCount must be a non-negative integer.");
  return { agentId, enabled: record.enabled, ...(condition ? { condition } : {}), ...(hitCount === undefined ? {} : { hitCount }) };
}

function emptyState(chainId: string): BreakpointState { return { chainId, breakpoints: [], resumeRequested: false, lastUpdated: new Date().toISOString() }; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new BreakpointRecordValidationError(`${label} must be an object.`); return value as Record<string, unknown>; }
function string(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new BreakpointRecordValidationError(`${label} must be a non-empty string.`); return value; }
function optionalString(value: unknown, label: string): string | undefined { if (value === undefined) return undefined; return string(value, label); }
function timestamp(value: unknown, label: string): string { const result = string(value, label); if (Number.isNaN(Date.parse(result))) throw new BreakpointRecordValidationError(`${label} must be an ISO timestamp.`); return result; }
function optionalTimestamp(value: unknown, label: string): string | undefined { return value === undefined ? undefined : timestamp(value, label); }
function rejectUnknown(record: Record<string, unknown>, allowed: string[], label: string): void { for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new BreakpointRecordValidationError(`${label} has unsupported field ${key}.`); }
function assertSegment(value: string, label: string): void { if (!SEGMENT.test(value)) throw new BreakpointRecordValidationError(`Invalid ${label}.`); }
function contained(root: string, child: string): string { const path = resolve(root, child); const rel = relative(root, path); if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new BreakpointRecordValidationError("Breakpoint path escapes its debug root."); return path; }
function assertRegularFile(path: string): void { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new BreakpointRecordValidationError("Breakpoint record must be a regular file."); }
function pathPresent(path: string): boolean { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
