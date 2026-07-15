import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import config from "@/lib/config";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const CLAIM_WAIT_MS = 1_000;

export type DebugStatus =
  | "idle"
  | "initialized"
  | "running"
  | "paused"
  | "stepping"
  | "aborted"
  | "completed"
  | "failed"
  | "stopped";

export type DebugAction = "pause" | "continue" | "resume" | "step" | "skip" | "retry" | "abort" | "set_breakpoints";

export interface DebugStep {
  agent_id?: string;
  agent_name?: string;
  session?: string;
  round?: number;
  status?: string;
  timestamp?: string;
  output?: string;
  [key: string]: unknown;
}

export interface DebugState {
  run_id?: string;
  status?: DebugStatus;
  current_step?: number | null;
  steps: DebugStep[];
  breakpoints?: unknown[];
  last_action?: DebugAction | string;
  last_action_at?: string;
  [key: string]: unknown;
}

export type DebugRawIssueCode = "empty-file" | "invalid-json" | "invalid-root";
export interface DebugRawIssue { code: DebugRawIssueCode; message: string; }
export interface DebugRawValidation { valid: boolean; value?: Record<string, unknown>; issues: DebugRawIssue[]; }

export type DebugIssueCode = "invalid-record" | "invalid-field-type" | "invalid-id" | "invalid-status" | "invalid-timestamp" | "invalid-step";
export interface DebugIssue { code: DebugIssueCode; message: string; field?: string; }
export interface DebugValidation { valid: boolean; issues: DebugIssue[]; }

export class DebugStateValidationError extends Error {
  constructor(readonly stage: "raw" | "normalized", readonly issues: Array<DebugRawIssue | DebugIssue>) {
    super(`Invalid ${stage} debug state: ${issues.map((issue) => `${issue.code} (${issue.message})`).join(", ")}`);
    this.name = "DebugStateValidationError";
  }
}

export interface DebugStatePaths { debugDir: string; debugPath: string; }

/** Resolve the configured debugger root and a contained run record path. */
export function resolveDebugStatePaths(runId: string, debugDir = config.debugDir): DebugStatePaths {
  assertSegment(runId, "run id");
  if (!debugDir || !isAbsolute(debugDir)) throw new DebugStateValidationError("normalized", [{ code: "invalid-record", message: "Debug directory must be absolute." }]);
  mkdirSync(debugDir, { recursive: true, mode: 0o700 });
  const canonicalRoot = realpathSync(debugDir);
  const debugPath = contained(canonicalRoot, `${runId}.json`);
  if (pathPresent(debugPath)) assertRegularFile(debugPath);
  return { debugDir: canonicalRoot, debugPath };
}

/** Validate only the physical bytes on disk. */
export function validateRawDebugState(content: string): DebugRawValidation {
  if (content.trim() === "") return { valid: false, issues: [{ code: "empty-file", message: "Debug state file must not be empty." }] };
  let value: unknown;
  try { value = JSON.parse(content); } catch (error) {
    return { valid: false, issues: [{ code: "invalid-json", message: error instanceof Error ? error.message : "Debug state is not valid JSON." }] };
  }
  if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-root", message: "Debug state JSON root must be an object." }] };
  return { valid: true, value, issues: [] };
}

/** Validate the normalized debugger envelope independently of JSON encoding. */
export function validateDebugState(value: unknown): DebugValidation {
  if (!isRecord(value)) return { valid: false, issues: [{ code: "invalid-record", message: "Debug state must be an object." }] };
  const issues: DebugIssue[] = [];
  if (value.run_id !== undefined && (typeof value.run_id !== "string" || !SEGMENT.test(value.run_id))) {
    issues.push({ code: "invalid-id", field: "run_id", message: "run_id must be a safe path segment." });
  }
  if (value.status !== undefined && (typeof value.status !== "string" || !isDebugStatus(value.status))) {
    issues.push({ code: "invalid-status", field: "status", message: "status must be a known debug status." });
  }
  if (value.current_step !== undefined && value.current_step !== null && (!Number.isSafeInteger(value.current_step) || value.current_step < 0)) {
    issues.push({ code: "invalid-field-type", field: "current_step", message: "current_step must be a non-negative integer or null." });
  }
  if (!Array.isArray(value.steps)) {
    issues.push({ code: "invalid-field-type", field: "steps", message: "steps must be an array." });
  } else {
    value.steps.forEach((step, index) => {
      if (!isRecord(step)) {
        issues.push({ code: "invalid-step", field: `steps[${index}]`, message: "step must be an object." });
        return;
      }
      for (const field of ["agent_id", "agent_name", "session", "status", "output"] as const) {
        if (step[field] !== undefined && typeof step[field] !== "string") {
          issues.push({ code: "invalid-step", field: `steps[${index}].${field}`, message: `${field} must be a string.` });
        }
      }
      if (step.round !== undefined && (!Number.isSafeInteger(step.round) || step.round < 0)) {
        issues.push({ code: "invalid-step", field: `steps[${index}].round`, message: "round must be a non-negative integer." });
      }
      if (step.timestamp !== undefined && (typeof step.timestamp !== "string" || Number.isNaN(Date.parse(step.timestamp)))) {
        issues.push({ code: "invalid-timestamp", field: `steps[${index}].timestamp`, message: "timestamp must be an ISO timestamp." });
      }
    });
  }
  if (value.breakpoints !== undefined && !Array.isArray(value.breakpoints)) {
    issues.push({ code: "invalid-field-type", field: "breakpoints", message: "breakpoints must be an array." });
  }
  if (value.last_action_at !== undefined && (typeof value.last_action_at !== "string" || Number.isNaN(Date.parse(value.last_action_at)))) {
    issues.push({ code: "invalid-timestamp", field: "last_action_at", message: "last_action_at must be an ISO timestamp." });
  }
  return { valid: issues.length === 0, issues };
}

export function parseDebugState(content: string, expectedRunId?: string): DebugState {
  const raw = validateRawDebugState(content);
  if (!raw.valid || !raw.value) throw new DebugStateValidationError("raw", raw.issues);
  const normalized = validateDebugState(raw.value);
  if (!normalized.valid) throw new DebugStateValidationError("normalized", normalized.issues);
  const state = raw.value as DebugState;
  if (expectedRunId && state.run_id && state.run_id !== expectedRunId) {
    throw new DebugStateValidationError("normalized", [{ code: "invalid-id", field: "run_id", message: "run_id does not match its path." }]);
  }
  return state;
}

export function loadDebugState(runId: string, debugDir = config.debugDir): DebugState | null {
  const { debugPath } = resolveDebugStatePaths(runId, debugDir);
  if (!pathPresent(debugPath)) return null;
  return parseDebugState(readFileSync(debugPath, "utf8"), runId);
}

export function writeDebugState(runId: string, state: DebugState, debugDir = config.debugDir): DebugState {
  const valid = validateForWrite({ ...state, run_id: state.run_id || runId });
  const { debugPath } = resolveDebugStatePaths(runId, debugDir);
  return withExclusiveFileClaim(`${debugPath}.lock`, () => publishDebugState(debugPath, valid), { waitTimeoutMs: CLAIM_WAIT_MS });
}

export function appendDebugStep(input: {
  runId: string;
  agentId: string;
  agentName: string;
  session: string;
  round: number;
  status: string;
  output: string;
}, debugDir = config.debugDir): DebugState {
  const { debugPath } = resolveDebugStatePaths(input.runId, debugDir);
  return withExclusiveFileClaim(`${debugPath}.lock`, () => {
    const current = pathPresent(debugPath) ? parseDebugState(readFileSync(debugPath, "utf8"), input.runId) : { run_id: input.runId, steps: [] };
    const sanitized = sanitizeOutput(input.output);
    return publishDebugState(debugPath, validateForWrite({
      ...current,
      run_id: input.runId,
      steps: [...current.steps, {
        agent_id: input.agentId,
        agent_name: input.agentName,
        session: input.session,
        round: input.round,
        status: input.status,
        timestamp: new Date().toISOString(),
        output: sanitized,
      }],
      current_step: current.steps.length,
    }));
  }, { waitTimeoutMs: CLAIM_WAIT_MS });
}

export function mutateDebugState(input: {
  runId: string;
  action: DebugAction;
  stepIndex?: number;
  breakpoints?: unknown[];
}, debugDir = config.debugDir): DebugState {
  const { debugPath } = resolveDebugStatePaths(input.runId, debugDir);
  return withExclusiveFileClaim(`${debugPath}.lock`, () => {
    const current = pathPresent(debugPath)
      ? parseDebugState(readFileSync(debugPath, "utf8"), input.runId)
      : { run_id: input.runId, status: "initialized" as const, current_step: null, steps: [], breakpoints: input.breakpoints || [] };
    const next: DebugState = { ...current, run_id: input.runId, last_action: input.action, last_action_at: new Date().toISOString() };
    switch (input.action) {
      case "pause": next.status = "paused"; break;
      case "continue":
      case "resume": next.status = "running"; break;
      case "step": next.status = "stepping"; next.current_step = input.stepIndex ?? ((current.current_step ?? -1) + 1); break;
      case "skip": updateStepStatus(next, input.stepIndex, "skipped"); break;
      case "retry": updateStepStatus(next, input.stepIndex, "pending"); break;
      case "abort": next.status = "aborted"; break;
      case "set_breakpoints": next.breakpoints = input.breakpoints || []; break;
    }
    return publishDebugState(debugPath, validateForWrite(next));
  }, { waitTimeoutMs: CLAIM_WAIT_MS });
}

export function clearDebugState(runId: string, debugDir = config.debugDir): void {
  const { debugPath } = resolveDebugStatePaths(runId, debugDir);
  withExclusiveFileClaim(`${debugPath}.lock`, () => {
    if (pathPresent(debugPath)) unlinkSync(debugPath);
  }, { waitTimeoutMs: CLAIM_WAIT_MS });
}

export function emptyDebugState(): DebugState {
  return { status: "idle", current_step: null, steps: [] };
}

function validateForWrite(state: DebugState): DebugState {
  const normalized = validateDebugState(state);
  if (!normalized.valid) throw new DebugStateValidationError("normalized", normalized.issues);
  return state;
}

function publishDebugState(debugPath: string, state: DebugState): DebugState {
  mkdirSync(resolve(debugPath, ".."), { recursive: true, mode: 0o700 });
  const temporary = join(resolve(debugPath, ".."), `.${basename(debugPath)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, debugPath);
  return state;
}

function updateStepStatus(state: DebugState, stepIndex: number | undefined, status: string): void {
  if (stepIndex === undefined || !Number.isSafeInteger(stepIndex) || stepIndex < 0) return;
  const step = state.steps[stepIndex];
  if (step) step.status = status;
}

function sanitizeOutput(output: string): string {
  const collapsed = String(output).replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const truncated = collapsed.slice(0, 200);
  return output.length > 200 ? `${truncated}...` : (truncated || "(no output)");
}

function isDebugStatus(value: string): value is DebugStatus {
  return ["idle", "initialized", "running", "paused", "stepping", "aborted", "completed", "failed", "stopped"].includes(value as DebugStatus);
}
function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function assertSegment(value: string, label: string): void { if (!SEGMENT.test(value)) throw new DebugStateValidationError("normalized", [{ code: "invalid-id", field: label, message: `${label} must be a safe path segment.` }]); }
function contained(root: string, child: string): string { const path = resolve(root, child); const rel = relative(root, path); if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new DebugStateValidationError("normalized", [{ code: "invalid-record", message: "Debug state path escapes its root." }]); return path; }
function assertRegularFile(path: string): void { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new DebugStateValidationError("normalized", [{ code: "invalid-record", message: "Debug state path must be a regular file." }]); }
function pathPresent(path: string): boolean { try { lstatSync(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
