import { NextRequest } from "next/server";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import config, { orgPath } from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import type { Agent } from "@/lib/types";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { normalizeMcpTaskToolDeclarations } from "@/lib/agents/mcp-task-tool-contract";

export const dynamic = "force-dynamic";

// GET /api/agents/registry/[id] - fetch a single agent
export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const decodedId = decodeURIComponent(id);

  // check org-scoped agent first
  const orgAgentPath = orgPath(namespaceId, orgId, "agents", decodedId, "agent.json");
  // check shared agents dir
  const sharedAgentPath = join(config.root, "agents", decodedId, "agent.json");

  let agentPath: string;
  if (existsSync(orgAgentPath)) {
    agentPath = orgAgentPath;
  } else if (existsSync(sharedAgentPath)) {
    agentPath = sharedAgentPath;
  } else {
    throw new NotFound("Agent", decodedId);
  }

  const content = readFileSync(agentPath, "utf-8");
  const agent: Agent = JSON.parse(content);

  return apiSuccess(agent);
});

// PUT /api/agents/registry/[id] - update a standalone agent
export const PUT = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const decodedId = decodeURIComponent(id);
  const updates = await request.json();

  if (!updates.id || !updates.name) {
    throw new BadRequest("agent must have id and name");
  }

  if (!updates.triggers || !updates.emits) {
    throw new BadRequest("agent must have triggers and emits");
  }

  // find the agent file
  let agentDir: string;
  let agentPath: string;
  let existingData: Record<string, unknown>;

  const orgAgentDir = orgPath(namespaceId, orgId, "agents", decodedId);
  const orgAgentPath = join(orgAgentDir, "agent.json");
  const sharedAgentDir = join(config.root, "agents", decodedId);
  const sharedAgentPath = join(sharedAgentDir, "agent.json");

  if (existsSync(orgAgentPath)) {
    agentDir = orgAgentDir;
    agentPath = orgAgentPath;
  } else if (existsSync(sharedAgentPath)) {
    agentDir = sharedAgentDir;
    agentPath = sharedAgentPath;
  } else {
    throw new NotFound("Agent", decodedId);
  }

  // read existing to preserve created_at
  try {
    existingData = JSON.parse(readFileSync(agentPath, "utf-8"));
  } catch {
    existingData = {};
  }

  // merge with updates, preserve timestamps
  const mergedAgentData = {
    ...existingData,
    ...updates,
    created_at: existingData.created_at || updates.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  let agentData: Record<string, unknown>;
  try {
    agentData = normalizeMcpTaskToolDeclarations(mergedAgentData);
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : "Invalid MCP task tool declaration");
  }

  // ensure directory exists
  mkdirSync(agentDir, { recursive: true });

  writeFileSync(agentPath, JSON.stringify(agentData, null, 2));

  return apiSuccess({ success: true, path: agentPath, id: decodedId });
});

// DELETE /api/agents/registry/[id] - delete a standalone agent
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const decodedId = decodeURIComponent(id);

  // check org-scoped agent first
  const orgAgentDir = orgPath(namespaceId, orgId, "agents", decodedId);
  if (existsSync(join(orgAgentDir, "agent.json"))) {
    rmSync(orgAgentDir, { recursive: true, force: true });
    return apiSuccess({ deleted: true, id: decodedId });
  }

  // check shared agents dir
  const sharedAgentDir = join(config.root, "agents", decodedId);
  if (existsSync(join(sharedAgentDir, "agent.json"))) {
    rmSync(sharedAgentDir, { recursive: true, force: true });
    return apiSuccess({ deleted: true, id: decodedId });
  }

  throw new NotFound("Agent", decodedId);
});
