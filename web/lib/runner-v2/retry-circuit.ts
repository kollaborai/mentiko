import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

export type CircuitStateName = "closed" | "open" | "half_open";

export interface CircuitState {
  state: CircuitStateName;
  failure_count: number;
  last_failure: number;
  open_until: number;
  threshold: number;
  timeout: number;
}

export type CircuitStateRawIssueCode = "empty-file" | "invalid-json" | "invalid-root";
export interface CircuitStateRawValidation { valid: boolean; value?: Record<string, unknown>; issues: Array<{ code: CircuitStateRawIssueCode; message: string }>; }
export interface CircuitStateValidation { valid: boolean; issues: Array<{ field: string; message: string }>; }

const STATE_NAMES = new Set<CircuitStateName>(["closed", "open", "half_open"]);

export function configuredRetryDir(stateDir: string): string {
  if (!stateDir || !isAbsolute(stateDir)) throw new Error("Configured state root must be an absolute path.");
  const canonicalStateDir = realpathSync(stateDir);
  if (lstatSync(canonicalStateDir).isSymbolicLink()) throw new Error("Configured state root must not be a symbolic link.");
  const retryDir = resolve(canonicalStateDir, "retry");
  if (existsSync(retryDir) && lstatSync(retryDir).isSymbolicLink()) throw new Error("Configured retry root must not be a symbolic link.");
  return retryDir;
}

export function circuitStatePath(stateDir: string, chainId: string, agentName: string): string {
  const retryDir = configuredRetryDir(stateDir);
  if (!/^[A-Za-z0-9_-]+$/.test(chainId)) throw new Error("Circuit chain id must contain only letters, numbers, underscores, or hyphens.");
  if (!agentName.trim()) throw new Error("Circuit agent name must not be empty.");
  const safeAgent = agentName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = resolve(retryDir, `circuit_${chainId}_${safeAgent}.json`);
  if (dirname(path) !== retryDir || basename(path) !== `circuit_${chainId}_${safeAgent}.json` || relative(retryDir, path).startsWith("..")) {
    throw new Error("Circuit state path escapes the configured retry root.");
  }
  return path;
}

export function calculateBackoff(attempt: number, strategy: string, baseDelay: number, maxDelay = baseDelay * 10): number {
  assertNonNegativeSafeInteger(attempt, "attempt");
  assertNonNegativeSafeInteger(baseDelay, "base delay");
  assertNonNegativeSafeInteger(maxDelay, "max delay");
  let delay = baseDelay;
  if (strategy === "linear") delay = baseDelay * attempt;
  else if (strategy === "exponential" || strategy === "exponential_with_jitter") {
    delay = baseDelay * (2 ** Math.max(0, attempt - 1));
    if (strategy === "exponential_with_jitter") {
      const jitterPercent = Math.floor(Math.random() * 50) - 25;
      delay += Math.trunc((delay * jitterPercent) / 100);
      if (delay < 0) delay = baseDelay;
    }
  }
  if (!Number.isSafeInteger(delay)) delay = maxDelay;
  return Math.min(delay, maxDelay);
}

export function shouldRetry(attempt: number, maxRetries: number): boolean {
  assertNonNegativeSafeInteger(attempt, "attempt");
  assertNonNegativeSafeInteger(maxRetries, "max retries");
  return attempt < maxRetries;
}

export function isCircuitOpen(stateDir: string, chainId: string, agentName: string, now = epochSeconds()): boolean {
  const path = circuitStatePath(stateDir, chainId, agentName);
  return withCircuitClaim(path, () => {
    if (!existsSync(path)) return false;
    const state = readCircuitState(path);
    if (state.state === "open" && now > state.open_until) {
      writeCircuitState(path, { ...state, state: "half_open", failure_count: 0, last_failure: 0, open_until: 0 });
      return false;
    }
    return state.state === "open";
  });
}

export function recordCircuitFailure(input: {
  stateDir: string;
  chainId: string;
  agentName: string;
  threshold?: number;
  timeout?: number;
  now?: number;
}): CircuitState {
  const threshold = input.threshold ?? 5;
  const timeout = input.timeout ?? 300;
  assertPositiveSafeInteger(threshold, "threshold");
  assertNonNegativeSafeInteger(timeout, "timeout");
  const now = input.now ?? epochSeconds();
  assertNonNegativeSafeInteger(now, "now");
  const path = circuitStatePath(input.stateDir, input.chainId, input.agentName);
  return withCircuitClaim(path, () => {
    const current = existsSync(path) ? readCircuitState(path) : undefined;
    const failureCount = (current?.failure_count || 0) + 1;
    const opened = failureCount >= threshold;
    const next: CircuitState = {
      state: opened ? "open" : current?.state || "closed",
      failure_count: failureCount,
      last_failure: now,
      open_until: opened ? now + timeout : 0,
      threshold,
      timeout,
    };
    writeCircuitState(path, next);
    return next;
  });
}

export function resetCircuit(stateDir: string, chainId: string, agentName: string): void {
  const path = circuitStatePath(stateDir, chainId, agentName);
  withCircuitClaim(path, () => {
    if (existsSync(path)) rmSync(path);
  });
}

export function getCircuitState(stateDir: string, chainId: string, agentName: string): CircuitState | { state: "closed"; failure_count: 0 } {
  const path = circuitStatePath(stateDir, chainId, agentName);
  return withCircuitClaim(path, () => existsSync(path) ? readCircuitState(path) : { state: "closed", failure_count: 0 });
}

/** Validate only the physical JSON representation before normalizing a circuit record. */
export function validateRawCircuitState(content: string): CircuitStateRawValidation {
  if (content.trim() === "") return { valid: false, issues: [{ code: "empty-file", message: "Circuit state file must not be empty." }] };
  let value: unknown;
  try { value = JSON.parse(content); } catch (error) {
    return { valid: false, issues: [{ code: "invalid-json", message: error instanceof Error ? error.message : "Circuit state is not valid JSON." }] };
  }
  if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-root", message: "Circuit state JSON root must be an object." }] };
  return { valid: true, value, issues: [] };
}

/** Validate the parsed circuit object independently of its physical representation. */
export function validateCircuitState(value: unknown): CircuitStateValidation {
  if (!isRecord(value)) return { valid: false, issues: [{ field: "root", message: "Circuit state must be an object." }] };
  const issues: CircuitStateValidation["issues"] = [];
  if (typeof value.state !== "string" || !STATE_NAMES.has(value.state as CircuitStateName)) issues.push({ field: "state", message: "Circuit state name is invalid." });
  for (const field of ["failure_count", "last_failure", "open_until", "threshold", "timeout"] as const) {
    if (typeof value[field] !== "number" || !Number.isSafeInteger(value[field]) || value[field] < 0) issues.push({ field, message: "Circuit state value must be a non-negative safe integer." });
  }
  return { valid: issues.length === 0, issues };
}

export function formatCircuitState(state: CircuitState | { state: "closed"; failure_count: 0 }): string {
  const full = state as Partial<CircuitState>;
  return `state: ${state.state}\nfailures: ${state.failure_count}\nthreshold: ${full.threshold ?? "N/A"}\nopens_at: ${full.open_until ?? 0}`;
}

function readCircuitState(path: string): CircuitState {
  assertNotSymbolicLink(path, "Circuit state record");
  const content = readFileSync(path, "utf8");
  const raw = validateRawCircuitState(content);
  if (!raw.valid || !raw.value) throw new Error(`Invalid raw circuit state JSON at ${path}: ${raw.issues.map((issue) => issue.message).join(" ")}`);
  const normalized = validateCircuitState(raw.value);
  if (!normalized.valid) throw new Error(`Invalid normalized circuit state at ${path}: ${normalized.issues.map((issue) => issue.field).join(", ")}.`);
  return raw.value as unknown as CircuitState;
}

function writeCircuitState(path: string, state: CircuitState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  assertNotSymbolicLink(dirname(path), "Circuit retry root");
  assertNotSymbolicLink(path, "Circuit state record");
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) rmSync(temp, { force: true });
  }
}

function withCircuitClaim<T>(path: string, work: () => T): T {
  assertNotSymbolicLink(`${path}.lock`, "Circuit state lock");
  return withExclusiveFileClaim(`${path}.lock`, work, { freshMs: 60_000, waitTimeoutMs: 5_000, retryDelayMs: 50 });
}

function epochSeconds(): number { return Math.floor(Date.now() / 1_000); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function assertNotSymbolicLink(path: string, label: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
}
function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
}
function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer.`);
}
