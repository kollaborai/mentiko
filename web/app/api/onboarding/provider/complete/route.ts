import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { readOnboardingState, writeOnboardingState, nextOperation, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";
import { getCatalogBundleByProvider } from "@/lib/agents/agent-provider-catalog";
import { getProfile, listProfiles, updateProfile } from "@/lib/agents/agent-profile-storage";
import { POST as installBundle } from "@/app/api/agent-profiles/install-bundle/route";
import type { AgentProfileProvider } from "@/lib/types";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const body = await request.json();
  const provider = String(body.provider || "") as AgentProfileProvider;
  const key = String(body.idempotencyKey || "");
  const setupVersion = Number(body.setupVersion);
  if (!provider || !key) throw new BadRequest("provider and idempotencyKey are required");
  if (!Number.isInteger(setupVersion) || setupVersion !== CURRENT_SETUP_VERSION) {
    throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  }
  const bundle = getCatalogBundleByProvider(provider);
  if (!bundle) throw new BadRequest(`Unknown provider: ${provider}`);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const result = nextOperation(namespaceId, orgId, "provider_complete", key, "activation");
  if (result.reused) {
    const current = readOnboardingState(namespaceId, orgId);
    return apiSuccess({ bundleInstalled: true, bundleAlreadyPresent: true, profileSynced: true,
      defaultChanged: false, defaultVerified: current.provider.defaultVerified,
      readinessAvailable: false, operationId: result.op.operationId,
      operationStatus: result.op.status, phase: result.op.phase, errorCode: null });
  }
  const before = listProfiles(namespaceId, orgId);
  const state = readOnboardingState(namespaceId, orgId);
  try {
    const response = await installBundle(request);
    if (!response.ok) throw new Error(`Bundle installation failed (${response.status})`);
    const profileId = String(body.profileId || bundle.profiles[0]?.id || "");
    let profiles = listProfiles(namespaceId, orgId);
    const selected = profiles.find((profile) => profile.id === profileId && profile.cli === provider);
    if (!selected) throw new BadRequest("Requested provider profile was not installed", { profileId });
    // updateProfile enforces uniqueness; explicitly clear stale defaults first.
    for (const profile of profiles) {
      if (profile.id !== selected.id && profile.isDefault) updateProfile(namespaceId, orgId, profile.id, { isDefault: false });
    }
    if (!getProfile(namespaceId, orgId, selected.id)?.isDefault) updateProfile(namespaceId, orgId, selected.id, { isDefault: true });
    profiles = listProfiles(namespaceId, orgId);
    if (!profiles.some((profile) => profile.isAdvisorDefault)) updateProfile(namespaceId, orgId, selected.id, { isAdvisorDefault: true });
    profiles = listProfiles(namespaceId, orgId);
    const active = getProfile(namespaceId, orgId, selected.id);
    const agentDefaults = profiles.filter((profile) => profile.isDefault);
    const advisorDefaults = profiles.filter((profile) => profile.isAdvisorDefault);
    const defaultVerified = Boolean(active?.isDefault) && agentDefaults.length === 1 && advisorDefaults.length === 1;
    if (!active || !defaultVerified) throw new Error("Provider defaults could not be verified");
    const updated = readOnboardingState(namespaceId, orgId);
    updated.setupVersion = setupVersion;
    updated.provider = { selectedCli: provider, selectedProfileId: active.id, defaultVerified, status: "ready" };
    writeOnboardingState(namespaceId, orgId, updated, result.state.revision);
    return apiSuccess({ bundleInstalled: true, bundleAlreadyPresent: false, profileSynced: true,
      defaultChanged: true, defaultVerified, readinessAvailable: Boolean(active.readiness?.enabled),
      operationId: result.op.operationId, operationStatus: result.op.status, phase: result.op.phase, errorCode: null });
  } catch (error) {
    // Restore profile flags/data if activation or state CAS fails.
    const after = listProfiles(namespaceId, orgId);
    for (const profile of after) {
      if (!before.some((p) => p.id === profile.id)) {
        try { const file = require("path").join(require("@/lib/agents/agent-profile-storage").getProfilesDir(namespaceId, orgId), `${profile.id}.json`); require("fs").unlinkSync(file); } catch { /* best effort */ }
      }
    }
    for (const profile of before) {
      const current = getProfile(namespaceId, orgId, profile.id);
      if (current) updateProfile(namespaceId, orgId, profile.id, { ...profile });
    }
    try { writeOnboardingState(namespaceId, orgId, state); } catch { /* preserve original error */ }
    throw error;
  }
});
