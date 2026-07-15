import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

export type RunnerAgentStateStatus = "running" | "blocked" | "failed" | "completed" | "unknown";

export interface RunnerAgentState {
  agent_id: string;
  status: RunnerAgentStateStatus;
  session: string;
  round?: string;
  started?: string;
  completed?: string;
  emits?: string;
  chain?: string;
  workspace?: string;
  timeout?: string;
  retry_max?: string;
  retry_attempt?: string;
  on_error?: string;
  on_timeout?: string;
  start_sha?: string;
  pid?: string;
  blocked_reason?: string;
  blocked_at?: string;
  error?: string;
  failed_reason?: string;
  failed_at?: string;
}

export interface CreateRunnerAgentState extends Omit<RunnerAgentState, "status"> {
  status?: Extract<RunnerAgentStateStatus, "running">;
}

const REQUIRED_KEYS = ["status", "session", "agent_id"] as const;
const KNOWN_KEYS = new Set<string>([
  ...REQUIRED_KEYS,
  "round", "started", "completed", "emits", "chain", "workspace", "timeout",
  "retry_max", "retry_attempt", "on_error", "on_timeout", "start_sha", "pid",
  "blocked_reason", "blocked_at", "error", "failed_reason", "failed_at",
]);
const STATE_STATUSES = new Set<RunnerAgentStateStatus>(["running", "blocked", "failed", "completed", "unknown"]);

/**
 * Canonical file key for a runner agent. It deliberately preserves the historic
 * shell-safe spelling so every caller resolves one physical record during the
 * cutover; only TypeScript is allowed to derive it.
 */
export function runnerAgentStateKey(sessionPrefix: string, runId?: string): string {
  return [sessionPrefix, runId || "no_run"].map(normalizeKeyPart).join("_");
}

export function runnerAgentStatePath(stateDir: string, sessionPrefix: string, runId?: string): string {
  return join(requireAbsoluteStateDir(stateDir), `${runnerAgentStateKey(sessionPrefix, runId)}.state`);
}

export function parseRunnerAgentState(content: string, filename = ""): RunnerAgentState {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine) continue;
    const separator = rawLine.indexOf(":");
    if (separator <= 0) throw new Error(`Invalid runner agent state line in ${filename || "state file"}`);
    const key = rawLine.slice(0, separator).trim();
    const value = rawLine.slice(separator + 1).trim();
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown runner agent state key '${key}'`);
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate runner agent state key '${key}'`);
    values[key] = value;
  }
  for (const key of REQUIRED_KEYS) {
    if (!values[key]) throw new Error(`Runner agent state requires '${key}'`);
  }
  if (!STATE_STATUSES.has(values.status as RunnerAgentStateStatus)) {
    throw new Error(`Invalid runner agent state status '${values.status}'`);
  }
  if (values.retry_attempt !== undefined && !isNonNegativeInteger(values.retry_attempt)) {
    throw new Error("runner agent state retry_attempt must be a non-negative integer");
  }
  return values as unknown as RunnerAgentState;
}

export function serializeRunnerAgentState(state: RunnerAgentState): string {
  validateRunnerAgentState(state);
  const lines = [
    `status: ${state.status}`,
    `session: ${state.session}`,
    `agent_id: ${state.agent_id}`,
  ];
  for (const key of [
    "round", "started", "completed", "emits", "chain", "workspace", "timeout",
    "retry_max", "retry_attempt", "on_error", "on_timeout", "start_sha", "pid",
    "blocked_reason", "blocked_at", "error", "failed_reason", "failed_at",
  ] as const) {
    const value = state[key];
    if (value !== undefined) lines.push(`${key}: ${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export function createRunnerAgentState(path: string, input: CreateRunnerAgentState): RunnerAgentState {
  const state: RunnerAgentState = {
    ...input,
    status: "running",
    retry_attempt: input.retry_attempt ?? "0",
  };
  writeRunnerAgentState(path, state);
  return state;
}

export function readRunnerAgentState(path: string): RunnerAgentState | null {
  if (!existsSync(path)) return null;
  if (lstatSync(path).isSymbolicLink()) throw new Error(`Runner agent state must not be a symbolic link: ${path}`);
  return parseRunnerAgentState(readFileSync(path, "utf8"), basename(path));
}

export function updateRunnerAgentState(
  path: string,
  update: (current: RunnerAgentState) => RunnerAgentState,
): RunnerAgentState {
  return withExclusiveFileClaim(`${path}.lock`, () => {
    const current = readRunnerAgentState(path);
    if (!current) throw new Error(`Runner agent state does not exist: ${path}`);
    const next = update(current);
    writeRunnerAgentStateUnlocked(path, next);
    return next;
  }, { waitTimeoutMs: 5_000 });
}

export function transitionRunnerAgentState(
  path: string,
  status: Extract<RunnerAgentStateStatus, "blocked" | "failed" | "completed">,
  reason?: string,
  at = new Date().toISOString(),
): RunnerAgentState {
  return updateRunnerAgentState(path, (current) => {
    const next: RunnerAgentState = { ...current, status };
    if (status === "blocked") {
      next.blocked_reason = requireReason(reason, status);
      next.blocked_at = at;
    } else if (status === "failed") {
      next.error = requireReason(reason, status);
      next.failed_reason = reason;
      next.failed_at = at;
    } else {
      next.completed = at;
    }
    return next;
  });
}

export function incrementRunnerAgentRetry(path: string): RunnerAgentState {
  return updateRunnerAgentState(path, (current) => ({
    ...current,
    retry_attempt: String(Number.parseInt(current.retry_attempt || "0", 10) + 1),
  }));
}

export function readRunnerAgentStateDirectory(dir: string, runIdFilter?: string): Record<string, RunnerAgentState> {
  const states: Record<string, RunnerAgentState> = {};
  if (!existsSync(dir)) return states;
  if (lstatSync(dir).isSymbolicLink()) return states;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".state")) continue;
    try {
      const state = readRunnerAgentState(join(dir, entry.name));
      if (!state) continue;
      if (runIdFilter && !state.session.includes(runIdFilter)) continue;
      states[state.agent_id] = state;
    } catch {
      // State overlays are observability only. A corrupt record cannot override
      // the durable run record, so omit it rather than invent a status.
    }
  }
  return states;
}

export interface RunnerAgentStateMatch {
  path: string;
  state: RunnerAgentState;
}

/** Find a runner state by its durable PTY session without exposing file scans to callers. */
export function findRunnerAgentStateBySession(dir: string, session: string): RunnerAgentStateMatch | null {
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".state")) continue;
    const path = join(dir, entry.name);
    try {
      const state = readRunnerAgentState(path);
      if (state?.session === session) return { path, state };
    } catch {
      // Invalid state must not be selected by a session lookup.
    }
  }
  return null;
}

function writeRunnerAgentState(path: string, state: RunnerAgentState): void {
  withExclusiveFileClaim(`${path}.lock`, () => writeRunnerAgentStateUnlocked(path, state), { waitTimeoutMs: 5_000 });
}

function writeRunnerAgentStateUnlocked(path: string, state: RunnerAgentState): void {
  validateRunnerAgentState(state);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new Error(`Runner agent state directory must be a real directory: ${directory}`);
  }
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, serializeRunnerAgentState(state), { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function validateRunnerAgentState(state: RunnerAgentState): void {
  for (const key of REQUIRED_KEYS) {
    if (!state[key] || state[key].includes("\n")) throw new Error(`Runner agent state requires one-line '${key}'`);
  }
  if (!STATE_STATUSES.has(state.status)) throw new Error(`Invalid runner agent state status '${state.status}'`);
  for (const [key, value] of Object.entries(state)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown runner agent state key '${key}'`);
    if (value !== undefined && value.includes("\n")) throw new Error(`Runner agent state '${key}' must be one line`);
  }
  if (state.retry_attempt !== undefined && !isNonNegativeInteger(state.retry_attempt)) {
    throw new Error("runner agent state retry_attempt must be a non-negative integer");
  }
}

function normalizeKeyPart(value: string): string {
  return value.replaceAll("-", "_").replaceAll(/[^a-zA-Z0-9_]/g, "_");
}

function requireAbsoluteStateDir(path: string): string {
  if (!path || !path.startsWith("/")) throw new Error("Runner agent state directory must be absolute");
  return path.replace(/\/+$/, "") || "/";
}

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function requireReason(reason: string | undefined, status: string): string {
  if (!reason || reason.includes("\n")) throw new Error(`Runner agent ${status} transition requires a one-line reason`);
  return reason;
}
