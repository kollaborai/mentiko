import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { orgPath } from "@/lib/config";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string; version: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id, version } = await _context.params;
  const chainId = decodeURIComponent(id);
  const versionId = decodeURIComponent(version);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const versionPath = orgPath(namespaceId, orgId, "agents", "versions", chainId, `${versionId}.json`);

  if (!existsSync(versionPath)) {
    throw new NotFound("Version", versionId);
  }

  const content = readFileSync(versionPath, "utf-8");
  const chain = JSON.parse(content);

  return apiSuccess({ chain, version: versionId });
});
