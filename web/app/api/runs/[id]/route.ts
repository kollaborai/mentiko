import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { taskMergeMeta } from "@/lib/task-store";
import { writeLog } from "@/lib/system-logger";
import { getOrgIdFromRequest, getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { readAgentStates, mergeAgentStates } from "@/lib/run-state";
import { pty } from "@/lib/pty-client";
import { checkRunAccess } from "@/lib/run-acl";
import { Unauthorized, NotFound, BadRequest, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { isGenerationAuditRun } from "@/lib/run-provenance";

export const dynamic = "force-dynamic";


interface RunObject {
  id: string;
  chain: string;
  chainId: string;
  goal: string;
  started: string;
  status: string;
  completed?: string;
  taskId?: string;
  workspacePath?: string;
  agents: Array<{
    id: string;
    name: string;
    status: string;
    session: string;
  }>;
  sessions?: string[];
}

export const GET = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id: runId } = await context.params;
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

  const run: RunObject = JSON.parse(readFileSync(runJsonPath, "utf-8"));

  // Read state files and merge for real-time agent statuses
  // pass run.status so stale state files don't override terminal agent statuses
  const agentStates = readAgentStates(runDir);
  const agents = mergeAgentStates(run.agents || [], agentStates, run.status);

  // Extract agent ID from session name: mentiko-{chain}-{agentId}-run-{runId}
  function agentIdFromSession(session: string): string {
    const match = session.match(/mentiko-[^-]+-([^-]+)-run-/);
    return match ? match[1] : "";
  }

  // filter out phantom sessions
  const phantomIds = new Set(["stop"]);
  const sessions = (run.sessions || []).filter(
    (s: string) => !phantomIds.has(agentIdFromSession(s))
  );

  return apiSuccess({
    run: {
      ...run,
      agents,
      sessions,
    },
  });
});

// PATCH /api/runs/[id] - cancel a run
export const PATCH = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id: runId } = await context.params;
  const orgId = await getOrgIdFromRequest(req);
  const namespaceId = await getNamespaceIdFromRequest(req);
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

  const body = await req.json();
  const { action } = body;

  if (action !== "cancel") {
    throw new BadRequest("Unknown action", { validAction: "cancel" });
  }

  const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));

  if (run.status !== "running" && run.status !== "pending") {
    throw new Conflict("Run is not active");
  }

  // kill sessions for any active agents
  for (const agent of run.agents || []) {
    if (agent.session) {
      await pty.remove(agent.session);
    }
  }

  // update run status
  run.status = "cancelled";
  run.completed = new Date().toISOString();
  for (const agent of run.agents || []) {
    if (agent.status === "running" || agent.status === "pending") {
      agent.status = "cancelled";
    }
  }

  writeFileSync(runJsonPath, JSON.stringify(run, null, 2));
  writeLog(namespaceId, orgId || "default", "warn", "run-api",
    `run ${runId} cancelled (deleted)`, `chain: ${run.chain || "unknown"}`);

  // propagate cancelled status to linked task
  if (run.taskId && !isGenerationAuditRun(run)) {
    try {
      taskMergeMeta(orgId, run.taskId, { last_run_status: "cancelled", last_run_id: run.id }, namespaceId);
    } catch {
      // best-effort
    }
  }

  return apiSuccess({ run });
});

// DELETE /api/runs/[id] - delete a run
export const DELETE = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id: runId } = await context.params;
  const orgId = await getOrgIdFromRequest(req);
  const namespaceId = await getNamespaceIdFromRequest(req);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const acl = await checkRunAccess(req, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  const runDir = join(runsDir, runId);

  if (!existsSync(runDir)) {
    throw new NotFound("Run", runId);
  }

  // kill any active sessions first
  const runJsonPath = join(runDir, "run.json");
  if (existsSync(runJsonPath)) {
    const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));
    for (const agent of run.agents || []) {
      if (agent.session) {
        await pty.remove(agent.session);
        await pty.remove(`monitor-${agent.session}`);
      }
    }
  }

  // update linked task metadata before deleting run data
  if (existsSync(runJsonPath)) {
    try {
      const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));
      if (run.taskId && !isGenerationAuditRun(run)) {
        taskMergeMeta(orgId, run.taskId, { last_run_status: "deleted", last_run_id: run.id }, namespaceId);
      }
    } catch {
      // best-effort: don't block delete if task update fails
    }
  }

  rmSync(runDir, { recursive: true, force: true });
  return apiSuccess({ deleted: true });
});
