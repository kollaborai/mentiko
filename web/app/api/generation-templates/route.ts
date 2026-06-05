import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getTemplates,
  saveTemplates,
  getDefaultTemplates,
  type GenerationTemplate,
} from "@/lib/generation/generation-template-storage";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Valid ids = exactly the built-in template ids, derived from getDefaultTemplates() so the
// allow-list can never drift from the editor's template list. A previously hand-maintained
// list omitted 6 ids (guided questions/options/plan, preference_synthesis,
// artifact_generation, link_generation); since the UI's "save templates" PUTs ALL templates
// at once, the route rejected the whole batch with a 400 — silently breaking all generation
// customization in the UI.
const VALID_IDS = new Set(getDefaultTemplates().map((t) => t.id));
const CUSTOM_ID_RE = /^custom_[A-Za-z0-9_-]+$/;

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
    const isCustomTemplate = CUSTOM_ID_RE.test(t.id);
    if (!VALID_IDS.has(t.id) && !isCustomTemplate) {
      throw new BadRequest(`invalid template id: ${t.id}`);
    }
    if (typeof t.content !== "string" || (!isCustomTemplate && !t.content)) {
      throw new BadRequest(`template ${t.id} must have content string`);
    }
    t.updatedAt = new Date().toISOString();
  }

  saveTemplates(nsId, orgId, templates);
  return apiSuccess({ templates });
});
