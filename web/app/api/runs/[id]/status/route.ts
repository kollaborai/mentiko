import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { readAgentStates, mergeAgentStates } from "@/lib/run-state";
import { checkRunAccess } from "@/lib/run-acl";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";

export const dynamic = "force-dynamic";

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

  const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));

  // read state files and merge for real-time agent statuses
  // pass run.status so stale state files don't override terminal agent statuses
  const agentStates = readAgentStates(runDir);
  const agents = mergeAgentStates(run.agents || [], agentStates, run.status);

  // annotate each agent with heartbeat staleness
  const STALE_THRESHOLD_MS = 10 * 60 * 1000;
  const now = Date.now();
  const annotatedAgents = agents.map((agent) => {
    const a = agent as typeof agent & {
      lastHeartbeat?: string;
      lastMessage?: string;
      isStale?: boolean;
      msSinceHeartbeat?: number | null;
    };
    const lastHb = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : null;
    const ms = lastHb ? now - lastHb : null;
    const isStale = a.status === "running" && (ms == null || ms > STALE_THRESHOLD_MS);
    return { ...a, msSinceHeartbeat: ms, isStale };
  });

  return apiSuccess({
    id: run.id,
    status: run.status,
    started: run.started,
    completed: run.completed || null,
    agents: annotatedAgents,
  });
});
