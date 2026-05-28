import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listProfiles, createProfile, slugify, updateProfile } from "@/lib/agent-profile-storage";
import { getLegacyProfileSyncUpdates } from "@/lib/agent-profile-legacy-sync";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  let profiles = listProfiles(namespaceId, orgId);
  let syncedLegacy = false;

  for (const profile of profiles) {
    const updates = getLegacyProfileSyncUpdates(profile);
    if (updates) {
      updateProfile(namespaceId, orgId, profile.id, updates);
      syncedLegacy = true;
    }
  }

  if (syncedLegacy) {
    profiles = listProfiles(namespaceId, orgId);
  }

  return apiSuccess({ profiles });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const {
    id,
    name,
    description,
    isDefault,
    isAdvisorDefault,
    cli,
    model,
    relay_model,
    pipe_flag,
    permission_flag,
    extra_args,
    disallowed_tools,
    env,
    pre_exec,
    log_path,
    log_format,
  } = body as {
    id?: string;
    name: string;
    description?: string;
    isDefault?: boolean;
    isAdvisorDefault?: boolean;
    cli: string;
    model?: string;
    relay_model?: string;
    pipe_flag?: string;
    permission_flag?: string;
    extra_args?: string[];
    disallowed_tools?: string;
    env?: Record<string, string>;
    pre_exec?: string;
    log_path?: string;
    log_format?: string;
  };

  if (!name || !cli) {
    throw new BadRequest("name and cli are required", { field: "name" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const profileId = id || slugify(name);

  const profile = createProfile(namespaceId, orgId, {
    id: profileId,
    name,
    description,
    isDefault: isDefault || false,
    isAdvisorDefault: isAdvisorDefault || false,
    cli,
    model,
    relay_model,
    pipe_flag,
    permission_flag,
    extra_args: extra_args || [],
    disallowed_tools,
    env: env || {},
    pre_exec,
    log_path,
    log_format,
  });

  return apiSuccess({ profile }, undefined, 201);
});
