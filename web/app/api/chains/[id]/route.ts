import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { validateChain } from "@/lib/validators";
import { resolveChainAgents } from "@/lib/agents/agent-loader";
import { BadRequest, NotFound, ValidationError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { addAuditLog } from "@/lib/api/audit-queue";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const decodedId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const chainPath = join(orgPath(namespaceId, orgId, "chains", decodedId), "chain.json");

  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", decodedId);
  }

  const content = readFileSync(chainPath, "utf-8");
  const chain = JSON.parse(content);
  chain.id = decodedId;

  // resolve $ref agents to full definitions
  if (Array.isArray(chain.agents)) {
    try {
      chain.agents = resolveChainAgents(chain.agents, namespaceId, orgId);
    } catch {
      // return raw chain if resolution fails
    }
  }

  return apiSuccess({ chain, path: chainPath });
});

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const decodedId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { chain } = body;

  if (!chain) {
    throw new BadRequest("Chain data required", { field: "chain" });
  }

  // validate chain before saving
  const validation = validateChain(chain);
  if (!validation.valid) {
    throw new ValidationError("Invalid chain", { errors: validation.errors });
  }

  const chainToSave = { ...chain, id: decodedId };

  const chainDir = orgPath(namespaceId, orgId, "chains", decodedId);
  const chainPath = join(chainDir, "chain.json");

  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", decodedId);
  }

  writeFileSync(chainPath, JSON.stringify(chainToSave, null, 2), "utf-8");

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : (request.headers.get("x-real-ip") || "unknown");

  addAuditLog({
    eventType: "chain_edit",
    description: `Chain modified: ${decodedId}`,
    metadata: { chain_name: decodedId, action: "modified", namespace_id: namespaceId },
    options: { ip },
  }).catch(() => {});

  return apiSuccess({ success: true, chain: chainToSave });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const decodedId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const chainPath = orgPath(namespaceId, orgId, "chains", decodedId);

  if (!existsSync(join(chainPath, "chain.json"))) {
    throw new NotFound("Chain", decodedId);
  }

  // delete the chain directory
  rmSync(chainPath, { recursive: true, force: true });

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : (request.headers.get("x-real-ip") || "unknown");

  addAuditLog({
    eventType: "chain_delete",
    description: `Chain deleted: ${decodedId}`,
    metadata: { chain_name: decodedId, action: "deleted", namespace_id: namespaceId },
    options: { ip },
  }).catch(() => {});

  return apiSuccess({ success: true, deleted: decodedId });
});
