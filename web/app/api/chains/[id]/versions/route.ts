import { NextRequest } from "next/server";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

interface ChainVersion {
  version: string;
  timestamp: number;
  path: string;
  size: number;
}

export const GET = withErrorHandling(async (
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

  const versionsDir = orgPath(namespaceId, orgId, "agents", "versions", chainId);

  if (!existsSync(versionsDir)) {
    return apiSuccess({ versions: [] });
  }

  const versions: ChainVersion[] = [];
  const files = readdirSync(versionsDir);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const filePath = join(versionsDir, file);
    const stats = statSync(filePath);
    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);

    versions.push({
      version: data.version || file.replace(".json", ""),
      timestamp: stats.mtimeMs,
      path: filePath,
      size: stats.size,
    });
  }

  versions.sort((a, b) => b.timestamp - a.timestamp);

  return apiSuccess({ versions });
});
