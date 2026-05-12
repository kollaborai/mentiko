import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { orgPath } from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { resolveChainAgents } from "@/lib/agent-loader";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get("id");
  const expand = searchParams.get("expand") === "true";

  if (!id) {
    throw new BadRequest("id parameter is required", { field: "id" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const chainPath = orgPath(namespaceId, orgId, "chains", id, "chain.json");

  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", id);
  }

  const content = readFileSync(chainPath, "utf-8");
  const chain = JSON.parse(content);

  // optionally expand $ref agents to full definitions
  if (expand && Array.isArray(chain.agents)) {
    try {
      chain.agents = resolveChainAgents(chain.agents, namespaceId, orgId);
    } catch {
      // leave agents as-is if resolution fails
    }
  }

  // inject id (directory name) since chain.json doesn't store it
  chain.id = id;

  return apiSuccess({ chain });
});
