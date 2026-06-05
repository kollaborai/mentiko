import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import config from "../config";

export interface BackgroundWorkerStatus {
  status: "running" | "stopped";
  pid?: number;
  startedAt?: string;
  uptime?: number;
  lastCheck?: string;
  checkCount?: number;
  lastReconcile?: string;
  lastReconcileCleaned?: number;
  autoRun?: {
    status: "running" | "stopped";
    lastCheck?: string | null;
    checkCount?: number;
    lastTriggered?: number;
    lastError?: string | null;
  };
  note?: string;
}

const PID_FILE = join(config.stateDir, "background-worker.pid");
const STATUS_FILE = join(config.stateDir, "background-worker.json");

function ensureStateDir() {
  mkdirSync(config.stateDir, { recursive: true });
}

export function getBackgroundWorkerPaths() {
  return {
    pidFile: PID_FILE,
    statusFile: STATUS_FILE,
  };
}

export function readBackgroundWorkerPid(): number | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const raw = readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function writeBackgroundWorkerPid(pid: number) {
  ensureStateDir();
  writeFileSync(PID_FILE, String(pid));
}

export function clearBackgroundWorkerPid() {
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    // ignore cleanup failures
  }
}

export function readBackgroundWorkerStatusFile(): BackgroundWorkerStatus | null {
  try {
    if (!existsSync(STATUS_FILE)) return null;
    return JSON.parse(readFileSync(STATUS_FILE, "utf-8")) as BackgroundWorkerStatus;
  } catch {
    return null;
  }
}

export function writeBackgroundWorkerStatusFile(status: BackgroundWorkerStatus) {
  ensureStateDir();
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
