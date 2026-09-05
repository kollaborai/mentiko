import { NextRequest } from "next/server";
import { join } from "path";
import { unlinkSync } from "fs";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { readOnboardingState, writeOnboardingState, nextOperation, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";
import { getCatalogBundleByProvider } from "@/lib/agents/agent-provider-catalog";
import { getProfile, getProfilesDir, listProfiles, updateProfile } from "@/lib/agents/agent-profile-storage";
import { POST as installBundle } from "@/app/api/agent-profiles/install-bundle/route";
import { selectOnboardingProfileId } from "@/lib/onboarding/select-provider-profile";
import type { AgentProfileProvider } from "@/lib/types";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  // Clone to read our copy: the original request body is forwarded, still unread, to installBundle().
  const body = await request.clone().json();
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
  const beforeById = new Map(before.map((p) => [p.id, p]));
  const beforeDefault = before.find((p) => p.isDefault)?.id ?? null;
  const beforeAdvisorDefault = before.find((p) => p.isAdvisorDefault)?.id ?? null;
  const state = readOnboardingState(namespaceId, orgId);
  try {
    const response = await installBundle(request);
    if (!response.ok) throw new Error(`Bundle installation failed (${response.status})`);
    const profileId = selectOnboardingProfileId(bundle.profiles, String(body.profileId || ""));
    // makeDefault missing => true (backward compat with existing callers that
    // never sent it). false is the spec's "Keep current default" choice: the
    // selected profile is still bound explicitly to every onboarding run
    // (fact 4's OR clause), it just never touches the global isDefault flag.
    const makeDefault = body.makeDefault !== false;
    // Match on the bundle's declared CLI, not the provider key: bundleProvider
    // (e.g. "claude-code", "antigravity") differs from the CLI binary (e.g. "claude", "agy").
    const bundleCli = bundle.profiles.find((p) => p.id === profileId)?.cli;
    let profiles = listProfiles(namespaceId, orgId);
    const selected = profiles.find((profile) => profile.id === profileId && profile.cli === bundleCli);
    if (!selected) throw new BadRequest("Requested provider profile was not installed", { profileId });
    if (makeDefault) {
      // updateProfile enforces uniqueness; explicitly clear stale defaults first.
      for (const profile of profiles) {
        if (profile.id !== selected.id && profile.isDefault) updateProfile(namespaceId, orgId, profile.id, { isDefault: false });
      }
      if (!getProfile(namespaceId, orgId, selected.id)?.isDefault) updateProfile(namespaceId, orgId, selected.id, { isDefault: true });
      profiles = listProfiles(namespaceId, orgId);
    }
    // The advisor default rule (G5) is independent of makeDefault — it always runs.
    if (!profiles.some((profile) => profile.isAdvisorDefault)) updateProfile(namespaceId, orgId, selected.id, { isAdvisorDefault: true });
    profiles = listProfiles(namespaceId, orgId);
    const active = getProfile(namespaceId, orgId, selected.id);
    const agentDefaults = profiles.filter((profile) => profile.isDefault);
    const advisorDefaults = profiles.filter((profile) => profile.isAdvisorDefault);
    const defaultVerified = makeDefault
      ? Boolean(active?.isDefault) && agentDefaults.length === 1 && advisorDefaults.length === 1
      : Boolean(active); // keep_current: verified means "exists and onboarding binds it explicitly", not "is the global default"
    if (!active || !defaultVerified) throw new Error("Provider defaults could not be verified");
    const updated = readOnboardingState(namespaceId, orgId);
    updated.setupVersion = setupVersion;
    updated.defaultIntent = makeDefault ? "use_selected" : "keep_current";
    // Facts 6/8: the readiness/sample proof is bound to the selected profile.
    // Switching providers must not let Step 3 keep showing a stale run that
    // belongs to a different profile — reset the pointers (the old operations
    // stay in the ledger, just unreferenced) and let a fresh readiness/sample
    // run bind to the new selection. derive-onboarding-state.ts also checks
    // run.agentProfileId against the live selection as a second line of
    // defense in case a run somehow outlives this reset.
    if (state.provider.selectedProfileId && state.provider.selectedProfileId !== active.id) {
      updated.readiness = { status: "not_started", runId: null, operationId: null };
      updated.sampleRun = { status: "not_started", runId: null, operationId: null };
    }
    // G4 / The invariant: activation is not proof. "in_progress" means
    // activated and awaiting the separate readiness run; the derive layer
    // (derive-onboarding-state.ts) is the only place that promotes this to
    // "ready", and only once readiness has actually passed for this profile.
    updated.provider = { selectedCli: provider, selectedProfileId: active.id, defaultVerified, status: "in_progress", lastError: null };
    const readinessAvailable = Boolean(active.readiness?.enabled) && (active.readiness?.ready_patterns?.length ?? 0) > 0;
    const completedOp = { ...result.op, status: "completed", terminalAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: { profileId: active.id, defaultVerified } };
    updated.operations[completedOp.operationId] = completedOp;
    writeOnboardingState(namespaceId, orgId, updated, result.state.revision);
    const afterProfiles = listProfiles(namespaceId, orgId);
    const bundleAlreadyPresent = before.length === afterProfiles.length && afterProfiles.every((p) => beforeById.has(p.id));
    const profileSynced = afterProfiles.some((p) => !beforeById.has(p.id) || JSON.stringify(p) !== JSON.stringify(beforeById.get(p.id)));
    const defaultChanged = makeDefault
      && (beforeDefault !== active.id || beforeAdvisorDefault !== afterProfiles.find((p) => p.isAdvisorDefault)?.id);
    return apiSuccess({ bundleInstalled: !bundleAlreadyPresent, bundleAlreadyPresent, profileSynced,
      defaultChanged, defaultVerified, defaultIntent: updated.defaultIntent, readinessAvailable,
      profileId: active.id, profileDisplayName: active.name, model: active.model ?? null,
      operationId: completedOp.operationId, operationStatus: completedOp.status, phase: completedOp.phase, errorCode: null });
  } catch (error) {
    const failed = { ...result.op, status: "failed", terminalAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorCode: error instanceof Error ? error.name : "ACTIVATION_FAILED", errorMessage: error instanceof Error ? error.message : "Provider activation failed" };
    try { const failedState = readOnboardingState(namespaceId, orgId); failedState.operations[failed.operationId] = failed; writeOnboardingState(namespaceId, orgId, failedState); } catch { /* preserve original error */ }
    // Restore profile flags/data if activation or state CAS fails.
    const after = listProfiles(namespaceId, orgId);
    for (const profile of after) {
      if (!before.some((p) => p.id === profile.id)) {
        try { unlinkSync(join(getProfilesDir(namespaceId, orgId), `${profile.id}.json`)); } catch { /* best effort */ }
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
