import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { pty } from "@/lib/pty-client";
import { taskMergeMeta } from "@/lib/task-store";
import { writeLog } from "@/lib/system-logger";
import { checkRunAccess } from "@/lib/run-acl";
import { NotFound, BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";

export const dynamic = "force-dynamic";

// runId format is "run-<digits>" — enforce to prevent any downstream abuse.
const RUN_ID_RE = /^run-[A-Za-z0-9_-]+$/;

// spawn pkill with pattern as an argv entry, not a shell string. no shell = no injection.
function pkillPattern(pattern: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("pkill", ["-f", pattern], { stdio: "ignore" });
    // pkill exits 1 when no processes match; don't treat that as an error.
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

export const POST = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(req as Parameters<typeof requirePermission>[0], "manage_chains");
  if (perm) return perm;

  const { id: runId } = await context.params;

  if (!RUN_ID_RE.test(runId)) {
    throw new BadRequest("Invalid run id", { field: "id" });
  }

  // workspace ACL: user must have access to the run's workspace
  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const acl = await checkRunAccess(req, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  const runDir = join(runsDir, runId);
  const runJsonPath = join(runDir, "run.json");

  if (!existsSync(runJsonPath)) {
    throw new NotFound("Run", runId);
  }

  const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));
  const wasRunning = run.status === "running" || run.status === "pending";

  // kill agent PTY sessions (safe even if already dead)
  const sessions: string[] = (run.agents || [])
    .map((a: { session?: string }) => a.session)
    .filter(Boolean);

  await Promise.allSettled(sessions.map((name: string) => pty.kill(name)));

  // kill chain-runner process if run was active
  if (wasRunning) {
    await pkillPattern(`AGENT_CHAIN_RUN_ID=${runId}`);
    await pkillPattern(runId);
  }

  // always update run + agent statuses
  let changed = false;

  if (run.status === "running" || run.status === "pending") {
    run.status = "stopped";
    run.completed = run.completed || new Date().toISOString();
    changed = true;
  }

  if (run.agents) {
    for (const agent of run.agents) {
      if (agent.status === "running") {
        agent.status = "stopped";
        changed = true;
      } else if (agent.status === "pending") {
        agent.status = "cancelled";
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(runJsonPath, JSON.stringify(run, null, 2));
    const agentSummary = (run.agents || []).map((a: { id: string; status: string }) => `${a.id}:${a.status}`).join(", ");
    writeLog(namespaceId, orgId || "default", "warn", "stop-api",
      `run ${runId} stopped by user`, `agents: ${agentSummary}`);
  }

  // propagate status to linked task metadata
  if (run.taskId) {
    try {
      const agentSummary = (run.agents || [])
        .map((a: { id: string; status: string }) => `${a.id}|${a.status}`)
        .join(",");
      taskMergeMeta(orgId, run.taskId, {
        last_run_status: run.status,
        last_run_id: runId,
        last_run_completed: run.completed || new Date().toISOString(),
        last_run_agents: agentSummary,
      }, namespaceId);
    } catch {
      // non-fatal: task update failure shouldn't break stop
    }
  }

  return apiSuccess({ success: true, runId, status: run.status, cleaned: changed });
});
