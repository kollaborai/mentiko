import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const JOB_TYPES = ["recommend", "generate", "link", "task", "agent", "artifact", "decision_research", "decision_steering", "decision_retrospective", "decision_guided_questions", "decision_guided_options", "decision_guided_plan", "preference_synthesis", "agent_edit", "webhook_inbound", "webhook_outbound", "event_trigger", "template_test", "link_summary", "task_run_summary"] as const;
export const JOB_STATUSES = ["pending", "running", "complete", "failed"] as const;

export type JobType = typeof JOB_TYPES[number];
export type JobStatus = typeof JOB_STATUSES[number];

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  taskId?: string;
  decisionId?: string;
  runId?: string;
  chainId?: string;
  createdBy?: string;
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  activity?: Array<{ time: string; msg: string }>;
}

export class JobRecordValidationError extends Error {
  constructor(message: string) { super(message); this.name = "JobRecordValidationError"; }
}

export function requireJobId(value: string): string {
  if (typeof value !== "string" || !JOB_ID_PATTERN.test(value)) throw new JobRecordValidationError("Invalid job id.");
  return value;
}

export function resolveJobRecordPaths(jobsDir: string, jobId: string): { jobsDir: string; jobPath: string } {
  if (!isAbsolute(jobsDir)) throw new JobRecordValidationError("Configured jobs root must be absolute.");
  const id = requireJobId(jobId);
  mkdirSync(jobsDir, { recursive: true });
  const root = resolve(jobsDir);
  const jobPath = resolve(root, `${id}.json`);
  if (relative(root, jobPath) !== `${id}.json` || dirname(jobPath) !== root) throw new JobRecordValidationError("Job path escapes configured root.");
  return { jobsDir: root, jobPath };
}

export function parseJobRecord(content: string): JobRecord {
  if (!content.trim()) throw new JobRecordValidationError("Job record must not be empty.");
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new JobRecordValidationError("Job record is not valid JSON."); }
  assertJobRecord(value);
  return value;
}

export function assertJobRecord(value: unknown): asserts value is JobRecord {
  if (!isRecord(value)) throw new JobRecordValidationError("Job record must be a JSON object.");
  requireJobId(requiredString(value.id, "id"));
  if (!(JOB_TYPES as readonly string[]).includes(String(value.type))) throw new JobRecordValidationError("Invalid job type.");
  if (!(JOB_STATUSES as readonly string[]).includes(String(value.status))) throw new JobRecordValidationError("Invalid job status.");
  if (!isRecord(value.input)) throw new JobRecordValidationError("Job input must be a JSON object.");
  requireTimestamp(requiredString(value.createdAt, "createdAt"), "createdAt");
  for (const key of ["taskId", "decisionId", "runId", "chainId", "createdBy", "error"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") throw new JobRecordValidationError(`Job ${key} must be a string.`);
  }
  for (const key of ["startedAt", "completedAt"] as const) if (value[key] !== undefined) requireTimestamp(value[key], key);
  if (value.result !== undefined && !isRecord(value.result)) throw new JobRecordValidationError("Job result must be a JSON object.");
  if (value.activity !== undefined) {
    if (!Array.isArray(value.activity)) throw new JobRecordValidationError("Job activity must be an array.");
    for (const entry of value.activity) {
      if (!isRecord(entry) || typeof entry.msg !== "string") throw new JobRecordValidationError("Invalid job activity entry.");
      requireTimestamp(entry.time, "activity.time");
    }
  }
  if (value.status === "pending" && (value.startedAt !== undefined || value.completedAt !== undefined)) {
    throw new JobRecordValidationError("Pending job cannot have lifecycle timestamps.");
  }
  if (value.status === "running" && value.startedAt === undefined) throw new JobRecordValidationError("Running job requires startedAt.");
  if ((value.status === "complete" || value.status === "failed") && value.completedAt === undefined) {
    throw new JobRecordValidationError("Terminal job requires completedAt.");
  }
  if (value.status === "complete" && value.error !== undefined) throw new JobRecordValidationError("Completed job cannot carry an error.");
  if (value.status === "failed" && (typeof value.error !== "string" || !value.error.trim())) throw new JobRecordValidationError("Failed job requires an error.");
}

export function readJobRecord(jobsDir: string, jobId: string): JobRecord | null {
  const { jobPath } = resolveJobRecordPaths(jobsDir, jobId);
  if (!existsSync(jobPath)) return null;
  if (lstatSync(jobPath).isSymbolicLink()) throw new JobRecordValidationError("Job record is unsafe.");
  const record = parseJobRecord(readFileSync(jobPath, "utf8"));
  if (record.id !== jobId || basename(jobPath, ".json") !== jobId) throw new JobRecordValidationError("Job identity does not match record path.");
  return record;
}

export function writeJobRecord(jobsDir: string, record: JobRecord): JobRecord {
  assertJobRecord(record);
  const { jobPath } = resolveJobRecordPaths(jobsDir, record.id);
  writeAtomic(jobPath, record);
  return record;
}

export function mutateJobRecord(jobsDir: string, jobId: string, mutation: (current: JobRecord) => JobRecord): JobRecord {
  const current = readJobRecord(jobsDir, jobId);
  if (!current) throw new JobRecordValidationError(`Job ${jobId} not found.`);
  const next = mutation(JSON.parse(JSON.stringify(current)) as JobRecord);
  if (next.id !== current.id) throw new JobRecordValidationError("Job mutations cannot change identity.");
  return writeJobRecord(jobsDir, next);
}

function writeAtomic(path: string, value: JobRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new JobRecordValidationError(`Job ${field} must be a non-empty string.`);
  return value;
}

function requireTimestamp(value: unknown, field: string): void {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new JobRecordValidationError(`Job ${field} must be an ISO timestamp.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
