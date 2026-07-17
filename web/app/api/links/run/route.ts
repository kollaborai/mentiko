/**
 * POST /api/links/run
 *
 * Run a saved link definition by spawning a peer-manager session.
 * Adapts the swarm/launch pattern to work with a persisted link config.
 */

import { NextRequest } from "next/server";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import config from "@/lib/config";
import { pty } from "@/lib/pty/pty-client";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { loadLink, resolveLinkAgentName } from "@/lib/links/link-utils";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import {
  buildLinkRunEnv,
  normalizeLinkId,
  resolveLinkRunPaths,
  resolveLinkRunSecret,
} from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { linkId, goalOverride, workspaceId, specFile, taskId, relayProfile, agent1Profile, agent2Profile } = body;

  const safeLinkId = normalizeLinkId(linkId);
  if (!safeLinkId) {
    throw new BadRequest("linkId is required", { field: "linkId" });
  }

  const session = await getSessionUser(request);
  const userId = session?.id;

  let workspacePath = "";
  if (workspaceId) {
    const authorizedPath = resolveAuthorizedWorkspacePath(namespaceId, orgId, workspaceId, userId);
    if (!authorizedPath) {
      throw new BadRequest("workspaceId is not accessible", { field: "workspaceId" });
    }
    workspacePath = authorizedPath;
  }

  const linksDir = orgPath(namespaceId, orgId, "links");
  const link = loadLink(linksDir, safeLinkId);

  if (!link) {
    throw new NotFound("Link", safeLinkId);
  }

  const safeRelayProfile = relayProfile ? normalizeLinkId(relayProfile) : null;
  const requestedAgent1Profile = agent1Profile || link.agents.agent1.agent_profile;
  const requestedAgent2Profile = agent2Profile || link.agents.agent2.agent_profile;
  const safeAgent1Profile = requestedAgent1Profile ? normalizeLinkId(requestedAgent1Profile) : null;
  const safeAgent2Profile = requestedAgent2Profile ? normalizeLinkId(requestedAgent2Profile) : null;

  if (relayProfile && !safeRelayProfile) {
    throw new BadRequest("relayProfile is invalid", { field: "relayProfile" });
  }
  if (requestedAgent1Profile && !safeAgent1Profile) {
    throw new BadRequest("agent1Profile is invalid", { field: "agent1Profile" });
  }
  if (requestedAgent2Profile && !safeAgent2Profile) {
    throw new BadRequest("agent2Profile is invalid", { field: "agent2Profile" });
  }

  const id = Date.now().toString(36);
  const managerSession = `link-${id}`;

  // create run directory with run.json
  const runId = `run-${Date.now()}`;
  const { runsDir, runDir } = resolveLinkRunPaths(namespaceId, orgId, runId);
  mkdirSync(runDir, { recursive: true });

  const agent1Name = resolveLinkAgentName(link.agents.agent1, namespaceId, orgId);
  const agent2Name = resolveLinkAgentName(link.agents.agent2, namespaceId, orgId);

  const runObject = {
    id: runId,
    type: "link",
    namespaceId,
    orgId,
    linkId: link.id,
    linkName: link.name,
    chain: link.name,
    goal: goalOverride || link.config.leading_prompt || "",
    started: new Date().toISOString(),
    status: "running",
    mode: link.config.mode,
    managerSession,
    workspaceId: workspaceId || undefined,
    workspacePath: workspacePath || undefined,
    taskId: taskId || undefined,
    agents: [
      { id: "agent1", name: agent1Name, status: "pending", session: "" },
      { id: "agent2", name: agent2Name, status: "pending", session: "" },
    ],
    escalations: [],
  };

  writeFileSync(join(runDir, "run.json"), JSON.stringify(runObject, null, 2));

  const authSecret = resolveLinkRunSecret();
  const effectiveGoal = specFile
    ? `${goalOverride || link.config.leading_prompt || link.name}\n\nSpec file: ${specFile}`
    : goalOverride || link.config.leading_prompt || link.name;
  const internalDir = join(runDir, ".internal");
  mkdirSync(internalDir, { recursive: true });
  const contextPath = join(internalDir, "peer-link-controller.json");
  writeFileSync(contextPath, JSON.stringify({
    runId, runDir, runsDir, namespaceId, orgId, managerSession,
    workspacePath: workspacePath || config.codeRoot,
    task: effectiveGoal,
    agent1Name, agent2Name,
    ...(safeRelayProfile ? { relayProfile: safeRelayProfile } : {}),
    ...(safeAgent1Profile ? { agent1Profile: safeAgent1Profile } : {}),
    ...(safeAgent2Profile ? { agent2Profile: safeAgent2Profile } : {}),
    ...(link.config.agent1_prompt ? { prompt1: link.config.agent1_prompt } : {}),
    ...(link.config.agent2_prompt ? { prompt2: link.config.agent2_prompt } : {}),
    ...(link.config.max_rounds ? { maxRounds: link.config.max_rounds } : {}),
    ...(link.config.stall_threshold ? { stallThreshold: link.config.stall_threshold } : {}),
  }, null, 2));
  await pty.spawn(managerSession, "node", [join(config.codeRoot, "lib", "runner-peer-link-controller.js"), "--context", contextPath], {
    cwd: workspacePath || config.codeRoot,
    env: buildLinkRunEnv({ namespaceId, orgId, runId, runsDir, workspacePath: workspacePath || undefined, authSecret }),
  });

  return apiSuccess({
    runId,
    managerSession,
    linkId: link.id,
    status: "launching",
  });
});
