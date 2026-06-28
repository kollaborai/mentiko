import { NextRequest } from "next/server";
import { mkdirSync, existsSync, copyFileSync, readdirSync } from "fs";
import { join } from "path";
import config, { orgPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const body = await request.json();
  const { agentId } = body;

  if (!agentId) {
    throw new BadRequest("agentId is required", { field: "agentId" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const namespaceAgentsDir = orgPath(namespaceId, orgId, "agents");

  // check if already installed
  const existingPath = join(namespaceAgentsDir, agentId, "agent.json");
  if (existsSync(existingPath)) {
    return apiSuccess({ installed: true, agentId });
  }

  // find agent in marketplace
  const marketplaceDir = join(config.root, "marketplace", "agents");
  const sourcePath = join(marketplaceDir, agentId, "agent.json");

  if (!existsSync(sourcePath)) {
    // check builtin agents as fallback
    const builtinDir = join(config.root, "agents");
    const builtinPath = join(builtinDir, agentId, "agent.json");
    if (!existsSync(builtinPath)) {
      throw new NotFound("Agent", agentId);
    }
    // copy from builtin
    const targetDir = join(namespaceAgentsDir, agentId);
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(builtinPath, join(targetDir, "agent.json"));

    // copy any additional files (like prompt.md, etc.)
    const builtinSourceDir = join(builtinDir, agentId);
    if (existsSync(builtinSourceDir)) {
      const entries = readdirSync(builtinSourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name !== "agent.json") {
          const srcFile = join(builtinSourceDir, entry.name);
          const destFile = join(targetDir, entry.name);
          copyFileSync(srcFile, destFile);
        }
      }
    }
  } else {
    // copy from marketplace
    const targetDir = join(namespaceAgentsDir, agentId);
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(sourcePath, join(targetDir, "agent.json"));

    // copy any additional files
    const sourceDir = join(marketplaceDir, agentId);
    if (existsSync(sourceDir)) {
      const entries = readdirSync(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name !== "agent.json") {
          const srcFile = join(sourceDir, entry.name);
          const destFile = join(targetDir, entry.name);
          copyFileSync(srcFile, destFile);
        }
      }
    }
  }

  return apiSuccess({ installed: true, agentId });
});
