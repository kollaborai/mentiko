import { spawn } from "node:child_process";

const RUN_ID_PATTERN = /^run-[A-Za-z0-9_-]{1,120}$/;

/** Match only the requested run's chain-runner invocation, not run-1/run-10 siblings. */
export function runProcessMatchPattern(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("Invalid run id");
  const escapedRunId = runId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `bin/mentiko run .*${escapedRunId}([^A-Za-z0-9_-]|$)`;
}

/** Stop the prior run-scoped chain-runner before a stop or resume relaunch. */
export function terminateRunProcess(runId: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("pkill", ["-f", runProcessMatchPattern(runId)], { stdio: "ignore" });
    // pkill exits 1 when no process matches; both that and a missing pkill are
    // best-effort cleanup outcomes for the API route.
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}
