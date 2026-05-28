import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  createProfile,
  listProfiles,
  updateProfile,
} from "@/lib/agent-profile-storage";
import {
  getBundleByProvider,
  bundleProfileToAgentProfile,
  getLegacyProfileReplacementsByProvider,
} from "@/lib/provider-bundles";
import type { AgentProfileProvider } from "@/lib/types";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type BundleProfileSyncData = ReturnType<typeof bundleProfileToAgentProfile>;

const SYNC_FIELDS = [
  "name",
  "description",
  "cli",
  "model",
  "relay_model",
  "pipe_flag",
  "permission_flag",
  "extra_args",
  "disallowed_tools",
  "env",
  "pre_exec",
  "log_path",
  "log_format",
] as const satisfies readonly (keyof BundleProfileSyncData)[];

function normalizeBundleProfile(profile: BundleProfileSyncData): BundleProfileSyncData {
  return {
    ...profile,
    description: profile.description ?? "",
    model: profile.model ?? "",
    relay_model: profile.relay_model ?? "",
    pipe_flag: profile.pipe_flag ?? "",
    permission_flag: profile.permission_flag ?? "",
    disallowed_tools: profile.disallowed_tools ?? "",
    env: profile.env ?? {},
    pre_exec: profile.pre_exec ?? "",
    log_path: profile.log_path ?? "",
    log_format: profile.log_format ?? "",
  };
}

function hasChanged(current: unknown, next: unknown): boolean {
  return JSON.stringify(current ?? "") !== JSON.stringify(next ?? "");
}

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
  const synced: string[] = [];
  const existingProfiles = listProfiles(namespaceId, orgId);
  const existingById = new Map(existingProfiles.map((p) => [p.id, p]));
  const existingIds = new Set(existingProfiles.map((p) => p.id));
  const hasDefault = existingProfiles.some((p) => p.isDefault);
  let hasAdvisorDefault = existingProfiles.some((p) => p.isAdvisorDefault);

  const bundleProfiles = [
    ...bundle.profiles.map((profile) => ({ profile, createIfMissing: true })),
    ...getLegacyProfileReplacementsByProvider(provider).map((profile) => ({
      profile,
      createIfMissing: false,
    })),
  ];

  for (const { profile: bundleProfile, createIfMissing } of bundleProfiles) {
    const baseProfileData = normalizeBundleProfile(bundleProfileToAgentProfile(bundleProfile, bundle));
    if (existingIds.has(bundleProfile.id)) {
      const existing = existingById.get(bundleProfile.id);
      const updates: Partial<ReturnType<typeof bundleProfileToAgentProfile>> = {};
      for (const field of SYNC_FIELDS) {
        if (existing && hasChanged(existing[field], baseProfileData[field])) {
          updates[field] = baseProfileData[field] as never;
        }
      }

      if (!hasAdvisorDefault && bundleProfile.preferredAdvisorDefault === true) {
        updates.isAdvisorDefault = true;
        hasAdvisorDefault = true;
      }

      if (Object.keys(updates).length > 0) {
        updateProfile(namespaceId, orgId, bundleProfile.id, updates);
        synced.push(bundleProfile.id);
      } else {
        skipped.push(bundleProfile.id);
      }
    } else if (!createIfMissing) {
      continue;
    } else {
      const isAdvisorDefault =
        !hasAdvisorDefault && bundleProfile.preferredAdvisorDefault === true;
      const profileData = {
        ...baseProfileData,
        isAdvisorDefault,
      };
      createProfile(namespaceId, orgId, profileData);
      if (isAdvisorDefault) hasAdvisorDefault = true;
      installed.push(bundleProfile.id);
    }
  }

  // If no default exists, mark first installed as default
  if (!hasDefault && installed.length > 0) {
    updateProfile(namespaceId, orgId, installed[0], { isDefault: true });
  }

  return apiSuccess({ installed, skipped, synced });
});
