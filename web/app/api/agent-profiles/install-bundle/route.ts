import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  createProfile,
  listProfiles,
} from "@/lib/agent-profile-storage";
import {
  getBundleByProvider,
  bundleProfileToAgentProfile,
} from "@/lib/provider-bundles";
import type { AgentProfileProvider } from "@/lib/types";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { provider } = body as { provider: AgentProfileProvider };

  if (!provider) {
    throw new BadRequest("provider is required", { field: "provider" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const bundle = getBundleByProvider(provider);

  if (!bundle) {
    throw new BadRequest(`Unknown provider: ${provider}`, { provider });
  }

  const installed: string[] = [];
  const skipped: string[] = [];
  const existingProfiles = listProfiles(namespaceId, orgId);
  const existingIds = new Set(existingProfiles.map((p) => p.id));
  const hasDefault = existingProfiles.some((p) => p.isDefault);

  for (const bundleProfile of bundle.profiles) {
    if (existingIds.has(bundleProfile.id)) {
      skipped.push(bundleProfile.id);
    } else {
      const profileData = bundleProfileToAgentProfile(bundleProfile, bundle);
      createProfile(namespaceId, orgId, profileData);
      installed.push(bundleProfile.id);
    }
  }

  // If no default exists, mark first installed as default
  if (!hasDefault && installed.length > 0) {
    const { updateProfile } = await import("@/lib/agent-profile-storage");
    updateProfile(namespaceId, orgId, installed[0], { isDefault: true });
  }

  return apiSuccess({ installed, skipped });
});
