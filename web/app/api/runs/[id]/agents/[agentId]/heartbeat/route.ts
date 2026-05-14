/**
 * POST /api/runs/[id]/agents/[agentId]/heartbeat
 *
 * Agents call this periodically while running to signal liveness.
 * Stores lastHeartbeat + optional status/message in run.json.
 *
 * Body (all optional):
 *   status?  "running"|"idle"|"waiting"|"blocked"
 *   message? short status message (max 200 chars)
 *   round?   current round number
 *
 * Auth: internal bearer or authenticated sessions.
 *       Unconfigured local dev may use loopback.
 */

import { NextRequest } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { checkRunAccess } from "@/lib/run-acl";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { hasInternalAuth } from "@/lib/internal-api-auth";
import { Unauthorized, NotFound, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 min without heartbeat = stale

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string; agentId: string }> }
) => {
  const isInternal = hasInternalAuth(request, "agent-heartbeat");
  if (!isInternal && !(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const { id: runId, agentId } = await context.params;

  if (!isInternal) {
    const acl = await checkRunAccess(request, runId, runsDir);
    if (!acl.ok) {
      if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
      throw new Unauthorized();
    }
  }

  const runDir = join(runsDir, runId);
  const runJsonPath = join(runDir, "run.json");

  if (!existsSync(runJsonPath)) {
    throw new NotFound("Run", runId);
  }

  let body: { status?: string; message?: string; round?: number } = {};
  try {
    body = await request.json();
  } catch { /* body is optional */ }

  const now = new Date().toISOString();
  const safeMessage = body.message ? String(body.message).slice(0, 200) : undefined;
  const safeStatus = ["running", "idle", "waiting", "blocked"].includes(body.status || "")
    ? body.status
    : undefined;

  const run = JSON.parse(readFileSync(runJsonPath, "utf-8"));

  // reject heartbeats for stopped/completed runs
  // orphan heartbeat loops from dead chain-runners keep firing and
  // overwrite agent statuses that the reconciler already fixed
  if (run.status !== "running" && run.status !== "pending") {
    throw new Conflict(`run is ${run.status}`, { rejected: true, reason: `run is ${run.status}` });
  }

  // update the agent's heartbeat in the agents array
  if (Array.isArray(run.agents)) {
    const agentIdx = run.agents.findIndex(
      (a: { id: string }) => a.id === agentId
    );
    if (agentIdx === -1) {
      // agent not in run yet — create a minimal entry
      run.agents.push({
        id: agentId,
        status: safeStatus || "running",
        session: "",
        lastHeartbeat: now,
        ...(safeMessage ? { lastMessage: safeMessage } : {}),
        ...(body.round != null ? { round: body.round } : {}),
      });
    } else {
      run.agents[agentIdx].lastHeartbeat = now;
      if (safeStatus) run.agents[agentIdx].status = safeStatus;
      if (safeMessage) run.agents[agentIdx].lastMessage = safeMessage;
      if (body.round != null) run.agents[agentIdx].round = body.round;
    }
  }

  if (safeStatus === "blocked") {
    run.status = "blocked";
    run.blockedAt = run.blockedAt || now;
    if (safeMessage) run.blockedReason = safeMessage;
  }

  writeFileSync(runJsonPath, JSON.stringify(run, null, 2));

  return apiSuccess({
    ok: true,
    agentId,
    runId,
    timestamp: now,
    staleThresholdMs: STALE_THRESHOLD_MS,
  });
});

/**
 * GET /api/runs/[id]/agents/[agentId]/heartbeat
 * Returns heartbeat status for a specific agent (staleness check).
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string; agentId: string }> }
) => {
  const { id: runId, agentId } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);

  const acl = await checkRunAccess(request, runId, runsDir);
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
  const agent = (run.agents || []).find((a: { id: string }) => a.id === agentId);

  if (!agent) {
    throw new NotFound("Agent", agentId);
  }

  const now = Date.now();
  const lastHeartbeat = agent.lastHeartbeat ? new Date(agent.lastHeartbeat).getTime() : null;
  const msSinceHeartbeat = lastHeartbeat ? now - lastHeartbeat : null;
  const isStale = agent.status === "running" &&
    (msSinceHeartbeat == null || msSinceHeartbeat > STALE_THRESHOLD_MS);

  return apiSuccess({
    agentId,
    runId,
    status: agent.status,
    lastHeartbeat: agent.lastHeartbeat || null,
    lastMessage: agent.lastMessage || null,
    msSinceHeartbeat,
    isStale,
    staleThresholdMs: STALE_THRESHOLD_MS,
  });
});
