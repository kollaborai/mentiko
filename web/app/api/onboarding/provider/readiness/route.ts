import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { startChainRun } from "@/lib/runs/chain-run-service";
import { readOnboardingState, writeOnboardingState, nextOperation, CURRENT_SETUP_VERSION, type OnboardingRecord } from "@/lib/onboarding/onboarding-state";
import type { Chain } from "@/lib/types";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const body = await request.json();
  const profileId = String(body.profileId || "");
  const key = String(body.idempotencyKey || "");
  const setupVersion = Number(body.setupVersion);
  if (!profileId || !key) throw new BadRequest("profileId and idempotencyKey are required");
  if (!Number.isInteger(setupVersion) || setupVersion !== CURRENT_SETUP_VERSION) {
    throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const profile = getProfile(namespaceId, orgId, profileId);
  if (!profile) throw new BadRequest("Profile not found");
  const current = readOnboardingState(namespaceId, orgId);
  if (current.provider.selectedProfileId && current.provider.selectedProfileId !== profileId) {
    throw new BadRequest("Profile is not the active onboarding profile", { profileId });
  }
  const opResult = nextOperation(namespaceId, orgId, "provider_readiness", key, "readiness");
  if (opResult.reused && "result" in opResult.op && opResult.op.result) return apiSuccess(opResult.op.result);
  const chain: Chain = {
    id: "onboarding-provider-readiness",
    name: "Onboarding provider readiness",
    version: "1.0.0",
    description: "Verifies the selected provider can execute a runner probe.",
    default_agent_profile: profileId,
    config: { cli: profile.cli, cli_args: profile.extra_args, monitor: true, max_rounds: 1, session_prefix: "onboarding-readiness" },
    agents: [{ id: "readiness-probe", name: "Readiness Probe", role: "Verify provider readiness.", prompt: "Start and respond briefly. Do not modify files.", triggers: ["manual-start"], emits: "readiness-complete", agent_profile: profileId }],
  };
  const run = await startChainRun({
    request, namespaceId, orgId,
    body: { chain, chainId: chain.id, agentProfileId: profileId, metadata: { source: "onboarding-provider-readiness", runnerV2Probe: true } },
  });
  const result = { operationId: opResult.op.operationId, runId: run.runId, pollUrl: `/api/runs/${run.runId}`, deadline: new Date(Date.now() + 90000).toISOString(), status: "in_progress", profileId };
  const state = readOnboardingState(namespaceId, orgId);
  state.setupVersion = setupVersion;
  state.readiness = { status: "in_progress", runId: run.runId, operationId: opResult.op.operationId };
  state.operations[opResult.op.operationId] = { ...opResult.op, result };
  writeOnboardingState(namespaceId, orgId, state, opResult.state.revision);
  return apiSuccess(result);
});
