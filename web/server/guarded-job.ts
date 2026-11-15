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

export const DEFAULT_JOB_TIMEOUT_MS = 120_000;

/**
 * A guarded job tick that is also bounded in time (codex rev2 P1, issue #136).
 * If the body never settles, the timeout releases the in-flight flag so the
 * next tick still runs, and the overrun is logged with the job name. The
 * body's promise is NOT cancelled — it may keep running in the background;
 * the run is abandoned, not stopped.
 */
export function createBoundedJob(
  jobName: string,
  body: (label: string) => unknown | Promise<unknown>,
  deps: GuardedJobDeps = { nsId: config.namespaceId, orgId: config.orgId, writeLog },
  timeoutMs: number = DEFAULT_JOB_TIMEOUT_MS,
): (label: string) => Promise<void> {
  let inFlight = false;
  return async (label: string): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    let overran = false;
    const overrunTimer = setTimeout(() => {
      overran = true;
      inFlight = false;
      const message = `job ${jobName} overran ${timeoutMs}ms, abandoning it (it may still be running)`;
      console.error(`[worker] ${message}`);
      deps.writeLog(deps.nsId, deps.orgId, "error", "worker", message, `job: ${jobName}`);
    }, timeoutMs);
    try {
      await body(label);
    } catch (error) {
      const { message, detail } = describeJobError(error);
      console.error(`[worker] job ${jobName} failed:`, error);
      deps.writeLog(deps.nsId, deps.orgId, "error", "worker", `job ${jobName} failed: ${message}`, detail);
    } finally {
      clearTimeout(overrunTimer);
      // after an overrun a newer tick may already own the flag — never clear it
      if (!overran) inFlight = false;
    }
  };
}
