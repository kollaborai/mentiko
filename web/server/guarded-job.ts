// guarded-job.ts -- failure isolation for background worker jobs (issue #136)
// one throwing job must never take the worker process down: the error is
// logged with the job name and stack, and the next tick still runs.
import config from "../lib/config";
import { writeLog } from "../lib/system/system-logger";

export interface GuardedJobDeps {
  nsId: string;
  orgId: string;
  writeLog: typeof writeLog;
}

export function describeJobError(error: unknown): { message: string; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error && error.stack ? error.stack : message;
  return { message, detail };
}

export async function runGuardedJob(
  jobName: string,
  fn: () => unknown | Promise<unknown>,
  deps: GuardedJobDeps = { nsId: config.namespaceId, orgId: config.orgId, writeLog },
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const { message, detail } = describeJobError(error);
    console.error(`[worker] job ${jobName} failed:`, error);
    deps.writeLog(deps.nsId, deps.orgId, "error", "worker", `job ${jobName} failed: ${message}`, detail);
  }
}

export const DEFAULT_JOB_OVERRUN_MS = 120_000;

// jobs currently past their overrun threshold and still in flight. The worker
// persists this set in its status file and /api/health reports the worker
// degraded while it is non-empty (issue #136).
const overrunningJobs = new Set<string>();

export function getOverrunningJobs(): string[] {
  return [...overrunningJobs];
}

/**
 * A guarded job tick with no-overlap scheduling (issue #136).
 *
 * The in-flight flag is held until the body settles: a job that is still
 * running is never re-entered — no overlapping executions, ever. A body that
 * never settles therefore stops only that job (its flag stays set and its
 * ticks stop); it is not silent: the overrun is logged once with the job name
 * and elapsed time, the job stays in getOverrunningJobs() while in flight,
 * and the health check reports the worker degraded. Cancelling or otherwise
 * bounding a hung body is deliberately out of scope (see the follow-up issue
 * referenced in #136): an event-loop timer cannot stop synchronous code, and
 * releasing the flag while the old body still runs would let a zombie tick
 * overlap a newer one.
 */
export function createBoundedJob(
  jobName: string,
  body: (label: string) => unknown | Promise<unknown>,
  deps: GuardedJobDeps = { nsId: config.namespaceId, orgId: config.orgId, writeLog },
  overrunMs: number = DEFAULT_JOB_OVERRUN_MS,
): (label: string) => Promise<void> {
  let inFlight = false;
  return async (label: string): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    const startedAt = Date.now();
    let overran = false;
    const overrunTimer = setTimeout(() => {
      // warning only: no release, no cancel — the flag stays held (issue #136)
      overran = true;
      overrunningJobs.add(jobName);
      const elapsed = Date.now() - startedAt;
      const message = `job ${jobName} still in flight after ${elapsed}ms (overrun threshold ${overrunMs}ms); holding it out of scheduling until it settles`;
      console.error(`[worker] ${message}`);
      deps.writeLog(deps.nsId, deps.orgId, "warn", "worker", message, `job: ${jobName}`);
    }, overrunMs);
    try {
      await body(label);
    } catch (error) {
      const { message, detail } = describeJobError(error);
      console.error(`[worker] job ${jobName} failed:`, error);
      deps.writeLog(deps.nsId, deps.orgId, "error", "worker", `job ${jobName} failed: ${message}`, detail);
    } finally {
      clearTimeout(overrunTimer);
      if (overran) overrunningJobs.delete(jobName);
      inFlight = false;
    }
  };
}
