/**
 * run.json single-writer lock (TypeScript side)
 *
 * THE PROBLEM (engine bug #7): three independent processes read-modify-write the
 * same run.json — the bash completion/monitor handlers (lib/run-lib.sh), the
 * typed watchdog, and the web heartbeat route. Each write is atomic in
 * isolation (write to a temp file then rename, so a READER never sees a half-written
 * file), but there is no mutual exclusion ACROSS writers: a classic lost update. An
 * agent-status write can be silently clobbered when a concurrent writer reads the
 * same base JSON, then renames its own full rewrite over the top — second write wins,
 * first write's change is gone.
 *
 * THE FIX: serialize the FULL read-modify-write behind ONE lock taken adjacent to the
 * file. This module implements, byte-for-byte in protocol, the same mkdir-based lock
 * the bash side uses (lib/run-lib.sh `_run_lock_*` / `_with_run_lock`, itself modeled
 * on the fan-group lock in lib/routing-lib.sh). Because both sides use the SAME lock
 * directory (`${runJsonPath}.lock/`) and the same PID liveness proof, a node writer and
 * a bash writer mutually exclude on the same file.
 *
 * INVARIANT — READS STAY LOCK-FREE. Writers always write-temp-then-rename (rename is
 * atomic on POSIX), so any reader (every GET route, the reconciler, bash `jq`) sees
 * either the pre- or post-write file, never a partial one. The lock exists ONLY to
 * prevent writer-vs-writer lost updates; it is never taken to read. Callers MUST do
 * the read INSIDE the locked section (re-read after acquiring) so they modify the
 * latest committed state, and MUST write via {@link writeRunJsonAtomic} (temp+rename),
 * never a bare writeFileSync over the live path.
 *
 * Why mkdir and not flock / a lockfile lib: mkdir(2) is atomic on POSIX filesystems
 * (exactly one caller wins the create when the dir is absent), needs ZERO npm
 * dependencies, and is portable to the macOS dev box and the linux tenant container
 * alike. Both implementations publish a PID plus a per-acquisition owner token so
 * release can identify exactly the lock instance it acquired.
 *
 * Cross-language protocol:
 *   - lock dir:        `${runJsonPath}.lock/`
 *   - holder pid file: `${lock}/pid` containing the writer's PID as decimal text
 *   - owner file:      `${lock}/owner` containing a random per-acquisition token
 *                      (older abandoned locks without one remain dead-recoverable)
 *   - liveness check:  a bash holder's pid is checkable from node via
 *                      process.kill(pid, 0) (ESRCH => dead); a node holder's pid is
 *                      checkable from bash via kill -0. Same syscall, both directions.
 *   - stale-break:     TS breaks only a holder whose PID is provably dead. Lock age
 *                      is never ownership proof: a long-running live writer remains live.
 *                      lib/run-lib.sh uses the same dead-PID-only takeover and
 *                      fail-closed timeout behavior.
 *   - wait budget:     RUN_LOCK_WAIT_SECS is a count of ~50ms spin ticks (same as the
 *                      bash loop's `sleep 0.05; waited++`), so both sides give up after
 *                      ~RUN_LOCK_WAIT_SECS * 50ms and never hang the request/engine.
 *
 * TIMEOUT POLICY (never hang, never write unlocked): bounded-wait expiry throws a
 * typed error before the critical section runs. Callers may retry or reconcile, but
 * they may never trade mutual exclusion for a last-writer-wins update.
 */

import { randomUUID } from "crypto";
import { linkSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync } from "fs";

/** Parse an env knob to a non-negative integer, falling back ONLY when unset/NaN.
 *  (Plain `Number(x) || default` would coerce a legitimate 0 to the default.) */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Max number of ~50ms spin ticks to wait for the lock (mirrors the bash loop). */
const RUN_LOCK_WAIT_TICKS = envInt("RUN_LOCK_WAIT_SECS", 30);
/** Duration of one spin tick, in ms. Matches the bash side's `sleep 0.05`. */
const TICK_MS = 50;
/** An uninitialized takeover claim older than this is an abandoned legacy/incomplete claim. */
const TAKEOVER_CLAIM_INIT_GRACE_MS = 1_000;

/** Sleep ~ms synchronously without pegging the CPU and without making the caller async. */
function sleepSyncMs(ms: number): void {
  // Atomics.wait on a throwaway SharedArrayBuffer is a dependency-free, synchronous
  // sleep available in Node. It parks the thread (no busy spin) for `ms`.
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // Atomics.wait can be disallowed on the main thread in some runtimes; fall back
    // to a short bounded busy-wait so we still back off rather than hot-loop.
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

interface LockSnapshot {
  pidText: string;
  ownerToken?: string;
}

function readLockSnapshot(lockDir: string): LockSnapshot | undefined {
  let pidText = "";
  try {
    pidText = readFileSync(`${lockDir}/pid`, "utf-8").trim();
  } catch {
    return undefined;
  }
  let ownerToken: string | undefined;
  try {
    ownerToken = readFileSync(`${lockDir}/owner`, "utf-8").trim() || undefined;
  } catch {
    // A pre-token abandoned lock may not have an owner file.
  }
  return { pidText, ownerToken };
}

/** True iff the snapshotted PID is provably gone. EPERM remains live. */
function snapshotHolderIsDead(snapshot: LockSnapshot): boolean {
  const pid = Number(snapshot.pidText);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // signal 0 performs error checking without sending a signal: throws ESRCH if the
    // process does not exist. Works for a bash holder PID just as kill -0 does.
    process.kill(pid, 0);
    return false; // process exists — holder alive
  } catch (err) {
    // ESRCH => no such process (dead). EPERM => exists but not ours (treat as alive).
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function snapshotsEqual(left: LockSnapshot, right: LockSnapshot | undefined): boolean {
  return right !== undefined
    && left.pidText === right.pidText
    && left.ownerToken === right.ownerToken;
}

/**
 * Acquire the run.json lock by spinning on an atomic mkdir; break only a lock
 * whose snapshotted PID is still provably dead after an atomic quarantine rename.
 * Returns this acquisition's owner token, or undefined on wait-budget expiry.
 * Mirrors lib/run-lib.sh `_run_lock_acquire`.
 */
function acquireLock(lockDir: string): string | undefined {
  let waited = 0;
  for (;;) {
    const ownerToken = randomUUID();
    let created = false;
    try {
      mkdirSync(lockDir); // atomic: throws EEXIST if another holder already created it
      created = true;
      try {
        // The token is mandatory: release cannot safely identify its lock instance
        // without it. PID remains decimal-only for legacy shell kill -0 checks.
        writeFileSync(`${lockDir}/owner`, ownerToken, { flag: "wx" });
        writeFileSync(`${lockDir}/pid`, String(process.pid), { flag: "wx" });
      } catch (error) {
        cleanupIncompleteAcquisition(lockDir, ownerToken);
        throw error;
      }
      return ownerToken;
    } catch (error) {
      if (created) throw error;
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const snapshot = readLockSnapshot(lockDir);
      if (snapshot && snapshotHolderIsDead(snapshot)) {
        if (breakDeadLock(lockDir, snapshot)) continue;
      }
      if (waited >= RUN_LOCK_WAIT_TICKS) return undefined;
      sleepSyncMs(TICK_MS);
      waited += 1;
    }
  }
}

function breakDeadLock(lockDir: string, observed: LockSnapshot): boolean {
  const takeoverClaim = `${lockDir}.takeover`;
  const claimOwner = randomUUID();
  try {
    mkdirSync(takeoverClaim);
    try {
      writeFileSync(`${takeoverClaim}/owner`, claimOwner, { flag: "wx" });
      writeFileSync(`${takeoverClaim}/pid`, String(process.pid), { flag: "wx" });
    } catch (error) {
      cleanupIncompleteAcquisition(takeoverClaim, claimOwner);
      throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return recoverAbandonedTakeoverClaim(takeoverClaim)
        ? breakDeadLock(lockDir, observed)
        : false;
    }
    throw error;
  }

  const quarantined = `${lockDir}.stale-${randomUUID()}`;
  try {
    const current = readLockSnapshot(lockDir);
    if (!snapshotsEqual(observed, current) || !current || !snapshotHolderIsDead(current)) {
      return false;
    }
    try {
      renameSync(lockDir, quarantined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }

    const moved = readLockSnapshot(quarantined);
    if (snapshotsEqual(current, moved) && moved && snapshotHolderIsDead(moved)) {
      try { unlinkSync(`${quarantined}/pid`); } catch { /* absent or unwritable */ }
      try { unlinkSync(`${quarantined}/owner`); } catch { /* legacy holder or unwritable */ }
      rmdirSync(quarantined);
      return true;
    }

    // We moved a different lock instance than the one proven dead. Restore it;
    // never delete a successor based on the stale observation.
    try {
      renameSync(quarantined, lockDir);
    } catch {
      // Fail closed. Leaving the quarantined instance is safer than deleting it.
    }
    throw new Error(`Run.json lock ownership changed during stale takeover: ${lockDir}`);
  } finally {
    releaseLock(takeoverClaim, claimOwner);
  }
}

interface TakeoverClaimSnapshot {
  pidText?: string;
  ownerToken?: string;
  entries: string[];
  mtimeMs: number;
}

function readTakeoverClaimSnapshot(claimDir: string): TakeoverClaimSnapshot | undefined {
  try {
    const entries = readdirSync(claimDir).sort();
    let pidText: string | undefined;
    let ownerToken: string | undefined;
    try { pidText = readFileSync(`${claimDir}/pid`, "utf8").trim() || undefined; } catch { /* absent */ }
    try { ownerToken = readFileSync(`${claimDir}/owner`, "utf8").trim() || undefined; } catch { /* absent */ }
    return { pidText, ownerToken, entries, mtimeMs: statSync(claimDir).mtimeMs };
  } catch {
    return undefined;
  }
}

function takeoverClaimSnapshotsEqual(
  left: TakeoverClaimSnapshot,
  right: TakeoverClaimSnapshot | undefined,
): boolean {
  return right !== undefined
    && left.pidText === right.pidText
    && left.ownerToken === right.ownerToken
    && left.mtimeMs === right.mtimeMs
    && isDeepStringArrayEqual(left.entries, right.entries);
}

function isDeepStringArrayEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function takeoverClaimIsRecoverable(snapshot: TakeoverClaimSnapshot): boolean {
  if (snapshot.entries.some((entry) => entry !== "owner" && entry !== "pid")) return false;
  if (snapshot.pidText) {
    return snapshotHolderIsDead({ pidText: snapshot.pidText, ownerToken: snapshot.ownerToken });
  }
  // Legacy claims were empty directories. The grace interval also closes the
  // mkdir-before-metadata window for the owner-bearing protocol.
  return Date.now() - snapshot.mtimeMs >= TAKEOVER_CLAIM_INIT_GRACE_MS;
}

function recoverAbandonedTakeoverClaim(claimDir: string): boolean {
  const observed = readTakeoverClaimSnapshot(claimDir);
  if (!observed || !takeoverClaimIsRecoverable(observed)) return false;

  const quarantined = `${claimDir}.abandoned-${randomUUID()}`;
  try {
    const current = readTakeoverClaimSnapshot(claimDir);
    if (!takeoverClaimSnapshotsEqual(observed, current) || !current || !takeoverClaimIsRecoverable(current)) {
      return false;
    }
    try {
      renameSync(claimDir, quarantined);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }

    const moved = readTakeoverClaimSnapshot(quarantined);
    if (takeoverClaimSnapshotsEqual(current, moved) && moved && takeoverClaimIsRecoverable(moved)) {
      try { unlinkSync(`${quarantined}/pid`); } catch { /* legacy empty/incomplete */ }
      try { unlinkSync(`${quarantined}/owner`); } catch { /* legacy empty */ }
      rmdirSync(quarantined);
      return true;
    }

    try { renameSync(quarantined, claimDir); } catch { /* leave quarantined fail closed */ }
    return false;
  } catch {
    return false;
  }
}

function readOwnerToken(lockDir: string): string | undefined {
  try {
    return readFileSync(`${lockDir}/owner`, "utf-8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function cleanupIncompleteAcquisition(lockDir: string, ownerToken: string): void {
  if (readOwnerToken(lockDir) === ownerToken) {
    try { unlinkSync(`${lockDir}/pid`); } catch { /* absent or unwritable */ }
    try { unlinkSync(`${lockDir}/owner`); } catch { /* absent or unwritable */ }
  }
  try { rmdirSync(lockDir); } catch { /* nonempty/replaced: leave fail-closed */ }
}

/** Release only this acquisition's lock instance. */
function releaseLock(lockDir: string, ownerToken: string): void {
  if (readOwnerToken(lockDir) !== ownerToken) return;

  const retired = `${lockDir}.release-${ownerToken}`;
  try {
    // Move our still-tokened instance out of the acquisition path atomically.
    // A successor may mkdir lockDir immediately; cleanup touches only retired.
    renameSync(lockDir, retired);
  } catch {
    return;
  }
  if (readOwnerToken(retired) !== ownerToken) {
    try { renameSync(retired, lockDir); } catch { /* never delete the mismatch */ }
    return;
  }
  try { unlinkSync(`${retired}/pid`); } catch { /* absent or unwritable */ }
  try { unlinkSync(`${retired}/owner`); } catch { /* absent or unwritable */ }
  try { rmdirSync(retired); } catch { /* leave unexpected entries fail-closed */ }
}

/**
 * Run `fn` while holding the run.json lock for `runJsonPath`.
 *
 * Acquire the lock adjacent to the file, run `fn` (which MUST re-read the file and
 * write it via {@link writeRunJsonAtomic}), then release on EVERY path (finally).
 * Acquire timeout throws before `fn` runs; no mutation is allowed without ownership.
 *
 * @param runJsonPath absolute path to the run.json being mutated
 * @param fn the read-modify-write to perform under mutual exclusion
 * @param onTimeout optional observability hook invoked before the timeout error
 */
export function withRunJsonLock<T>(
  runJsonPath: string,
  fn: () => T,
  onTimeout?: (lockDir: string) => void
): T {
  const lockDir = `${runJsonPath}.lock`;
  const ownerToken = acquireLock(lockDir);
  if (!ownerToken) {
    onTimeout?.(lockDir);
    throw new RunJsonLockTimeoutError(lockDir, RUN_LOCK_WAIT_TICKS, TICK_MS);
  }
  try {
    return fn();
  } finally {
    releaseLock(lockDir, ownerToken);
  }
}

/**
 * Write JSON to `runJsonPath` atomically (temp file + rename). Preserves the
 * lock-free-reads invariant: a concurrent reader sees either the old or new file,
 * never a truncated one. Use this for ALL run.json writes inside a locked section.
 */
export function writeRunJsonAtomic(runJsonPath: string, data: unknown): void {
  const tmp = `${runJsonPath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { flag: "wx" });
    renameSync(tmp, runJsonPath); // atomic on POSIX
  } catch (error) {
    try { unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
    throw error;
  }
}

/** Publish a complete run.json only if the destination does not exist. */
export function writeRunJsonExclusive(runJsonPath: string, data: unknown): void {
  const tmp = `${runJsonPath}.create.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { flag: "wx" });
    linkSync(tmp, runJsonPath);
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
  }
}

export class RunJsonLockTimeoutError extends Error {
  constructor(
    readonly lockDir: string,
    readonly waitTicks: number,
    readonly tickMs: number,
  ) {
    super(`Could not acquire run.json lock ${lockDir} within ${waitTicks} ticks (~${waitTicks * tickMs}ms).`);
    this.name = "RunJsonLockTimeoutError";
  }
}
