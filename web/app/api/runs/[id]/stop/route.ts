import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { pty } from "@/lib/pty/pty-client";
import { taskMergeMeta } from "@/lib/tasks/task-store";
import { writeLog } from "@/lib/system/system-logger";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { NotFound, BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { isNonExecutionRun } from "@/lib/runs/run-provenance";
import { collectStaleRunSessionNames } from "@/lib/runs/stale-run-sessions";
import { terminateRunProcess } from "@/lib/runs/run-process";

export const dynamic = "force-dynamic";

// runId format is "run-<digits>" — enforce to prevent any downstream abuse.
const RUN_ID_RE = /^run-[A-Za-z0-9_-]+$/;

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

  // remove agent + typed-attempt PTY sessions (safe even if already dead)
  const staleSessions = collectStaleRunSessionNames(run);
  await Promise.allSettled(staleSessions.map((name) => pty.remove(name)));

  // stop the chain-runner process even if the persisted run is already
  // terminal — a crashed run can leave the process alive despite run.json
  // saying otherwise.
  await terminateRunProcess(runId);

  // always update run + agent statuses
  let changed = false;

  if (run.status === "running" || run.status === "pending" || run.status === "blocked") {
    run.status = "stopped";
    run.completed = run.completed || new Date().toISOString();
    run.statusReason = { actor: "user", reason: "stopped via run stop API" };
    changed = true;
  }

  if (run.agents) {
    for (const agent of run.agents) {
      if (agent.status === "running" || agent.status === "blocked") {
        agent.status = "stopped";
        agent.statusReason = { actor: "user", reason: "run stopped via run stop API" };
        changed = true;
      } else if (agent.status === "pending") {
        agent.status = "cancelled";
        agent.statusReason = { actor: "user", reason: "run stopped via run stop API" };
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
  if (run.taskId && !isNonExecutionRun(run)) {
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
