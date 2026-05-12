import { NextRequest } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await _context.params;
  const sourceId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const sourceChainPath = join(orgPath(namespaceId, orgId, "chains", sourceId), "chain.json");

  if (!existsSync(sourceChainPath)) {
    throw new NotFound("Chain", sourceId);
  }

  const chainData = JSON.parse(readFileSync(sourceChainPath, "utf-8")) as Record<string, unknown>;
  const sourceName = (chainData.name as string) || sourceId;

  // create new id and name
  const newId = `${sourceId}-copy`;
  const newName = `${sourceName} (copy)`;

  // update chain data
  const newChainData = {
    ...chainData,
    name: newName,
  };

  // write to new location
  const newChainDir = orgPath(namespaceId, orgId, "chains", newId);
  if (!existsSync(newChainDir)) {
    mkdirSync(newChainDir, { recursive: true });
  }
  writeFileSync(join(newChainDir, "chain.json"), JSON.stringify(newChainData, null, 2), "utf-8");

  return apiSuccess({
    success: true,
    newId,
    newName,
  });
});
