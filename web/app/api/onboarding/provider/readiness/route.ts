import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { getProfile, listProfiles } from "@/lib/agents/agent-profile-storage";
import { resolveRunAgentProfile } from "@/lib/agents/run-agent-profile";
import { getWorkspace } from "@/lib/workspaces/workspace-storage";
import { startChainRun } from "@/lib/runs/chain-run-service";
import { readOnboardingState, writeOnboardingState, nextOperation, CURRENT_SETUP_VERSION, READINESS_DEADLINE_MS } from "@/lib/onboarding/onboarding-state";
import type { Chain } from "@/lib/types";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const body = await request.json();
  const profileId = String(body.profileId || "");
  const key = String(body.idempotencyKey || "");
  const setupVersion = Number(body.setupVersion);
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId.trim() ? body.workspaceId.trim() : undefined;
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
  // verify the workspace belongs to the current scope (spec "POST /api/onboarding/provider/readiness")
  const workspace = workspaceId ? getWorkspace(namespaceId, orgId, workspaceId) : null;
  if (workspaceId && !workspace) throw new BadRequest("Workspace not found or not accessible", { workspaceId });
  // Run-resolution rules: never a silent fallback away from the explicit onboarding profile.
  const resolution = resolveRunAgentProfile({
    requestedProfileId: profileId,
    chainDefaultProfileId: profileId,
    workspaceDefaultProfileId: workspace?.default_agent_profile,
    profiles: listProfiles(namespaceId, orgId),
  });
  if (!resolution || resolution.id !== profileId) {
    throw new BadRequest("Resolved agent profile did not match the requested onboarding profile", {
      requestedProfileId: profileId,
      effectiveProfileId: resolution?.id ?? null,
    });
  }
  const requestFingerprint = JSON.stringify({ profileId, workspaceId, setupVersion });
  const opResult = nextOperation(namespaceId, orgId, "provider_readiness", key, "readiness", requestFingerprint, READINESS_DEADLINE_MS);
  if (opResult.reused && opResult.op.status === "timed_out") throw new BadRequest("Readiness operation deadline exceeded", { operationId: opResult.op.operationId, errorCode: opResult.op.errorCode });
  if (opResult.reused && "result" in opResult.op && opResult.op.result) return apiSuccess(opResult.op.result);
  const chain: Chain = {
    id: "onboarding-provider-readiness",
    name: "Onboarding provider readiness",
    version: "1.0.0",
    description: "Verifies the selected provider can execute a runner probe.",
    default_agent_profile: profileId,
    config: { cli: profile.cli, cli_args: profile.extra_args, monitor: true, max_rounds: 1, session_prefix: "onboarding-readiness" },
    agents: [{
      id: "readiness-probe", name: "Readiness Probe", role: "Verify provider readiness.",
      prompt: [
        "Readiness probe for Mentiko agent profile.",
        "Do not modify files or run long tasks.",
        "Confirm that the session is ready and answer in one short sentence.",
      ].join("\n"),
      triggers: ["manual-start"], emits: "readiness-complete", agent_profile: profileId, timeout: 120,
    }],
  };
  const run = await startChainRun({
    request, namespaceId, orgId,
    body: {
      chain, chainId: chain.id, agentProfileId: profileId, ...(workspaceId ? { workspaceId } : {}),
      // NOT runnerV2Probe: true — that flag makes startChainRun run an unrelated
      // hardcoded "writer/reviewer" synthetic smoke-test pipeline and force the
      // run to "completed" without ever launching the real agent (see
      // lib/runs/chain-run-service.ts ~line 626). It was set here before this
      // fix, which is exactly why the live stuck run (run-1788589600205-e1834a43)
      // showed status "completed" while its actual readiness-probe agent sat
      // "cancelled" (never started, later reaped): the readiness check was
      // decorative — it never touched the user's real selected CLI. Omitting it
      // routes through the same real chain-runner launch test-session/route.ts
      // already uses for a genuine readiness proof.
      metadata: {
        source: "onboarding-provider-readiness", workspaceId: workspaceId ?? null, setupVersion,
        requestedProfileId: profileId, effectiveProfileId: resolution.id,
      },
    },
  });
  // deadlineAt is the operation's own stored deadline (READINESS_DEADLINE_MS from
  // its creation above) — never recomputed here, so a replay/poll always agrees
  // with the ledger instead of drifting from a freshly-computed "now + 90s".
  const result = { operationId: opResult.op.operationId, runId: run.runId, pollUrl: `/api/runs/${run.runId}`, deadline: opResult.op.deadlineAt, status: "in_progress", profileId };
  const state = readOnboardingState(namespaceId, orgId);
  state.setupVersion = setupVersion;
  state.readiness = { status: "in_progress", runId: run.runId, operationId: opResult.op.operationId, deadlineAt: opResult.op.deadlineAt };
  state.operations[opResult.op.operationId] = { ...opResult.op, result };
  writeOnboardingState(namespaceId, orgId, state, opResult.state.revision);
  return apiSuccess(result);
});
