import { NextRequest } from "next/server";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { scanAllSkills, skillToAgent } from "@/lib/system/skill-scanner";
import config from "@/lib/config";
import { BadRequest } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/registry/import
 *
 * Import skills as standalone agents.
 * body: { skillIds: string[] }  - IDs of skills to import
 *        or { all: true }       - import all available skills
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { skillIds, all } = await request.json();

  const skills = scanAllSkills(config.root);

  const toImport = all
    ? skills
    : skills.filter((s) => skillIds?.includes(s.id));

  if (toImport.length === 0) {
    throw new BadRequest("No matching skills found");
  }

  const imported: string[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const skill of toImport) {
    try {
      const agent = skillToAgent(skill);
      const now = new Date().toISOString();
      const agentData = {
        ...agent,
        created_at: now,
        updated_at: now,
      };

      const agentDir = join(
        config.root,
        "namespaces",
        namespaceId,
        "agents",
        agent.id
      );
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, "agent.json"),
        JSON.stringify(agentData, null, 2)
      );
      imported.push(agent.id);
    } catch (err) {
      errors.push({
        id: skill.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return apiSuccess({
    imported,
    errors,
    total: imported.length,
  });
});
