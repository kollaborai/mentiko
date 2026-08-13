import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { writeLog } from "@/lib/system/system-logger";
import config from "@/lib/config";
import { pty } from "@/lib/pty/pty-client";

export const dynamic = "force-dynamic";

// Same pattern as /api/runs/[id]/stop — spawn pkill with argv, no shell.
const RUN_DIR_RE = /^run-[A-Za-z0-9_-]+$/;

function pkillPattern(pattern: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("pkill", ["-f", pattern], { stdio: "ignore" });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const stopped: string[] = [];
  const errors: string[] = [];

  // 1. find all running runs
  if (existsSync(config.runsDir)) {
    const runDirs = readdirSync(config.runsDir).filter((d) => RUN_DIR_RE.test(d));

    for (const dir of runDirs) {
      const runJsonPath = join(config.runsDir, dir, "run.json");
      if (!existsSync(runJsonPath)) continue;

      try {
        const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));
        if (run.status !== "running" && run.status !== "pending") continue;

        // kill all agent pty sessions
        const sessions: string[] = (run.agents || [])
          .map((a: { session?: string }) => a.session)
          .filter(Boolean);

        await Promise.allSettled(sessions.map((name: string) => pty.kill(name)));

        // kill chain-runner process — spawn pkill with argv, no shell
        await pkillPattern(`AGENT_CHAIN_RUN_ID=${dir}`);

        // mark as stopped
        run.status = "stopped";
        run.completed = new Date().toISOString();
        run.stop_reason = "emergency_stop";
        run.statusReason = { actor: "user", reason: "emergency stop-all" };
        writeFileSync(runJsonPath, JSON.stringify(run, null, 2));
        stopped.push(dir);
      } catch (e) {
        errors.push(`${dir}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // 2. cancel all pending/running jobs
  const jobsDir = config.jobsDir;
  if (existsSync(jobsDir)) {
    const jobFiles = readdirSync(jobsDir).filter((f: string) => f.endsWith(".json") && !f.endsWith(".tmp"));

    for (const file of jobFiles) {
      try {
        const jobPath = join(jobsDir, file);
        const job = JSON.parse(readFileSync(jobPath, "utf-8"));
        if (job.status !== "running" && job.status !== "pending") continue;

        job.status = "failed";
        job.completedAt = new Date().toISOString();
        job.error = "Emergency stop - all jobs cancelled";
        writeFileSync(jobPath, JSON.stringify(job, null, 2));
        stopped.push(`job:${file.replace(".json", "")}`);
      } catch {
        // skip malformed job files
      }
    }
  }

  if (stopped.length > 0) {
    writeLog(config.namespaceId, config.orgId || "default", "warn", "stop-all",
      `emergency stop: ${stopped.length} processes stopped`, stopped.join(", "));
  }

  return apiSuccess({
    success: true,
    stopped,
    errors: errors.length > 0 ? errors : undefined,
    message: `Stopped ${stopped.length} running processes`,
  });
});
