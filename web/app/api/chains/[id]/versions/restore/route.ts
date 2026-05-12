import { NextRequest } from "next/server";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { incrementPatch } from "@/lib/version-utils";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { version } = await request.json();

  if (!version) {
    throw new BadRequest("version is required");
  }

  const versionPath = orgPath(namespaceId, orgId, "agents", "versions", chainId, `${version}.json`);

  if (!existsSync(versionPath)) {
    throw new NotFound("Version", version);
  }

  const versionContent = readFileSync(versionPath, "utf-8");
  const versionChain = JSON.parse(versionContent);

  const chainDir = orgPath(namespaceId, orgId, "chains", chainId);
  const chainPath = join(chainDir, "chain.json");

  const currentVersion = existsSync(chainPath)
    ? JSON.parse(readFileSync(chainPath, "utf-8"))?.version || "1.0.0"
    : "1.0.0";

  const newVersion = incrementPatch(currentVersion);
  versionChain.version = newVersion;

  mkdirSync(chainDir, { recursive: true });
  writeFileSync(chainPath, JSON.stringify(versionChain, null, 2));

  return apiSuccess({
    success: true,
    version: newVersion,
    restoredFrom: version,
  });
});
