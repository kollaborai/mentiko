import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import config from "../config";
import {
  claimProcessIdentity,
  claimProcessIsAlive,
  withExclusiveFileClaim,
} from "@/lib/runner-v2/file-claim";

export interface BackgroundWorkerStatus {
  status: "running" | "stopped";
  pid?: number;
  startedAt?: string;
  uptime?: number;
  lastCheck?: string;
  checkCount?: number;
  lastReconcile?: string;
  lastReconcileCleaned?: number;
  lastExternalDrain?: string;
  lastExternalDispatched?: number;
  autoRun?: {
    status: "running" | "stopped";
    lastCheck?: string | null;
    checkCount?: number;
    lastTriggered?: number;
    lastError?: string | null;
  };
  chainWatcher?: {
    status: "running" | "stopped";
    startedAt?: string | null;
    lastCheck?: string | null;
    checkCount?: number;
    lastError?: string | null;
  };
  watchdog?: {
    status: "running" | "stopped";
    lastCheck?: string;
    checkCount?: number;
    lastStalled?: number;
    transportAvailable?: boolean;
    lastError?: string;
  };
  note?: string;
}

export interface BackgroundWorkerOwner {
  pid: number;
  processIdentity?: string;
}

export interface BackgroundWorkerStatePaths {
  pidFile: string;
  ownerFile: string;
  statusFile: string;
  lockDir: string;
}

const DEFAULT_PATHS: BackgroundWorkerStatePaths = {
  pidFile: join(config.stateDir, "background-worker.pid"),
  ownerFile: join(config.stateDir, "background-worker.owner.json"),
  statusFile: join(config.stateDir, "background-worker.json"),
  lockDir: join(config.stateDir, ".background-worker-state.claim"),
};

function ensureStateDir(paths: BackgroundWorkerStatePaths) {
  mkdirSync(dirname(paths.pidFile), { recursive: true });
}

export function getBackgroundWorkerPaths(): BackgroundWorkerStatePaths {
  return { ...DEFAULT_PATHS };
}

export function readBackgroundWorkerPid(paths = DEFAULT_PATHS): number | null {
  const owner = readBackgroundWorkerOwner(paths);
  if (owner) return owner.pid;
  return null;
}

export function captureBackgroundWorkerOwner(
  pid: number,
  identity: (pid: number) => string | undefined = claimProcessIdentity,
): BackgroundWorkerOwner {
  const processIdentity = identity(pid);
  return {
    pid,
    ...(processIdentity ? { processIdentity } : {}),
  };
}

export function registerBackgroundWorker(
  owner: BackgroundWorkerOwner,
  paths = DEFAULT_PATHS,
): BackgroundWorkerOwner {
  ensureStateDir(paths);
  withBackgroundWorkerStateLock(paths, () => {
    writeOwnerUnlocked(owner, paths);
    writeFileSync(paths.pidFile, String(owner.pid));
  });
  return { ...owner };
}

export function readBackgroundWorkerProcessIdentity(paths = DEFAULT_PATHS): string | undefined {
  return readBackgroundWorkerOwner(paths)?.processIdentity;
}

export function clearBackgroundWorkerPid(
  expected: BackgroundWorkerOwner,
  paths = DEFAULT_PATHS,
): boolean {
  return withBackgroundWorkerStateLock(paths, () => {
    if (!sameOwner(readBackgroundWorkerOwner(paths), expected)) return false;
    clearOwnerUnlocked(paths);
    return true;
  });
}

export function readBackgroundWorkerStatusFile(paths = DEFAULT_PATHS): BackgroundWorkerStatus | null {
  try {
    if (!existsSync(paths.statusFile)) return null;
    return JSON.parse(readFileSync(paths.statusFile, "utf-8")) as BackgroundWorkerStatus;
  } catch {
    return null;
  }
}

export function writeBackgroundWorkerStatusFile(
  expectedOwner: BackgroundWorkerOwner,
  status: BackgroundWorkerStatus,
  paths = DEFAULT_PATHS,
): boolean {
  ensureStateDir(paths);
  return withBackgroundWorkerStateLock(paths, () => {
    if (!sameOwner(readBackgroundWorkerOwner(paths), expectedOwner)) return false;
    writeStatusUnlocked(status, paths);
    return true;
  });
}

export function commitStoppedBackgroundWorkerState(
  observedOwner: BackgroundWorkerOwner,
  status: BackgroundWorkerStatus,
  paths = DEFAULT_PATHS,
  beforeMutation?: () => void,
): boolean {
  ensureStateDir(paths);
  return withBackgroundWorkerStateLock(paths, () => {
    if (!sameOwner(readBackgroundWorkerOwner(paths), observedOwner)) return false;
    beforeMutation?.();
    // An adversarial or pre-lock writer may have changed the registration.
    // Recheck immediately before the paired stopped-status/owner removal.
    if (!sameOwner(readBackgroundWorkerOwner(paths), observedOwner)) return false;
    writeStatusUnlocked(status, paths);
    clearOwnerUnlocked(paths);
    return true;
  });
}

export function isProcessAlive(pid: number): boolean {
  return claimProcessIsAlive(pid);
}

export function readBackgroundWorkerOwner(
  paths = DEFAULT_PATHS,
): BackgroundWorkerOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(paths.ownerFile, "utf8")) as Partial<BackgroundWorkerOwner>;
    return Number.isInteger(value.pid) && Number(value.pid) > 0
      ? {
          pid: Number(value.pid),
          ...(typeof value.processIdentity === "string"
            ? { processIdentity: value.processIdentity }
            : {}),
        }
      : undefined;
  } catch {
    try {
      const pid = Number.parseInt(readFileSync(paths.pidFile, "utf8").trim(), 10);
      return Number.isInteger(pid) && pid > 0 ? { pid } : undefined;
    } catch {
      return undefined;
    }
  }
}

function withBackgroundWorkerStateLock<T>(
  paths: BackgroundWorkerStatePaths,
  fn: () => T,
): T {
  return withExclusiveFileClaim(paths.lockDir, fn, { waitTimeoutMs: 2_000 });
}

function writeOwnerUnlocked(owner: BackgroundWorkerOwner, paths: BackgroundWorkerStatePaths): void {
  const tmp = `${paths.ownerFile}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
  renameSync(tmp, paths.ownerFile);
}

function writeStatusUnlocked(status: BackgroundWorkerStatus, paths: BackgroundWorkerStatePaths): void {
  const tmp = `${paths.statusFile}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tmp, JSON.stringify(status, null, 2));
  renameSync(tmp, paths.statusFile);
}

function clearOwnerUnlocked(paths: BackgroundWorkerStatePaths): void {
  rmSync(paths.ownerFile, { force: true });
  rmSync(paths.pidFile, { force: true });
}

function sameOwner(
  current: BackgroundWorkerOwner | undefined,
  expected: BackgroundWorkerOwner,
): boolean {
  return !!current
    && current.pid === expected.pid
    && current.processIdentity === expected.processIdentity;
}
