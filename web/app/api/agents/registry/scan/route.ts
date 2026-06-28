import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { scanAllSkills, skillToAgent } from "@/lib/system/skill-scanner";
import { getAllStandaloneAgents } from "@/lib/agents/agent-loader";
import config from "@/lib/config";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/registry/scan
 *
 * Scans known CLI tool skill directories and returns:
 *   - discovered skills not yet imported
 *   - already imported skills (for status display)
 */
export const GET = withErrorHandling(async (req: NextRequest) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized("Authentication required");
  }

  const namespaceId = await getNamespaceIdFromRequest(req);
  const skills = scanAllSkills(config.root);

  // get existing standalone agents to check what's already imported
  const existingAgents = getAllStandaloneAgents(namespaceId);
  const existingIds = new Set(existingAgents.map((a) => a.id));

  // check which have source_skill (imported from scan)
  const importedFromSkill = new Set(
    existingAgents
      .filter((a) => a.source_skill)
      .map((a) => a.source_skill!.path)
  );

  const results = skills.map((skill) => {
    const agentPreview = skillToAgent(skill);
    const alreadyImported = existingIds.has(skill.id) || importedFromSkill.has(skill.path);

    return {
      skill,
      agent: agentPreview,
      status: alreadyImported ? ("imported" as const) : ("available" as const),
    };
  });

  return apiSuccess({
    skills: results,
    total: results.length,
    available: results.filter((r) => r.status === "available").length,
    imported: results.filter((r) => r.status === "imported").length,
  });
});
