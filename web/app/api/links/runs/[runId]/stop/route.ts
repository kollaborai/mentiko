import { NextRequest } from "next/server";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunPaths, validateLinkRunId } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { runId } = await params;
  if (!validateLinkRunId(runId)) {
    throw new BadRequest("Invalid run ID");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { runsDir, runJsonPath: runPath } = resolveLinkRunPaths(namespaceId, orgId, runId);
  const acl = await checkRunAccess(request, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  if (!existsSync(runPath)) {
    throw new NotFound("Run not found");
  }

  const run = JSON.parse(readFileSync(runPath, "utf-8"));
  if (run.type !== "link") {
    throw new BadRequest("Not a link run");
  }

  const pBin = join(config.binDir, "p");
  const stopped: string[] = [];

  // kill manager + agent sessions
  const sessions = [
    run.managerSession,
    ...run.agents.map((a: { session: string }) => a.session).filter(Boolean),
  ];

  for (const session of sessions) {
    if (!session || !/^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,99}$/.test(session)) continue;
    try {
      execFileSync(pBin, ["remove", session], { timeout: 5000 });
      stopped.push(session);
    } catch {
      // session may already be dead
    }
  }

  // update run + agent statuses
  run.status = "stopped";
  run.completed = new Date().toISOString();
  run.statusReason = { actor: "user", reason: "link run stopped via link stop API" };
  if (run.agents) {
    for (const agent of run.agents) {
      if (agent.status === "running" || agent.status === "pending") {
        agent.status = "stopped";
        agent.statusReason = { actor: "user", reason: "link run stopped via link stop API" };
      }
    }
  }
  writeFileSync(runPath, JSON.stringify(run, null, 2));

  return apiSuccess({ stopped, runId });
});
