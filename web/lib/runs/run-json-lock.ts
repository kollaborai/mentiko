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
 * directory (`${runJsonPath}.lock/`) and the SAME stale-break rule, a node writer and
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
 * alike — matching the bash primitive exactly so the two languages interoperate.
 *
 * Cross-language interop details (must stay in lockstep with lib/run-lib.sh):
 *   - lock dir:        `${runJsonPath}.lock/`
 *   - holder pid file: `${lock}/pid` containing the writer's PID as decimal text
 *   - liveness check:  a bash holder's pid is checkable from node via
 *                      process.kill(pid, 0) (ESRCH => dead); a node holder's pid is
 *                      checkable from bash via kill -0. Same syscall, both directions.
 *   - stale-break:     break iff the holder pid is dead OR the lock dir mtime age
 *                      exceeds RUN_LOCK_STALE_SECS (seconds). Re-races safely: rmdir
 *                      then re-attempt the atomic mkdir, so two breakers can't both win.
 *   - wait budget:     RUN_LOCK_WAIT_SECS is a count of ~50ms spin ticks (same as the
 *                      bash loop's `sleep 0.05; waited++`), so both sides give up after
 *                      ~RUN_LOCK_WAIT_SECS * 50ms and never hang the request/engine.
 *
 * TIMEOUT POLICY (never hang): on bounded-wait expiry we log loudly and PROCEED with
 * the write anyway (degraded, last-writer-wins — exactly the pre-fix status quo) rather
 * than dropping the write or throwing. A dropped status write is strictly worse than a
 * raced one: the reconciler can repair a raced terminal status; it cannot resurrect a
 * write that never happened.
 */

import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, renameSync } from "fs";

/** Parse an env knob to a non-negative integer, falling back ONLY when unset/NaN.
 *  (Plain `Number(x) || default` would coerce a legitimate 0 to the default.) */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** A held run.json lock older than this (seconds) is treated as crashed and broken. */
const RUN_LOCK_STALE_SECS = envInt("RUN_LOCK_STALE_SECS", 120);
/** Max number of ~50ms spin ticks to wait for the lock (mirrors the bash loop). */
const RUN_LOCK_WAIT_TICKS = envInt("RUN_LOCK_WAIT_SECS", 30);
/** Duration of one spin tick, in ms. Matches the bash side's `sleep 0.05`. */
const TICK_MS = 50;

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

/** Age of the lock dir in seconds (0 if unknown / treat as fresh). Mirrors _run_lock_age. */
function lockAgeSecs(lockDir: string): number {
  try {
    const mtimeMs = statSync(lockDir).mtimeMs;
    if (mtimeMs > 0) return Math.floor((Date.now() - mtimeMs) / 1000);
  } catch {
    /* missing/unreadable — treat as fresh */
  }
  return 0;
}

/** True iff the pid in the lock dir is provably gone (dead) — mirrors `! kill -0`. */
function holderIsDead(lockDir: string): boolean {
  let holder = "";
  try {
    holder = readFileSync(`${lockDir}/pid`, "utf-8").trim();
  } catch {
    return false; // no/unreadable pid file — don't claim the holder is dead on this basis
  }
  const pid = Number(holder);
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

/**
 * Acquire the run.json lock by spinning on an atomic mkdir; break a provably-stale
 * lock (dead pid OR aged out). Returns true if acquired, false on wait-budget expiry.
 * Mirrors lib/run-lib.sh `_run_lock_acquire`.
 */
function acquireLock(lockDir: string): boolean {
  let waited = 0;
  for (;;) {
    try {
      mkdirSync(lockDir); // atomic: throws EEXIST if another holder already created it
      try {
        writeFileSync(`${lockDir}/pid`, String(process.pid));
      } catch {
        /* pid file is advisory; absence just disables our liveness break, never fatal */
      }
      return true;
    } catch {
      // could not create — decide whether the current holder is dead/stale.
      if (holderIsDead(lockDir) || lockAgeSecs(lockDir) >= RUN_LOCK_STALE_SECS) {
        // break it, then retry the mkdir. rmdir-then-recreate re-races safely: if
        // another breaker already removed+recreated, our removal simply no-ops.
        try { rmSync(`${lockDir}/pid`, { force: true }); } catch { /* ignore */ }
        try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ }
        continue;
      }
      if (waited >= RUN_LOCK_WAIT_TICKS) return false; // give up — caller proceeds degraded
      sleepSyncMs(TICK_MS);
      waited += 1;
    }
  }
}

/** Release the run.json lock. Mirrors lib/run-lib.sh `_run_lock_release`. */
function releaseLock(lockDir: string): void {
  try { rmSync(`${lockDir}/pid`, { force: true }); } catch { /* ignore */ }
  try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Run `fn` while holding the run.json lock for `runJsonPath`.
 *
 * Acquire the lock adjacent to the file, run `fn` (which MUST re-read the file and
 * write it via {@link writeRunJsonAtomic}), then release on EVERY path (finally). On
 * acquire-timeout we log loudly and run `fn` anyway (degraded last-writer-wins) — see
 * the timeout-policy note at the top of this file.
 *
 * @param runJsonPath absolute path to the run.json being mutated
 * @param fn the read-modify-write to perform under mutual exclusion
 * @param onTimeout optional hook (test/observability) invoked when the lock could not
 *        be acquired and we proceed unlocked
 */
export function withRunJsonLock<T>(
  runJsonPath: string,
  fn: () => T,
  onTimeout?: (lockDir: string) => void
): T {
  const lockDir = `${runJsonPath}.lock`;
  const acquired = acquireLock(lockDir);
  if (!acquired) {
    // never hang the request: proceed unlocked, last-writer-wins (status quo).
    console.warn(
      `[run-json-lock] could not acquire ${lockDir} within ${RUN_LOCK_WAIT_TICKS} ticks (~${RUN_LOCK_WAIT_TICKS * TICK_MS}ms) — writing UNLOCKED (degraded, last-writer-wins)`
    );
    onTimeout?.(lockDir);
    return fn();
  }
  try {
    return fn();
  } finally {
    releaseLock(lockDir);
  }
}

/**
 * Write JSON to `runJsonPath` atomically (temp file + rename). Preserves the
 * lock-free-reads invariant: a concurrent reader sees either the old or new file,
 * never a truncated one. Use this for ALL run.json writes inside a locked section.
 */
export function writeRunJsonAtomic(runJsonPath: string, data: unknown): void {
  const tmp = `${runJsonPath}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, runJsonPath); // atomic on POSIX
}
