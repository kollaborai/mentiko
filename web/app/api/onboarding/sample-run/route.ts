import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { getProfile, listProfiles } from "@/lib/agents/agent-profile-storage";
import { resolveRunAgentProfile } from "@/lib/agents/run-agent-profile";
import { getWorkspace } from "@/lib/workspaces/workspace-storage";
import { startChainRun } from "@/lib/runs/chain-run-service";
import {
  ensureOnboardingSampleChain,
  getOnboardingSampleChain,
  ONBOARDING_SAMPLE_CHAIN_ID,
  ONBOARDING_SAMPLE_DEFAULT_GOAL,
} from "@/lib/onboarding/onboarding-sample-template";
import { readOnboardingState, writeOnboardingState, nextOperation, CURRENT_SETUP_VERSION, SAMPLE_RUN_DEADLINE_MS } from "@/lib/onboarding/onboarding-state";
import { deriveOnboardingState } from "@/lib/onboarding/derive-onboarding-state";
import type { Chain } from "@/lib/types";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const body = await request.json();
  const profileId = String(body.profileId || "");
  const workspaceId = String(body.workspaceId || "");
  const key = String(body.idempotencyKey || "");
  const setupVersion = Number(body.setupVersion);
  if (!profileId || !workspaceId || !key) throw new BadRequest("profileId, workspaceId and idempotencyKey are required");
  if (setupVersion !== CURRENT_SETUP_VERSION) throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  // Derived, not raw: provider.status only reaches "ready" once the derive
  // layer sees a passing readiness run (G4). Reading the pointer straight off
  // disk here would still see "in_progress" and reject a genuinely-ready
  // setup. Accept either the already-derived "ready", or the equivalent
  // condition computed inline (defaultVerified + readiness ready) so a
  // request racing the next GET /state still passes — fail-closed either way.
  const state = deriveOnboardingState(namespaceId, orgId);
  const providerOk = state.provider.status === "ready" || (state.provider.defaultVerified === true && state.readiness.status === "ready");
  if (state.provider.selectedProfileId !== profileId || !providerOk) throw new BadRequest("Profile is not verified for onboarding");
  const profile = getProfile(namespaceId, orgId, profileId);
  const workspace = getWorkspace(namespaceId, orgId, workspaceId);
  if (!profile || !workspace || state.workspace.id !== workspaceId || state.workspace.status !== "ready") throw new BadRequest("Workspace is not ready for onboarding");
  // Run-resolution rules: the onboarding sample always sends an explicit
  // profile ID, and a workspace default may never silently override it.
  // Pre-check the exact resolution startChainRun will perform so a mismatch
  // is a visible error, never a silent fallback, and never after a run has
  // already been created.
  const resolution = resolveRunAgentProfile({
    requestedProfileId: profileId,
    chainDefaultProfileId: profileId,
    workspaceDefaultProfileId: workspace.default_agent_profile,
    profiles: listProfiles(namespaceId, orgId),
  });
  if (!resolution || resolution.id !== profileId) {
    throw new BadRequest("Resolved agent profile did not match the requested onboarding profile", {
      requestedProfileId: profileId,
      effectiveProfileId: resolution?.id ?? null,
    });
  }
  const requestFingerprint = JSON.stringify({ profileId, workspaceId, setupVersion });
  const opResult = nextOperation(namespaceId, orgId, "sample_run", key, "sample-run", requestFingerprint, SAMPLE_RUN_DEADLINE_MS);
  if (opResult.reused && opResult.op.status === "timed_out") throw new BadRequest("Sample run deadline exceeded", { operationId: opResult.op.operationId, errorCode: opResult.op.errorCode });
  if (opResult.reused && "result" in opResult.op && opResult.op.result) return apiSuccess(opResult.op.result);
  ensureOnboardingSampleChain(namespaceId, orgId);
  const chain: Chain = { ...(getOnboardingSampleChain() as unknown as Chain), default_agent_profile: profileId };
  const run = await startChainRun({
    request, namespaceId, orgId,
    body: {
      chain, chainId: ONBOARDING_SAMPLE_CHAIN_ID, workspaceId, agentProfileId: profileId,
      userPrompt: ONBOARDING_SAMPLE_DEFAULT_GOAL,
      metadata: {
        source: "onboarding-sample-run",
        requestedProfileId: profileId,
        effectiveProfileId: resolution.id,
        workspaceId,
        setupVersion,
      },
    },
  });
  const result = { operationId: opResult.op.operationId, status: "in_progress", runId: run.runId, profileId, workspaceId, mutatesWorkspace: false, deadline: opResult.op.deadlineAt };
  const next = readOnboardingState(namespaceId, orgId);
  next.sampleRun = { status: "in_progress", runId: run.runId, operationId: opResult.op.operationId, deadlineAt: opResult.op.deadlineAt };
  next.operations[opResult.op.operationId] = { ...opResult.op, result };
  writeOnboardingState(namespaceId, orgId, next, opResult.state.revision);
  return apiSuccess(result);
});
