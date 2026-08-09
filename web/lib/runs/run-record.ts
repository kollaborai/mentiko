import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import {
  withRunJsonLock,
  writeRunJsonAtomic,
  writeRunJsonExclusive,
} from "@/lib/runs/run-json-lock";
import type { WorkspaceExecutionRecord } from "@/lib/runner-v2/workspace-evidence-types";

export const RUN_ID_PATTERN = /^run-[A-Za-z0-9_-]{1,120}$/;

export const RUN_STATUSES = [
  "pending",
  "running",
  "blocked",
  "failed",
  "stopped",
  "completed",
  "cancelled",
  "stalled",
] as const;

export const RUN_AGENT_STATUSES = [
  "pending",
  "running",
  "blocked",
  "failed",
  "stopped",
  "cancelled",
  "complete",
  "error",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type AgentStatus = (typeof RUN_AGENT_STATUSES)[number];

export interface RunAgentRecord {
  id: string;
  name: string;
  session: string;
  status: AgentStatus;
  started?: string;
  completed?: string;
  [key: string]: unknown;
}

export interface RunRecord {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  status: RunStatus;
  sessions?: string[];
  agents: RunAgentRecord[];
  parent_run_id?: string;
  workspaceId?: string;
  workspacePath?: string;
  taskId?: string;
  workspaceExecution?: WorkspaceExecutionRecord;
  completed?: string;
  status_message?: string;
  metadata?: Record<string, unknown>;
  type?: string;
  linkId?: string;
  [key: string]: unknown;
}

/** Deliberate API/UI projection of the persisted record; runner internals stay server-side. */
export interface RunListRecord {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: RunStatus;
  status_message?: string;
  agents: Array<Pick<RunAgentRecord, "id" | "name" | "session" | "status" | "started" | "completed">>;
  sessions?: string[];
  parent_run_id?: string;
  workspaceId?: string;
  workspacePath?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  type?: string;
  linkId?: string;
  totalCostCents?: number;
  totalCostDisplay?: string;
}

export interface RunListCost {
  totalCostCents: number;
  totalCostDisplay: string;
}

export type RunRecordRawIssueCode = "empty-file" | "invalid-json" | "invalid-root";

export interface RunRecordRawIssue {
  code: RunRecordRawIssueCode;
  message: string;
}

export interface RunRecordRawValidation {
  valid: boolean;
  value?: Record<string, unknown>;
  issues: RunRecordRawIssue[];
}

export type RunRecordIssueCode =
  | "invalid-record"
  | "missing-field"
  | "invalid-field-type"
  | "empty-field"
  | "invalid-run-id"
  | "invalid-status"
  | "invalid-timestamp"
  | "invalid-value"
  | "unknown-field"
  | "duplicate-session"
  | "duplicate-agent"
  | "identity-mismatch";

export interface RunRecordIssue {
  code: RunRecordIssueCode;
  message: string;
  field?: string;
}

export interface RunRecordValidation {
  valid: boolean;
  issues: RunRecordIssue[];
}

export interface RunRecordPaths {
  runsDir: string;
  runDir: string;
  runJsonPath: string;
}

export class RunRecordValidationError extends Error {
  constructor(
    readonly stage: "raw" | "normalized",
    readonly issues: Array<RunRecordRawIssue | RunRecordIssue>,
  ) {
    super(`Invalid ${stage} run record: ${issues.map((issue) => `${issue.code} (${issue.message})`).join(", ")}`);
    this.name = "RunRecordValidationError";
  }
}

export class RunRecordAlreadyExistsError extends Error {
  constructor(readonly runDir: string) {
    super(`Run record already exists: ${runDir}`);
    this.name = "RunRecordAlreadyExistsError";
  }
}

let compiledRunRecordValidator: ValidateFunction | undefined;

// lib/schemas/ lives at the code root, outside web/ — which next.config pins as both
// the turbopack root and outputFileTracingRoot, so the schema cannot be a static
// import here and has to be read at runtime.
//
// This resolves the same LIB_DIR / MENTIKO_CODE_ROOT contract as lib/config.ts rather
// than importing it: run-record sits deep in the runner-v2 import graph, where suites
// mock @/lib/config with partial objects that carry no libDir.
function runRecordSchemaPath(): string {
  const codeRoot = process.env.MENTIKO_CODE_ROOT || resolve(process.cwd(), "..");
  const libDir = process.env.LIB_DIR || join(codeRoot, "lib");
  return join(libDir, "schemas", "run.schema.json");
}

function loadRunRecordSchema(): object {
  const schemaPath = runRecordSchemaPath();
  try {
    return JSON.parse(readFileSync(schemaPath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load run record schema from ${schemaPath}: ${reason}`);
  }
}

function runRecordValidator(): ValidateFunction {
  if (!compiledRunRecordValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const fullDateTime = addFormats.get("date-time", "full") as { validate: (value: string) => boolean };
    ajv.addFormat("date-time", {
      validate: (value: string) => /^\d{4}-\d{2}-\d{2}[Tt]/.test(value) && fullDateTime.validate(value),
    });
    compiledRunRecordValidator = ajv.compile(loadRunRecordSchema());
  }
  return compiledRunRecordValidator;
}

/** Validate only the physical JSON file representation. */
export function validateRawRunRecord(content: string): RunRecordRawValidation {
  if (content.trim() === "") {
    return {
      valid: false,
      issues: [{ code: "empty-file", message: "Run record file must not be empty." }],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    return {
      valid: false,
      issues: [{
        code: "invalid-json",
        message: error instanceof Error ? error.message : "Run record is not valid JSON.",
      }],
    };
  }

  if (!isPlainRecord(value)) {
    return {
      valid: false,
      issues: [{ code: "invalid-root", message: "Run record JSON root must be an object." }],
    };
  }

  return { valid: true, value, issues: [] };
}

/** Validate the normalized object independently of its physical JSON encoding. */
export function validateRunRecord(value: unknown): RunRecordValidation {
  if (!isPlainRecord(value)) {
    return {
      valid: false,
      issues: [{ code: "invalid-record", message: "Run record must be an object." }],
    };
  }

  const validator = runRecordValidator();
  const issues = validator(value)
    ? []
    : (validator.errors ?? []).map(runRecordIssueFromSchemaError);

  if (Array.isArray(value.agents)) {
    const agentIds = value.agents
      .filter(isPlainRecord)
      .map((agent) => agent.id)
      .filter((id): id is string => typeof id === "string");
    if (new Set(agentIds).size !== agentIds.length) {
      issues.push({
        code: "duplicate-agent",
        field: "agents",
        message: "Run agents must not contain duplicate ids.",
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

export function parseRunRecord(content: string): RunRecord {
  const raw = validateRawRunRecord(content);
  if (!raw.valid || !raw.value) throw new RunRecordValidationError("raw", raw.issues);
  const normalized = validateRunRecord(raw.value);
  if (!normalized.valid) throw new RunRecordValidationError("normalized", normalized.issues);
  return raw.value as unknown as RunRecord;
}

export function assertRunRecord(value: unknown): asserts value is RunRecord {
  const validation = validateRunRecord(value);
  if (!validation.valid) throw new RunRecordValidationError("normalized", validation.issues);
}

export function isRunId(value: unknown): value is string {
  return typeof value === "string" && RUN_ID_PATTERN.test(value);
}

export function requireRunId(value: unknown): string {
  if (!isRunId(value)) throw new Error("Invalid run id.");
  return value;
}

export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (RUN_AGENT_STATUSES as readonly string[]).includes(value);
}

/** Resolve configured roots through existing symlink aliases without guessing a fallback root. */
export function canonicalizeRunsDir(runsDir: string): string {
  if (typeof runsDir !== "string" || runsDir.trim() === "") {
    throw new Error("Configured runs root is required.");
  }
  if (!isAbsolute(runsDir)) throw new Error("Configured runs root must be absolute.");

  const absolute = resolve(runsDir);
  const missingSegments: string[] = [];
  let existingAncestor = absolute;
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  if (!statSync(existingAncestor).isDirectory()) {
    throw new Error("Configured runs root must be a directory.");
  }
  return resolve(realpathSync(existingAncestor), ...missingSegments);
}

/** Resolve one run only under an explicit absolute configured runs root. */
export function resolveRunRecordPaths(runsDir: string, runId: string): RunRecordPaths {
  const canonicalRunsDir = canonicalizeRunsDir(runsDir);
  const canonicalRunId = requireRunId(runId);
  const runDir = resolve(canonicalRunsDir, canonicalRunId);
  const relation = relative(canonicalRunsDir, runDir);
  if (relation !== canonicalRunId || relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Run record path escapes the configured runs root.");
  }
  return {
    runsDir: canonicalRunsDir,
    runDir,
    runJsonPath: join(runDir, "run.json"),
  };
}

/** Resolve an existing run and prove its directory/file remain under the configured root. */
export function resolveExistingRunRecordPaths(runsDir: string, runId: string): RunRecordPaths {
  const paths = resolveRunRecordPaths(runsDir, runId);
  const runDirStat = lstatSync(paths.runDir);
  if (runDirStat.isSymbolicLink()) {
    throw new Error("Run directory must not be a symbolic link.");
  }
  if (!runDirStat.isDirectory()) throw new Error("Run record path must be a directory.");

  const realRunsDir = realpathSync(paths.runsDir);
  const realRunDir = realpathSync(paths.runDir);
  if (dirname(realRunDir) !== realRunsDir || basename(realRunDir) !== runId) {
    throw new Error("Run record path escapes the configured runs root.");
  }

  const runJsonPath = join(realRunDir, "run.json");
  const runJsonStat = lstatSync(runJsonPath);
  if (runJsonStat.isSymbolicLink()) {
    throw new Error("run.json must not be a symbolic link.");
  }
  if (!runJsonStat.isFile()) throw new Error("run.json must be a regular file.");
  const realRunJsonPath = realpathSync(runJsonPath);
  if (dirname(realRunJsonPath) !== realRunDir || basename(realRunJsonPath) !== "run.json") {
    throw new Error("run.json escapes the configured run directory.");
  }
  return {
    runsDir: realRunsDir,
    runDir: realRunDir,
    runJsonPath: realRunJsonPath,
  };
}

export function readRunRecordAt(runsDir: string, runId: string): RunRecord {
  const paths = resolveExistingRunRecordPaths(runsDir, runId);
  const record = parseRunRecord(readFileSync(paths.runJsonPath, "utf8"));
  if (record.id !== runId) {
    throw new RunRecordValidationError("normalized", [{
      code: "identity-mismatch",
      field: "id",
      message: `Run record id ${record.id} does not match directory ${runId}.`,
    }]);
  }
  return record;
}

/**
 * Project a validated persisted record into the stable list payload consumed by
 * the runs page, dashboards, notifications, and compare picker. Unknown
 * persistence extensions (including runnerV2 internals) are intentionally not
 * copied into the client contract.
 */
export function projectRunRecordForList(
  record: RunRecord,
  cost?: RunListCost,
): RunListRecord {
  return {
    id: record.id,
    chain: record.chain,
    ...(record.chainId !== undefined ? { chainId: record.chainId } : {}),
    goal: record.goal,
    started: record.started,
    ...(record.completed !== undefined ? { completed: record.completed } : {}),
    status: record.status,
    ...(record.status_message !== undefined ? { status_message: record.status_message } : {}),
    agents: record.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      session: agent.session,
      status: agent.status,
      ...(agent.started !== undefined ? { started: agent.started } : {}),
      ...(agent.completed !== undefined ? { completed: agent.completed } : {}),
    })),
    ...(record.sessions !== undefined ? { sessions: [...record.sessions] } : {}),
    ...(record.parent_run_id !== undefined ? { parent_run_id: record.parent_run_id } : {}),
    ...(record.workspaceId !== undefined ? { workspaceId: record.workspaceId } : {}),
    ...(record.workspacePath !== undefined ? { workspacePath: record.workspacePath } : {}),
    ...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
    ...(record.metadata !== undefined ? { metadata: record.metadata } : {}),
    ...(record.type !== undefined ? { type: record.type } : {}),
    ...(record.linkId !== undefined ? { linkId: record.linkId } : {}),
    ...(cost ?? {}),
  };
}

/**
 * Claim a new run directory and publish its complete run.json without overwrite.
 * An existing directory is a conflict even if its run.json is missing.
 */
export function createRunRecordFile(runsDir: string, record: RunRecord): RunRecordPaths {
  assertRunRecord(record);
  const paths = resolveRunRecordPaths(runsDir, record.id);
  mkdirSync(paths.runsDir, { recursive: true });
  try {
    mkdirSync(paths.runDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new RunRecordAlreadyExistsError(paths.runDir);
    }
    throw error;
  }

  try {
    writeRunJsonExclusive(paths.runJsonPath, record);
    return paths;
  } catch (error) {
    if (!existsSync(paths.runJsonPath)) {
      try { rmdirSync(paths.runDir); } catch { /* preserve non-empty evidence */ }
    }
    throw error;
  }
}

/**
 * Exclusively publish a run-local immutable chain snapshot before its run.json
 * becomes visible. This is the durability seam for callers that allocate a
 * run id before launching it: readers can never observe a valid new run record
 * that lacks the exact chain definition the launch must consume.
 */
export function createRunRecordWithSnapshot(
  runsDir: string,
  record: RunRecord,
  chainSnapshot: string,
): RunRecordPaths {
  assertRunRecord(record);
  if (!chainSnapshot.trim()) throw new Error("Run chain snapshot must not be empty.");
  const paths = resolveRunRecordPaths(runsDir, record.id);
  const snapshotPath = join(paths.runDir, "chain.json");
  mkdirSync(paths.runsDir, { recursive: true });
  try {
    mkdirSync(paths.runDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new RunRecordAlreadyExistsError(paths.runDir);
    throw error;
  }

  try {
    // `wx` is deliberate: no caller may replace a snapshot in a claimed run.
    writeFileSync(snapshotPath, chainSnapshot, { encoding: "utf8", mode: 0o600, flag: "wx" });
    writeRunJsonExclusive(paths.runJsonPath, record);
    return paths;
  } catch (error) {
    // This call alone created the directory. Remove only our exact private
    // files; a concurrent/foreign file turns cleanup into a harmless no-op.
    try { unlinkSync(snapshotPath); } catch { /* snapshot was never published or is preserved on interference */ }
    try { rmdirSync(paths.runDir); } catch { /* non-empty evidence is never deleted */ }
    throw error;
  }
}

export function mutateRunRecordFile(
  runJsonPath: string,
  update: (record: RunRecord) => RunRecord,
): RunRecord {
  return withRunJsonLock(runJsonPath, () => {
    if (!existsSync(runJsonPath)) throw new Error(`run.json not found: ${runJsonPath}`);
    const current = parseRunRecord(readFileSync(runJsonPath, "utf8"));
    const next = update(current);
    assertRunRecord(next);
    if (next.id !== current.id) {
      throw new RunRecordValidationError("normalized", [{
        code: "identity-mismatch",
        field: "id",
        message: "Run record mutation must not change id.",
      }]);
    }
    writeRunJsonAtomic(runJsonPath, next);
    return next;
  });
}

function runRecordIssueFromSchemaError(error: ErrorObject): RunRecordIssue {
  let field = fieldFromInstancePath(error.instancePath);
  if (error.keyword === "required") {
    field = appendField(field, String((error.params as { missingProperty?: string }).missingProperty || ""));
  } else if (error.keyword === "additionalProperties") {
    field = appendField(field, String((error.params as { additionalProperty?: string }).additionalProperty || ""));
  }

  let code: RunRecordIssueCode;
  if (error.keyword === "required") code = "missing-field";
  else if (error.keyword === "type") code = "invalid-field-type";
  else if (error.keyword === "minLength") code = "empty-field";
  else if (error.keyword === "pattern" && field === "id") code = "invalid-run-id";
  else if (error.keyword === "enum" && (field === "status" || field?.endsWith(".status"))) code = "invalid-status";
  else if (error.keyword === "format" && (error.params as { format?: string }).format === "date-time") {
    code = "invalid-timestamp";
  } else if (error.keyword === "uniqueItems" && field === "sessions") code = "duplicate-session";
  else if (error.keyword === "additionalProperties") code = "unknown-field";
  else code = "invalid-value";

  return {
    code,
    ...(field ? { field } : {}),
    message: `${field || "Run record"} ${error.message || `failed ${error.keyword} validation`}.`,
  };
}

function fieldFromInstancePath(instancePath: string): string | undefined {
  const segments = instancePath
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments.length === 0) return undefined;
  let result = "";
  for (const segment of segments) {
    result = /^\d+$/.test(segment) ? `${result}[${segment}]` : (appendField(result || undefined, segment) || "");
  }
  return result || undefined;
}

function appendField(prefix: string | undefined, field: string): string | undefined {
  if (!field) return prefix;
  return prefix ? `${prefix}.${field}` : field;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
