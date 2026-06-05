import { NextRequest } from "next/server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { saveLink, slugifyLinkName } from "@/lib/links/link-utils";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import type { Link } from "@/lib/links/link-types";
import { normalizeLinkId } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const link = body.link || body;

  if (!link || !link.name) {
    throw new BadRequest("link with name is required", { field: "name" });
  }

  if (!link.agents?.agent1 || !link.agents?.agent2) {
    throw new BadRequest("link requires both agent1 and agent2", { field: "agents" });
  }

  if (!link.config?.mode) {
    throw new BadRequest("link config.mode is required", { field: "config.mode" });
  }

  const now = new Date().toISOString();
  const id = normalizeLinkId(link.id || slugifyLinkName(link.name));
  if (!id) {
    throw new BadRequest("link id must be filesystem-safe", { field: "id" });
  }

  const resolved: Link = {
    id,
    name: link.name,
    description: link.description || "",
    version: link.version || "1.0.0",
    agents: link.agents,
    config: {
      max_rounds: link.config.max_rounds ?? 0,
      mode: link.config.mode,
      stall_threshold: link.config.stall_threshold,
      leading_prompt: link.config.leading_prompt,
      agent1_prompt: link.config.agent1_prompt,
      agent2_prompt: link.config.agent2_prompt,
      auto_plan: link.config.auto_plan,
      on_complete: link.config.on_complete || "stop",
      emits: link.config.emits,
    },
    metadata: link.metadata,
    status: link.status || "draft",
    created_at: link.created_at || now,
    updated_at: now,
  };

  const linksDir = orgPath(namespaceId, orgId, "links");
  saveLink(linksDir, resolved);

  return apiSuccess({ link: resolved });
});
