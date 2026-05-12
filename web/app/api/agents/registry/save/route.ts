import { NextRequest } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  const blockResult = await enforceGuestWrites(request);
  if (blockResult?.blocked) return blockResult.response;

  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { agent, name } = await request.json();

  if (!agent || !agent.id || !agent.name) {
    throw new BadRequest("agent with id and name is required");
  }

  if (!agent.triggers || !agent.emits) {
    throw new BadRequest("agent must have triggers and emits");
  }

  const slug = (name || agent.id)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const agentDir = join(config.agentsDir, slug);
  const agentPath = join(agentDir, "agent.json");

  const now = new Date().toISOString();
  const agentData = {
    ...agent,
    created_at: agent.created_at || now,
    updated_at: now,
  };

  mkdirSync(agentDir, { recursive: true });
  writeFileSync(agentPath, JSON.stringify(agentData, null, 2));

  return apiSuccess({ path: agentPath, id: slug });
});
