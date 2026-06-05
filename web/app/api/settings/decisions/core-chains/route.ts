import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { listProfiles } from "@/lib/agents/agent-profile-storage";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import {
  DECISION_CORE_CHAIN_IDS,
  ensureDecisionCoreChains,
  restoreDecisionCoreChain,
  updateDecisionCoreChainProfile,
  type DecisionCoreChainId,
} from "@/lib/decisions/decision-core-chains";

export const dynamic = "force-dynamic";

function isDecisionCoreChainId(value: unknown): value is DecisionCoreChainId {
  return typeof value === "string" && DECISION_CORE_CHAIN_IDS.includes(value as DecisionCoreChainId);
}

function loadCoreChain(namespaceId: string, orgId: string, id: DecisionCoreChainId) {
  const chainPath = join(orgPath(namespaceId, orgId, "chains", id), "chain.json");
  if (!existsSync(chainPath)) return null;
  return JSON.parse(readFileSync(chainPath, "utf8")) as Record<string, unknown>;
}

function summarizeCoreChain(namespaceId: string, orgId: string, id: DecisionCoreChainId) {
  const chain = loadCoreChain(namespaceId, orgId, id);
  if (!chain) return null;
  const metadata = chain.metadata && typeof chain.metadata === "object" && !Array.isArray(chain.metadata)
    ? chain.metadata as Record<string, unknown>
    : {};
  return {
    id,
    name: typeof chain.name === "string" ? chain.name : id,
    description: typeof chain.description === "string" ? chain.description : "",
    version: typeof chain.version === "string" ? chain.version : "",
    phase: typeof metadata.decisionPhase === "string" ? metadata.decisionPhase : id,
    default_agent_profile: typeof chain.default_agent_profile === "string" ? chain.default_agent_profile : undefined,
    agentCount: Array.isArray(chain.agents) ? chain.agents.length : 0,
  };
}

function listCoreChains(namespaceId: string, orgId: string) {
  return DECISION_CORE_CHAIN_IDS
    .map((id) => summarizeCoreChain(namespaceId, orgId, id))
    .filter((chain): chain is NonNullable<typeof chain> => !!chain);
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  ensureDecisionCoreChains(namespaceId, orgId);

  return apiSuccess({
    chains: listCoreChains(namespaceId, orgId),
    profiles: listProfiles(namespaceId, orgId),
  });
});

export const PATCH = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const body = await request.json();
  const { chainId, defaultAgentProfileId } = body as {
    chainId?: unknown;
    defaultAgentProfileId?: unknown;
  };

  if (!isDecisionCoreChainId(chainId)) {
    throw new BadRequest("Valid decision core chain ID required", { field: "chainId" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const profileId = typeof defaultAgentProfileId === "string" && defaultAgentProfileId.trim()
    ? defaultAgentProfileId.trim()
    : null;
  if (profileId && !listProfiles(namespaceId, orgId).some((profile) => profile.id === profileId)) {
    throw new BadRequest("Agent profile not found", { field: "defaultAgentProfileId", value: profileId });
  }

  updateDecisionCoreChainProfile(namespaceId, orgId, chainId, profileId);
  return apiSuccess({ chain: summarizeCoreChain(namespaceId, orgId, chainId) });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const body = await request.json().catch(() => ({}));
  const { chainId } = body as { chainId?: unknown };

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const ids = chainId === undefined || chainId === null
    ? [...DECISION_CORE_CHAIN_IDS]
    : isDecisionCoreChainId(chainId)
      ? [chainId]
      : null;

  if (!ids) {
    throw new BadRequest("Valid decision core chain ID required", { field: "chainId" });
  }

  ids.forEach((id) => restoreDecisionCoreChain(namespaceId, orgId, id));
  return apiSuccess({ chains: listCoreChains(namespaceId, orgId) });
});
