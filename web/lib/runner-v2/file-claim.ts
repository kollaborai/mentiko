import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { createHash, randomUUID } from "crypto";
import { execFileSync } from "child_process";

const DEFAULT_FRESH_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 250;
const DEFAULT_RETRY_DELAY_MS = 10;

interface ClaimOwner {
  pid: number;
  token: string;
  processIdentity?: string;
}

interface HeldDirectoryClaim {
  owner: ClaimOwner;
  owns(): boolean;
  release(): void;
}

export interface ExclusiveFileClaimOptions {
  pid?: number;
  freshMs?: number;
  waitTimeoutMs?: number;
  retryDelayMs?: number;
  isProcessAlive?: (pid: number) => boolean;
  processIdentity?: (pid: number) => string | undefined;
  /** Deterministic filesystem-failure hook used by release protocol tests. */
  removeDirectoryAttempt?: (path: string) => void;
  /** Deterministic race hook used by the claim protocol test. */
  beforeStaleRetirement?: () => void;
}

export class ExclusiveFileClaimBusyError extends Error {
  constructor(readonly claimDir: string) {
    super(`file claim already held: ${claimDir}`);
    this.name = "ExclusiveFileClaimBusyError";
  }
}

/**
 * Run work while holding a mkdir-backed claim. Stale retirement is serialized
 * by an owner-bearing reaper claim. Both stale claims are moved to unique
 * quarantine paths and their observed owner token is verified before deletion.
 * A crashed reaper is recoverable, while fencing prevents an old cleanup or
 * release from deleting a replacement reaper.
 */
export function withExclusiveFileClaim<T>(
  claimDir: string,
  fn: () => T,
  options: ExclusiveFileClaimOptions = {},
): T {
  const release = acquireExclusiveFileClaim(claimDir, options);
  try {
    const value = fn();
    if (isPromiseLike(value)) {
      return Promise.resolve(value).finally(release) as T;
    }
    release();
    return value;
  } catch (error) {
    release();
    throw error;
  }
}

export function acquireExclusiveFileClaim(
  claimDir: string,
  options: ExclusiveFileClaimOptions,
): () => void {
  const deadline = Date.now() + (options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
  while (true) {
    try {
      return tryAcquireExclusiveFileClaim(claimDir, options);
    } catch (error) {
      if (!(error instanceof ExclusiveFileClaimBusyError) || Date.now() >= deadline) throw error;
      waitSynchronously(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    }
  }
}

function tryAcquireExclusiveFileClaim(
  claimDir: string,
  options: ExclusiveFileClaimOptions,
): () => void {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isProcessAlive ?? processIsAlive;
  const identity = options.processIdentity ?? claimProcessIdentity;
  const freshMs = options.freshMs ?? DEFAULT_FRESH_MS;
  const reaperDir = `${claimDir}.reaper`;
  mkdirSync(dirname(claimDir), { recursive: true });
  cleanupOrphanedReleaseQuarantines(claimDir, isAlive, identity, freshMs);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (existsSync(reaperDir)) {
      const reaper = acquireReaperClaim(reaperDir, {
        pid,
        isAlive,
        identity,
        freshMs,
        removeDirectoryAttempt: options.removeDirectoryAttempt,
      });
      reaper.release();
      continue;
    }
    const owner = newOwner(pid, identity);
    try {
      const held = createOwnedDirectoryClaim(claimDir, owner, options.removeDirectoryAttempt);
      if (existsSync(reaperDir)) {
        held.release();
        continue;
      }
      return held.release;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }

    const observed = readOwner(claimDir);
    if (
      (observed && ownerIsAlive(observed, isAlive, identity))
      || (!observed && claimAgeMs(claimDir) < freshMs)
    ) {
      throw new ExclusiveFileClaimBusyError(claimDir);
    }

    const reaper = acquireReaperClaim(reaperDir, {
      pid,
      isAlive,
      identity,
      freshMs,
      removeDirectoryAttempt: options.removeDirectoryAttempt,
    });

    try {
      const current = readOwner(claimDir);
      const ownerChanged = !sameOwner(observed, current);
      if (
        ownerChanged
        || (current && ownerIsAlive(current, isAlive, identity))
        || (!current && claimAgeMs(claimDir) < freshMs)
      ) {
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      options.beforeStaleRetirement?.();
      if (!reaper.owns()) throw new ExclusiveFileClaimBusyError(claimDir);
      const quarantine = `${claimDir}.stale-${process.pid}-${randomUUID()}`;
      try {
        renameSync(claimDir, quarantine);
      } catch (error) {
        if (isNotFound(error)) continue;
        throw error;
      }
      const moved = readOwner(quarantine);
      if (!sameOwner(observed, moved) || !reaper.owns()) {
        restoreQuarantine(quarantine, claimDir);
        throw new ExclusiveFileClaimBusyError(claimDir);
      }
      rmSync(quarantine, { recursive: true, force: true });
    } finally {
      reaper.release();
    }
  }

  throw new ExclusiveFileClaimBusyError(claimDir);
}

function acquireReaperClaim(
  reaperDir: string,
  input: {
    pid: number;
    isAlive: (pid: number) => boolean;
    identity: (pid: number) => string | undefined;
    freshMs: number;
    removeDirectoryAttempt?: (path: string) => void;
  },
): HeldDirectoryClaim {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const owner = newOwner(input.pid, input.identity);
    try {
      return createOwnedDirectoryClaim(reaperDir, owner, input.removeDirectoryAttempt);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }

    const observed = readOwner(reaperDir);
    if (
      (observed && ownerIsAlive(observed, input.isAlive, input.identity))
      || (!observed && claimAgeMs(reaperDir) < input.freshMs)
    ) {
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }

    const quarantine = `${reaperDir}.stale-${process.pid}-${randomUUID()}`;
    try {
      renameSync(reaperDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(observed, moved)) {
      restoreQuarantine(quarantine, reaperDir);
      throw new ExclusiveFileClaimBusyError(reaperDir);
    }
    removeDirectoryWithRetries(quarantine, input.removeDirectoryAttempt);
  }
  throw new ExclusiveFileClaimBusyError(reaperDir);
}

function createOwnedDirectoryClaim(
  claimDir: string,
  owner: ClaimOwner,
  removeDirectoryAttempt?: (path: string) => void,
): HeldDirectoryClaim {
  const candidate = `${claimDir}.candidate-${owner.pid}-${owner.token}`;
  mkdirSync(candidate);
  try {
    writeFileSync(ownerPath(candidate), `${JSON.stringify(owner)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(candidate, claimDir);
  } catch (error) {
    rmSync(candidate, { recursive: true, force: true });
    throw error;
  }
  return {
    owner,
    owns: () => sameOwner(readOwner(claimDir), owner),
    release: claimRelease(claimDir, owner, removeDirectoryAttempt),
  };
}

function claimRelease(
  claimDir: string,
  owner: ClaimOwner,
  removeDirectoryAttempt?: (path: string) => void,
): () => void {
  let released = false;
  return () => {
    if (released) return;
    const current = readOwner(claimDir);
    if (!sameOwner(current, owner)) return;
    const quarantine = `${claimDir}.release-${owner.pid}-${owner.token}`;
    try {
      // Vacate the canonical slot atomically, then clean only this owner's
      // token-specific quarantine. A successor can publish immediately after
      // the rename without becoming a child of our recursive removal.
      renameSync(claimDir, quarantine);
    } catch (error) {
      if (isNotFound(error)) released = true;
      else throw error;
      return;
    }
    const moved = readOwner(quarantine);
    if (!sameOwner(moved, owner)) {
      restoreQuarantine(quarantine, claimDir);
      return;
    }
    try {
      removeDirectoryWithRetries(quarantine, removeDirectoryAttempt);
      released = true;
    } catch {
      // The canonical slot is already safely vacated. Never move this cleanup
      // orphan back over a successor or fail completed work; a future process
      // reaps it after the recorded owner is no longer live.
      released = true;
    }
  };
}

function restoreQuarantine(quarantine: string, canonical: string): void {
  if (existsSync(canonical)) return;
  try { renameSync(quarantine, canonical); } catch {}
}

function sameOwner(left: ClaimOwner | undefined, right: ClaimOwner | undefined): boolean {
  if (!left || !right) return !left && !right;
  return left.pid === right.pid
    && left.token === right.token
    && left.processIdentity === right.processIdentity;
}

function ownerPath(claimDir: string): string {
  return `${claimDir}/owner.json`;
}

function readOwner(claimDir: string): ClaimOwner | undefined {
  try {
    const value = JSON.parse(readFileSync(ownerPath(claimDir), "utf8")) as Partial<ClaimOwner>;
    return Number.isInteger(value.pid) && Number(value.pid) > 0 && typeof value.token === "string"
      ? {
          pid: Number(value.pid),
          token: value.token,
          ...(typeof value.processIdentity === "string"
            ? { processIdentity: value.processIdentity }
            : {}),
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function claimAgeMs(claimDir: string): number {
  try {
    return Math.max(0, Date.now() - statSync(claimDir).mtimeMs);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}

export function claimProcessIsAlive(pid: number): boolean {
  return processIsAlive(pid);
}

export function claimProcessIdentity(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingParen = stat.lastIndexOf(")");
    const fields = stat.slice(closingParen + 2).split(" ");
    if (fields[19]) return `proc:${fields[19]}`;
  } catch {}
  try {
    const value = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value ? `ps:${value}` : undefined;
  } catch {
    return undefined;
  }
}

export function claimProcessIdentityHash(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

export function claimProcessMatchesIdentity(
  pid: number,
  recordedIdentity: string | undefined,
  isAlive: (pid: number) => boolean = claimProcessIsAlive,
  identity: (pid: number) => string | undefined = claimProcessIdentity,
): boolean {
  if (!isAlive(pid)) return false;
  if (!recordedIdentity) return true;
  const currentIdentity = identity(pid);
  return currentIdentity === undefined || currentIdentity === recordedIdentity;
}

function newOwner(pid: number, identity: (pid: number) => string | undefined): ClaimOwner {
  const value = identity(pid);
  return {
    pid,
    token: randomUUID(),
    ...(value ? { processIdentity: value } : {}),
  };
}

function ownerIsAlive(
  owner: ClaimOwner,
  isAlive: (pid: number) => boolean,
  identity: (pid: number) => string | undefined,
): boolean {
  return claimProcessMatchesIdentity(owner.pid, owner.processIdentity, isAlive, identity);
}

function waitSynchronously(timeoutMs: number): void {
  if (timeoutMs <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, timeoutMs);
}

function removeDirectoryWithRetries(
  path: string,
  attemptRemoval: (path: string) => void = (target) => {
    rmSync(target, { recursive: true, force: true });
  },
): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      attemptRemoval(path);
      return;
    } catch (error) {
      if (attempt >= 3 || !isTransientRemoveError(error)) throw error;
      waitSynchronously(10);
    }
  }
}

function cleanupOrphanedReleaseQuarantines(
  claimDir: string,
  isAlive: (pid: number) => boolean,
  identity: (pid: number) => string | undefined,
  freshMs: number,
): void {
  const parent = dirname(claimDir);
  const prefix = `${basename(claimDir)}.release-`;
  let entries: string[];
  try { entries = readdirSync(parent); } catch { return; }
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const path = join(parent, entry);
    const owner = readOwner(path);
    if (
      (owner && ownerIsAlive(owner, isAlive, identity))
      || (!owner && claimAgeMs(path) < freshMs)
    ) continue;
    try { removeDirectoryWithRetries(path); } catch {}
  }
}

function isTransientRemoveError(error: unknown): boolean {
  return ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]
    .some((code) => hasCode(error, code));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && (typeof value === "object" || typeof value === "function")
    && "then" in value && typeof value.then === "function";
}

function isAlreadyExists(error: unknown): boolean {
  return hasCode(error, "EEXIST") || hasCode(error, "ENOTEMPTY");
}

function isNotFound(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}
