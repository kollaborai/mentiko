import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export const BATCH_ID_PATTERN = /^batch-[A-Za-z0-9_-]{1,120}$/;
export const BATCH_CHAIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const BATCH_MODES = ["parallel", "sequential"] as const;
export const BATCH_STATUSES = ["running", "complete", "partial", "failed", "cancelled"] as const;
export const BATCH_CHAIN_STATUSES = ["pending", "running", "complete", "failed", "cancelled"] as const;

export type BatchMode = (typeof BATCH_MODES)[number];
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export type BatchChainStatus = (typeof BATCH_CHAIN_STATUSES)[number];

export interface BatchChainRecord {
  id: string;
  file: string;
  goal: string;
  status: BatchChainStatus;
  run_id?: string;
  started?: string;
  completed?: string;
  duration?: number;
  pid?: number;
}

export interface BatchRunRecord {
  id: string;
  mode: BatchMode;
  status: BatchStatus;
  started: string;
  completed?: string;
  cancel_requested_at?: string;
  status_message?: string;
  chains: BatchChainRecord[];
}

export interface BatchChainResult {
  chain_id: string;
  run_id: string;
  status: "complete" | "failed" | "cancelled";
  exit_code: number | null;
  started: string;
  completed: string;
  duration: number;
  output: string;
  error: string;
}

export interface BatchRunRecordWithResults extends Omit<BatchRunRecord, "chains"> {
  chains: Array<BatchChainRecord & Omit<Partial<BatchChainResult>, "chain_id" | "status">>;
}

export class BatchRunRecordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchRunRecordValidationError";
  }
}

export function mintBatchId(now = Date.now()): string {
  return `batch-${now}-${randomBytes(4).toString("hex")}`;
}

export function requireBatchId(value: unknown): string {
  if (typeof value !== "string" || !BATCH_ID_PATTERN.test(value)) throw new BatchRunRecordValidationError("Invalid batch id.");
  return value;
}

export function requireBatchChainId(value: unknown): string {
  if (typeof value !== "string" || !BATCH_CHAIN_ID_PATTERN.test(value)) throw new BatchRunRecordValidationError("Invalid batch chain id.");
  return value;
}

export function requireBatchMode(value: unknown): BatchMode {
  if (typeof value !== "string" || !(BATCH_MODES as readonly string[]).includes(value)) {
    throw new BatchRunRecordValidationError("Invalid batch mode.");
  }
  return value as BatchMode;
}

export function validateRawBatchRunRecord(content: string): Record<string, unknown> {
  if (content.trim() === "") throw new BatchRunRecordValidationError("Batch record must not be empty.");
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new BatchRunRecordValidationError("Batch record is not valid JSON."); }
  if (!isRecord(value)) throw new BatchRunRecordValidationError("Batch record root must be an object.");
  return value;
}

export function assertBatchRunRecord(value: unknown): asserts value is BatchRunRecord {
  if (!isRecord(value)) throw new BatchRunRecordValidationError("Batch record must be an object.");
  requireBatchId(value.id);
  requireBatchMode(value.mode);
  if (!(BATCH_STATUSES as readonly string[]).includes(String(value.status))) throw new BatchRunRecordValidationError("Invalid batch status.");
  requireTimestamp(value.started, "started");
  if (value.completed !== undefined) requireTimestamp(value.completed, "completed");
  if (value.cancel_requested_at !== undefined) requireTimestamp(value.cancel_requested_at, "cancel_requested_at");
  if (value.status_message !== undefined && (typeof value.status_message !== "string" || value.status_message.length > 2_000)) {
    throw new BatchRunRecordValidationError("Invalid batch status message.");
  }
  if (!Array.isArray(value.chains) || value.chains.length === 0 || value.chains.length > 50) {
    throw new BatchRunRecordValidationError("Batch record must contain 1-50 chains.");
  }
  const ids = new Set<string>();
  for (const chain of value.chains) {
    if (!isRecord(chain)) throw new BatchRunRecordValidationError("Batch chain must be an object.");
    const id = requireBatchChainId(chain.id);
    if (ids.has(id)) throw new BatchRunRecordValidationError("Batch chain ids must be unique.");
    ids.add(id);
    if (typeof chain.file !== "string" || !isAbsolute(chain.file)) throw new BatchRunRecordValidationError("Batch chain file must be absolute.");
    if (typeof chain.goal !== "string") throw new BatchRunRecordValidationError("Batch chain goal must be a string.");
    if (!(BATCH_CHAIN_STATUSES as readonly string[]).includes(String(chain.status))) throw new BatchRunRecordValidationError("Invalid batch chain status.");
    if (chain.run_id !== undefined && (typeof chain.run_id !== "string" || !/^run-[A-Za-z0-9_-]{1,120}$/.test(chain.run_id))) {
      throw new BatchRunRecordValidationError("Invalid batch chain run id.");
    }
    for (const key of ["started", "completed"] as const) if (chain[key] !== undefined) requireTimestamp(chain[key], `chain.${key}`);
    if (chain.duration !== undefined && (typeof chain.duration !== "number" || !Number.isInteger(chain.duration) || chain.duration < 0)) throw new BatchRunRecordValidationError("Invalid batch chain duration.");
    if (chain.pid !== undefined && (typeof chain.pid !== "number" || !Number.isInteger(chain.pid) || chain.pid <= 0)) throw new BatchRunRecordValidationError("Invalid batch chain pid.");
  }
}

export function parseBatchRunRecord(content: string): BatchRunRecord {
  const value = validateRawBatchRunRecord(content);
  assertBatchRunRecord(value);
  return value;
}

export function parseBatchChainResult(content: string): BatchChainResult {
  if (content.trim() === "") throw new BatchRunRecordValidationError("Batch result must not be empty.");
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new BatchRunRecordValidationError("Batch result is not valid JSON."); }
  assertBatchChainResult(value);
  return value;
}

export function canonicalizeBatchesDir(batchesDir: string): string {
  if (typeof batchesDir !== "string" || !isAbsolute(batchesDir)) throw new BatchRunRecordValidationError("Configured batches root must be absolute.");
  mkdirSync(batchesDir, { recursive: true });
  return realpathSync(batchesDir);
}

export function resolveBatchPaths(batchesDir: string, batchId: string): { batchesDir: string; batchDir: string; batchJsonPath: string } {
  const root = canonicalizeBatchesDir(batchesDir);
  const id = requireBatchId(batchId);
  const batchDir = resolve(root, id);
  const relation = relative(root, batchDir);
  if (relation !== id || relation.startsWith("..") || isAbsolute(relation)) throw new BatchRunRecordValidationError("Batch path escapes configured root.");
  return { batchesDir: root, batchDir, batchJsonPath: join(batchDir, "batch.json") };
}

export function resolveExistingBatchPaths(batchesDir: string, batchId: string): { batchesDir: string; batchDir: string; batchJsonPath: string } {
  const paths = resolveBatchPaths(batchesDir, batchId);
  if (!existsSync(paths.batchDir) || lstatSync(paths.batchDir).isSymbolicLink()) throw new BatchRunRecordValidationError("Batch directory is missing or unsafe.");
  if (!existsSync(paths.batchJsonPath) || lstatSync(paths.batchJsonPath).isSymbolicLink()) throw new BatchRunRecordValidationError("Batch record is missing or unsafe.");
  const realDir = realpathSync(paths.batchDir);
  const realRoot = realpathSync(paths.batchesDir);
  if (dirname(realDir) !== realRoot || basename(realDir) !== batchId) throw new BatchRunRecordValidationError("Batch path escapes configured root.");
  const realJson = realpathSync(paths.batchJsonPath);
  if (dirname(realJson) !== realDir || basename(realJson) !== "batch.json") throw new BatchRunRecordValidationError("Batch record path escapes batch directory.");
  return { batchesDir: realRoot, batchDir: realDir, batchJsonPath: realJson };
}

/**
 * Publish a batch only after every immutable chain snapshot exists. A caller
 * crash can leave an ignored staging directory, never a live running record
 * whose chain files do not exist yet.
 */
export function publishPreparedBatchRunRecord(
  batchesDir: string,
  record: BatchRunRecord,
  snapshots: ReadonlyArray<{ chainId: string; content: string }>,
): { batchDir: string; batchJsonPath: string } {
  assertBatchRunRecord(record);
  const paths = resolveBatchPaths(batchesDir, record.id);
  if (snapshots.length !== record.chains.length) {
    throw new BatchRunRecordValidationError("Prepared batch snapshots must match every batch chain.");
  }
  const expected = new Set(record.chains.map((chain) => chain.id));
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    const chainId = requireBatchChainId(snapshot.chainId);
    if (!expected.has(chainId) || seen.has(chainId) || typeof snapshot.content !== "string") {
      throw new BatchRunRecordValidationError("Prepared batch snapshots do not match the batch record.");
    }
    seen.add(chainId);
  }
  if (existsSync(paths.batchDir)) throw new BatchRunRecordValidationError("Batch record already exists.");

  const stagingDir = resolve(paths.batchesDir, `.${record.id}.preparing-${process.pid}-${randomBytes(4).toString("hex")}`);
  if (dirname(stagingDir) !== paths.batchesDir) throw new BatchRunRecordValidationError("Batch staging path escapes configured root.");
  mkdirSync(stagingDir);
  try {
    for (const snapshot of snapshots) {
      const chainDir = join(stagingDir, snapshot.chainId);
      mkdirSync(chainDir);
      writeFileSync(join(chainDir, "chain.json"), snapshot.content, { encoding: "utf8", flag: "wx" });
    }
    writeJsonAtomic(join(stagingDir, "batch.json"), record);
    renameSync(stagingDir, paths.batchDir);
    return { batchDir: paths.batchDir, batchJsonPath: paths.batchJsonPath };
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export function readBatchRunRecord(batchesDir: string, batchId: string): BatchRunRecord {
  const { batchJsonPath } = resolveExistingBatchPaths(batchesDir, batchId);
  const record = parseBatchRunRecord(readFileSync(batchJsonPath, "utf8"));
  if (record.id !== batchId) throw new BatchRunRecordValidationError("Batch record id does not match directory.");
  return record;
}

export async function mutateBatchRunRecord(
  batchesDir: string,
  batchId: string,
  mutation: (record: BatchRunRecord) => BatchRunRecord,
): Promise<BatchRunRecord> {
  const paths = resolveExistingBatchPaths(batchesDir, batchId);
  const lockPath = `${paths.batchJsonPath}.lock`;
  await acquireLock(lockPath);
  try {
    const record = parseBatchRunRecord(readFileSync(paths.batchJsonPath, "utf8"));
    const next = mutation(JSON.parse(JSON.stringify(record)) as BatchRunRecord);
    assertBatchRunRecord(next);
    if (next.id !== batchId) throw new BatchRunRecordValidationError("Batch mutations cannot change identity.");
    writeJsonAtomic(paths.batchJsonPath, next);
    return next;
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

export function writeBatchChainResult(batchesDir: string, batchId: string, result: BatchChainResult): string {
  const paths = resolveExistingBatchPaths(batchesDir, batchId);
  assertBatchChainResult(result);
  const record = readBatchRunRecord(paths.batchesDir, batchId);
  const chain = record.chains.find((candidate) => candidate.id === result.chain_id);
  if (!chain || chain.run_id !== result.run_id) throw new BatchRunRecordValidationError("Batch result does not match the claimed batch chain run.");
  const chainDir = resolveExistingBatchChainDir(paths, result.chain_id);
  const target = join(chainDir, "result.json");
  writeJsonAtomic(target, result);
  return target;
}

/** Read a strict per-chain result. Missing results are normal while work is active. */
export function readBatchChainResult(batchesDir: string, batchId: string, chainId: string): BatchChainResult | null {
  const paths = resolveExistingBatchPaths(batchesDir, batchId);
  const id = requireBatchChainId(chainId);
  const record = readBatchRunRecord(paths.batchesDir, batchId);
  const chain = record.chains.find((candidate) => candidate.id === id);
  if (!chain) throw new BatchRunRecordValidationError("Batch chain is not part of this batch.");
  const chainDir = resolveExistingBatchChainDir(paths, id);
  const resultPath = join(chainDir, "result.json");
  if (!existsSync(resultPath)) return null;
  if (lstatSync(resultPath).isSymbolicLink()) throw new BatchRunRecordValidationError("Batch result is unsafe.");
  const realResult = realpathSync(resultPath);
  if (dirname(realResult) !== chainDir || basename(realResult) !== "result.json") {
    throw new BatchRunRecordValidationError("Batch result path escapes chain directory.");
  }
  const result = parseBatchChainResult(readFileSync(realResult, "utf8"));
  if (result.chain_id !== id || result.run_id !== chain.run_id) {
    throw new BatchRunRecordValidationError("Batch result does not match the batch record.");
  }
  return result;
}

/** API/UI projection: attach each strict result without making missing active results an error. */
export function readBatchRunRecordWithResults(batchesDir: string, batchId: string): BatchRunRecordWithResults {
  const record = readBatchRunRecord(batchesDir, batchId);
  return {
    ...record,
    chains: record.chains.map((chain) => {
      const result = readBatchChainResult(batchesDir, batchId, chain.id);
      return result ? { ...chain, ...result } : chain;
    }),
  };
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  renameSync(temporary, path);
}

function resolveExistingBatchChainDir(
  paths: { batchDir: string },
  chainId: string,
): string {
  const id = requireBatchChainId(chainId);
  const chainDir = resolve(paths.batchDir, id);
  if (relative(paths.batchDir, chainDir) !== id || isAbsolute(relative(paths.batchDir, chainDir))) {
    throw new BatchRunRecordValidationError("Batch chain path escapes batch directory.");
  }
  if (!existsSync(chainDir) || lstatSync(chainDir).isSymbolicLink()) {
    throw new BatchRunRecordValidationError("Batch chain directory is missing or unsafe.");
  }
  const realChainDir = realpathSync(chainDir);
  if (dirname(realChainDir) !== paths.batchDir || basename(realChainDir) !== id) {
    throw new BatchRunRecordValidationError("Batch chain path escapes batch directory.");
  }
  return realChainDir;
}

function assertBatchChainResult(value: unknown): asserts value is BatchChainResult {
  if (!isRecord(value)) throw new BatchRunRecordValidationError("Batch result must be an object.");
  requireBatchChainId(value.chain_id);
  if (typeof value.run_id !== "string" || !/^run-[A-Za-z0-9_-]{1,120}$/.test(value.run_id)) {
    throw new BatchRunRecordValidationError("Invalid batch result run id.");
  }
  if (!["complete", "failed", "cancelled"].includes(String(value.status))) {
    throw new BatchRunRecordValidationError("Invalid batch result status.");
  }
  if (typeof value.exit_code !== "number" && value.exit_code !== null) {
    throw new BatchRunRecordValidationError("Invalid batch result exit code.");
  }
  if (typeof value.exit_code === "number" && (!Number.isInteger(value.exit_code) || value.exit_code < 0)) {
    throw new BatchRunRecordValidationError("Invalid batch result exit code.");
  }
  requireTimestamp(value.started, "result.started");
  requireTimestamp(value.completed, "result.completed");
  if (typeof value.duration !== "number" || !Number.isInteger(value.duration) || value.duration < 0) {
    throw new BatchRunRecordValidationError("Invalid batch result duration.");
  }
  if (typeof value.output !== "string" || typeof value.error !== "string") {
    throw new BatchRunRecordValidationError("Invalid batch result output.");
  }
}

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try { mkdirSync(lockPath); return; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new BatchRunRecordValidationError("Timed out waiting for batch record lock.");
      await new Promise((resolveWait) => setTimeout(resolveWait, 15));
    }
  }
}

function requireTimestamp(value: unknown, field: string): void {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new BatchRunRecordValidationError(`Invalid ${field} timestamp.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
