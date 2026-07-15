import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { decodeRawChainDefinition } from "@/lib/runner-v2/chain-contract";
import { calculateCronNextRun } from "@/lib/schedules/cron-next-run";

type State = Record<string, number>;
type RecordValue = Record<string, unknown>;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function asRecord(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RecordValue;
}

function assertDirectory(path: string, label: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a non-symlink directory: ${path}`);
}

function assertRegularFile(path: string, label: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`${label} must be a non-symlink regular file: ${path}`);
}

function containedChainFile(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  assertDirectory(resolvedRoot, "Configured chains directory");
  if (!resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) throw new Error(`Chain path escapes configured chains directory: ${candidate}`);
  assertRegularFile(resolvedCandidate, "Chain definition");
  return resolvedCandidate;
}

function safeScheduleId(scheduleId: string): string {
  if (!SAFE_ID.test(scheduleId)) throw new Error(`Schedule id is not safe: ${scheduleId}`);
  return scheduleId;
}

function validateSchedulesDir(schedulesDir: string): string {
  const resolved = resolve(schedulesDir);
  if (!resolved || resolved === sep) throw new Error("Schedules directory must be a concrete path");
  if (!existsSync(resolved)) mkdirSync(resolved, { recursive: true, mode: 0o700 });
  assertDirectory(resolved, "Schedules directory");
  return resolved;
}

export interface NormalizedEmbeddedSchedule {
  chainPath: string;
  chainName: string;
  scheduleId: string;
  cron: string;
  timezone: string;
}

export function scheduleIdForChain(chainPath: string, chainDir: string): string {
  const safeChainPath = containedChainFile(chainDir, chainPath);
  const path = relative(resolve(chainDir), safeChainPath).split(sep).join("_");
  if (!path || path === basename(safeChainPath) && dirname(safeChainPath) === resolve(chainDir)) return safeScheduleId(path || basename(safeChainPath));
  return safeScheduleId(path);
}

export function decodeEmbeddedSchedule(chainPath: string, chainDir: string): NormalizedEmbeddedSchedule | null {
  const safeChainPath = containedChainFile(chainDir, chainPath);
  readFileSync(safeChainPath, "utf8");
  const raw = decodeRawChainDefinition(safeChainPath);
  const config = raw.config === undefined ? {} : asRecord(raw.config, "chain.config");
  const schedule = config.schedule;
  if (schedule === undefined || schedule === null || schedule === "") return null;
  let cron = "";
  let timezone = typeof config.timezone === "string" && config.timezone ? config.timezone : "UTC";
  if (typeof schedule === "string") {
    cron = schedule;
  } else {
    const nested = asRecord(schedule, "chain.config.schedule");
    if (typeof nested.cron !== "string" || !nested.cron.trim()) throw new Error("chain.config.schedule.cron must be a non-empty string");
    cron = nested.cron;
    if (nested.timezone !== undefined) {
      if (typeof nested.timezone !== "string" || !nested.timezone.trim()) throw new Error("chain.config.schedule.timezone must be a non-empty string");
      timezone = nested.timezone;
    }
  }
  if (!cron.trim()) return null;
  return {
    chainPath: safeChainPath,
    chainName: typeof raw.name === "string" ? raw.name : "",
    scheduleId: scheduleIdForChain(safeChainPath, chainDir),
    cron,
    timezone,
  };
}

export function validateCron(cron: string): string | null {
  const partCount = cron.trim() ? cron.trim().split(/\s+/).length : 0;
  return partCount === 5 || partCount === 6 ? null : "must have 5 or 6 space-separated parts";
}

export function calculateNextRunSeconds(cron: string, afterSeconds = Math.floor(Date.now() / 1000)): number {
  if (validateCron(cron)) return 0;
  const next = calculateCronNextRun(cron, { afterMs: afterSeconds * 1000 });
  const millis = next ? Date.parse(next) : Number.NaN;
  return Number.isFinite(millis) ? Math.floor(millis / 1000) : 0;
}

function statePath(schedulesDir: string): string { return join(validateSchedulesDir(schedulesDir), "state.json"); }
function statusPath(schedulesDir: string, scheduleId: string): string { return join(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.status`); }
function lockPath(schedulesDir: string, scheduleId: string): string { return join(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.lock`); }
function pidPath(schedulesDir: string, scheduleId: string): string { return join(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.pid`); }
function historyPath(schedulesDir: string, scheduleId: string): string { return join(validateSchedulesDir(schedulesDir), `${safeScheduleId(scheduleId)}.history`); }

function readRawScheduleState(schedulesDir: string): unknown {
  const path = statePath(schedulesDir);
  if (!existsSync(path)) return {};
  assertRegularFile(path, "Schedule state");
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error(`Schedule state is not valid JSON: ${path}`); }
  return parsed;
}

function normalizeScheduleState(parsed: unknown): State {
  const record = asRecord(parsed, "schedule state");
  const normalized: State = {};
  for (const [id, value] of Object.entries(record)) {
    safeScheduleId(id);
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Schedule state ${id} must be a non-negative integer`);
    normalized[id] = value;
  }
  return normalized;
}

function readState(schedulesDir: string): State { return normalizeScheduleState(readRawScheduleState(schedulesDir)); }

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  assertDirectory(dirname(path), "Schedule record parent");
  if (existsSync(path)) assertRegularFile(path, "Schedule record");
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, path);
}

function withStateLock<T>(schedulesDir: string, operation: () => T): T {
  const directory = validateSchedulesDir(schedulesDir);
  mkdirSync(directory, { recursive: true });
  const lock = join(directory, ".state.lock");
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw new Error(`Unable to acquire schedule state lock: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return operation(); } finally { rmdirSync(lock); }
}

export function getScheduleState(schedulesDir: string, scheduleId: string): number {
  return readState(schedulesDir)[safeScheduleId(scheduleId)] || 0;
}

export function initializeScheduleState(schedulesDir: string): void {
  withStateLock(schedulesDir, () => {
    const path = statePath(schedulesDir);
    if (existsSync(path)) assertRegularFile(path, "Schedule state");
    else writeAtomic(path, "{}\n");
  });
}

export function setScheduleState(schedulesDir: string, scheduleId: string, timestamp: number): void {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Schedule timestamp must be a non-negative integer");
  withStateLock(schedulesDir, () => {
    const state = readState(schedulesDir);
    state[safeScheduleId(scheduleId)] = timestamp;
    writeAtomic(statePath(schedulesDir), `${JSON.stringify(state, null, 2)}\n`);
  });
}

export function scheduleEnabled(schedulesDir: string, schedule: NormalizedEmbeddedSchedule): boolean {
  const path = statusPath(schedulesDir, schedule.scheduleId);
  if (!existsSync(path)) return true;
  assertRegularFile(path, "Schedule status");
  const content = readFileSync(path, "utf8").trim();
  if (content === "enabled: true") return true;
  if (content === "enabled: false") return false;
  throw new Error(`Schedule status is invalid: ${path}`);
}

export function setScheduleEnabled(schedulesDir: string, scheduleId: string, enabled: boolean): void {
  writeAtomic(statusPath(schedulesDir, scheduleId), `enabled: ${enabled ? "true" : "false"}\n`);
}

export function scheduleRunning(schedulesDir: string, scheduleId: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const lock = lockPath(schedulesDir, scheduleId);
  if (!existsSync(lock)) return false;
  assertRegularFile(lock, "Schedule lock");
  const started = Number(readFileSync(lock, "utf8").trim());
  if (!Number.isSafeInteger(started) || nowSeconds - started >= 7200) { unlinkSync(lock); return false; }
  const pidFile = pidPath(schedulesDir, scheduleId);
  if (existsSync(pidFile)) assertRegularFile(pidFile, "Schedule pid");
  const pid = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : "");
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function scheduleDue(schedulesDir: string, schedule: NormalizedEmbeddedSchedule, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!scheduleEnabled(schedulesDir, schedule) || scheduleRunning(schedulesDir, schedule.scheduleId, nowSeconds)) return false;
  const lastRun = getScheduleState(schedulesDir, schedule.scheduleId);
  const next = calculateNextRunSeconds(schedule.cron, lastRun);
  return next > lastRun && next <= nowSeconds;
}

export function markScheduleRunStart(schedulesDir: string, scheduleId: string, pid: number, nowSeconds = Math.floor(Date.now() / 1000)): void {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) throw new Error("Schedule lock inputs are invalid");
  writeAtomic(lockPath(schedulesDir, scheduleId), `${nowSeconds}\n`);
  writeAtomic(pidPath(schedulesDir, scheduleId), `${pid}\n`);
}

export function markScheduleRunEnd(schedulesDir: string, scheduleId: string, status: string, timestamp = Math.floor(Date.now() / 1000)): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(status)) throw new Error("Schedule status is not safe");
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Schedule timestamp must be a non-negative integer");
  withStateLock(schedulesDir, () => {
    const state = readState(schedulesDir);
    state[safeScheduleId(scheduleId)] = timestamp;
    writeAtomic(statePath(schedulesDir), `${JSON.stringify(state, null, 2)}\n`);
    const lock = lockPath(schedulesDir, scheduleId);
    const pid = pidPath(schedulesDir, scheduleId);
    const history = historyPath(schedulesDir, scheduleId);
    if (existsSync(lock)) assertRegularFile(lock, "Schedule lock");
    if (existsSync(pid)) assertRegularFile(pid, "Schedule pid");
    if (existsSync(history)) assertRegularFile(history, "Schedule history");
    if (existsSync(lock)) unlinkSync(lock);
    if (existsSync(pid)) unlinkSync(pid);
    appendFileSync(history, `[${new Date(timestamp * 1000).toISOString()}] ${status}\n`, { mode: 0o600 });
  });
}
