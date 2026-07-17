import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getDefaultMonitorPrompts,
  getMonitorPrompts,
  saveMonitorPrompts,
  type MonitorPrompt,
} from "@/lib/monitor/monitor-prompt-storage";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Valid ids = exactly the shipped monitor prompt ids, derived from the defaults
// so the allow-list can never drift from the storage module.
const VALID_IDS = new Set(getDefaultMonitorPrompts().map((p) => p.id));

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const prompts = getMonitorPrompts(namespaceId, orgId);
  return apiSuccess({ prompts });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { prompts } = body as { prompts: MonitorPrompt[] };

  if (!prompts || !Array.isArray(prompts)) {
    throw new BadRequest("prompts array is required");
  }
  for (const prompt of prompts) {
    if (!VALID_IDS.has(prompt.id)) {
      throw new BadRequest(`invalid monitor prompt id: ${prompt.id}`);
    }
    if (typeof prompt.content !== "string" || !prompt.content.trim()) {
      throw new BadRequest(`monitor prompt ${prompt.id} must have content`);
    }
    prompt.updatedAt = new Date().toISOString();
  }

  saveMonitorPrompts(namespaceId, orgId, prompts);
  return apiSuccess({ prompts: getMonitorPrompts(namespaceId, orgId) });
});
