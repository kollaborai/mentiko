import { NextRequest } from "next/server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import { startChainRun } from "@/lib/runs/chain-run-service";
import { Forbidden, NotFound, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import type { AgentProfile, Chain } from "@/lib/types";

export const dynamic = "force-dynamic";

const READINESS_TEST_CHAIN_ID = "agent-profile-readiness-test";

function buildReadinessTestChain(profile: AgentProfile): Chain {
  return {
    id: READINESS_TEST_CHAIN_ID,
    name: `Readiness test: ${profile.name}`,
    description: "Runs the selected agent profile through the real chain runner and readiness gate.",
    version: "1.0.0",
    default_agent_profile: profile.id,
    config: {
      cli: profile.cli,
      cli_args: profile.extra_args,
      monitor: true,
      max_rounds: 1,
      session_prefix: "profile-readiness",
    },
    agents: [
      {
        id: "readiness_probe",
        name: "Readiness Probe",
        role: "Verify the selected agent profile can start, pass readiness, and answer once.",
        prompt: [
          "Readiness probe for Mentiko agent profile.",
          "Do not modify files or run long tasks.",
          "Confirm that the session is ready and briefly identify the profile under test.",
        ].join("\n"),
        triggers: ["manual-start"],
        emits: "readiness_test_complete",
        timeout: 120,
        agent_profile: profile.id,
      },
    ],
    metadata: {
      source: "agent-profile-test-session",
      profileId: profile.id,
    },
  };
}

export const POST = withErrorHandling(
  async (
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
  ) => {
    const permError = await requirePermission(request, "manage_chains");
    if (permError) return permError;

    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
      throw new Unauthorized();
    }

    const { id } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);
    const profileId = decodeURIComponent(id);
    const profile = getProfile(namespaceId, orgId, profileId);

    if (!profile) {
      throw new NotFound("Profile", profileId);
    }

    let body: { cwd?: unknown; workspaceId?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const rawCwd = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : undefined;
    let terminalCwd: string | undefined;
    if (rawCwd) {
      const validated = resolveAndValidate(rawCwd, await getAllowedRoots(request));
      if (!validated) {
        throw new Forbidden("cwd is outside the allowed roots");
      }
      terminalCwd = validated;
    }

    const workspaceId =
      typeof body.workspaceId === "string" && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : undefined;
    const result = await startChainRun({
      request,
      namespaceId,
      orgId,
      body: {
        chain: buildReadinessTestChain(profile),
        chainId: READINESS_TEST_CHAIN_ID,
        userPrompt: `Run a real readiness test for agent profile "${profile.name}" (${profile.id}).`,
        ...(terminalCwd ? { workspacePath: terminalCwd } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        agentProfileId: profile.id,
        metadata: {
          source: "agent-profile-test-session",
          profileId: profile.id,
          profileName: profile.name,
        },
      },
    });

    return apiSuccess({
      ...result,
      profileId: profile.id,
      message: `Started readiness test chain for ${profile.name}`,
    });
  }
);
