import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getTemplates,
  saveTemplates,
  type GenerationTemplate,
} from "@/lib/generation-template-storage";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const VALID_IDS = ["chain_generation", "agent_generation", "task_generation", "chain_recommendation", "decision_research", "decision_steering", "decision_retrospective", "agent_edit", "webhook_inbound", "webhook_outbound", "event_trigger", "link_summary"];

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const templates = getTemplates(nsId, orgId);
  return apiSuccess({ templates });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { templates } = body as { templates: GenerationTemplate[] };

  if (!templates || !Array.isArray(templates)) {
    throw new BadRequest("templates array is required");
  }

  for (const t of templates) {
    if (!VALID_IDS.includes(t.id)) {
      throw new BadRequest(`invalid template id: ${t.id}`);
    }
    if (!t.content || typeof t.content !== "string") {
      throw new BadRequest(`template ${t.id} must have content string`);
    }
    t.updatedAt = new Date().toISOString();
  }

  saveTemplates(nsId, orgId, templates);
  return apiSuccess({ templates });
});
