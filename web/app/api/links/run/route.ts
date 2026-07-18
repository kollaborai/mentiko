/**
 * POST /api/links/run
 *
 * Run a saved link definition by spawning a peer-manager session.
 * Adapts the swarm/launch pattern to work with a persisted link config.
 */

import { NextRequest } from "next/server";
import { execFileSync } from "node:child_process";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import config from "@/lib/config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { loadLink, resolveLinkAgentName } from "@/lib/links/link-utils";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveAuthorizedWorkspacePath } from "@/lib/auth/workspace-auth";
import {
  buildLinkRunEnv,
  buildShellSetup,
  normalizeLinkId,
  resolveLinkRunPaths,
  resolveLinkRunSecret,
  shellQuote,
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

  const pBin = join(config.binDir, "p");
  const scriptPath = join(config.binDir, "peer-manager");
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

  // spawn manager session via pty-manager
  try {
    execFileSync(pBin, ["spawn", managerSession], {
      cwd: config.codeRoot,
      stdio: "pipe",
    });
  } catch {
    try {
      execFileSync(pBin, ["daemon"], { cwd: config.codeRoot, stdio: "pipe" });
    } catch {}
    execFileSync(pBin, ["spawn", managerSession], {
      cwd: config.codeRoot,
      stdio: "pipe",
    });
  }

  // set up env in a single command to avoid timing issues between p send calls
  const envSetup = buildShellSetup(
    buildLinkRunEnv({
      namespaceId,
      orgId,
      runId,
      runsDir,
      workspacePath: workspacePath || undefined,
      authSecret,
    }),
    workspacePath || undefined
  );

  execFileSync(pBin, ["send", managerSession, envSetup], {
    cwd: config.codeRoot,
    stdio: "pipe",
  });

  // small delay to ensure env is applied before peer-manager starts
  execFileSync("sleep", ["1"], { stdio: "pipe" });

  // build peer-manager command from link config
  const effectiveGoal = specFile
    ? `${goalOverride || link.config.leading_prompt || link.name}\n\nSpec file: ${specFile}`
    : goalOverride || link.config.leading_prompt || link.name;
  const leadingPrompt = effectiveGoal;
  const cmdParts: string[] = [
    shellQuote(scriptPath),
    shellQuote(leadingPrompt),
    `--session ${shellQuote(managerSession)}`,
  ];

  if (link.config.agent1_prompt) {
    cmdParts.push(`--prompt1 ${shellQuote(link.config.agent1_prompt)}`);
  }
  if (link.config.agent2_prompt) {
    cmdParts.push(`--prompt2 ${shellQuote(link.config.agent2_prompt)}`);
  }
  if (link.config.max_rounds && link.config.max_rounds > 0) {
    cmdParts.push(`--rounds ${link.config.max_rounds}`);
  }
  if (link.config.stall_threshold && link.config.stall_threshold > 0) {
    cmdParts.push(`--stall-threshold ${link.config.stall_threshold}`);
  }
  if (safeRelayProfile) {
    cmdParts.push(`--relay-profile ${shellQuote(safeRelayProfile)}`);
  }
  // per-agent profile overrides (UI override > link definition > default)
  if (safeAgent1Profile) {
    cmdParts.push(`--profile1 ${shellQuote(safeAgent1Profile)}`);
  }
  if (safeAgent2Profile) {
    cmdParts.push(`--profile2 ${shellQuote(safeAgent2Profile)}`);
  }
  if (agent1Name && agent1Name !== "unnamed") {
    cmdParts.push(`--name1 ${shellQuote(agent1Name)}`);
  }
  if (agent2Name && agent2Name !== "unnamed") {
    cmdParts.push(`--name2 ${shellQuote(agent2Name)}`);
  }

  const managerCmd = cmdParts.join(" ");

  execFileSync(pBin, ["send", managerSession, managerCmd], {
    cwd: config.codeRoot,
    stdio: "pipe",
  });

  return apiSuccess({
    runId,
    managerSession,
    linkId: link.id,
    status: "launching",
  });
});
