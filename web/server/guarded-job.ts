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
