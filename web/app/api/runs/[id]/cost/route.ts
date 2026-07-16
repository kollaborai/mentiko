/**
 * GET /api/runs/[id]/cost
 *
 * Returns token usage and cost breakdown for a run.
 * Fast path: reads from token store at namespaces/{ns}/tokens/{runId}/
 * Fallback: parses JSONL conversation files from agent activity artifacts via
 *           lib/system/token-usage-extraction, then caches results in the token
 *           store for future requests. Provider and model come from what the
 *           transcript named; neither is assumed.
 *
 * Response:
 *   {
 *     runId: string;
 *     chainName: string;
 *     totalInputTokens: number;
 *     totalOutputTokens: number;
 *     totalCostCents: number;
 *     totalCostDisplay: string;  // e.g. "$0.42"
 *     agentBreakdown: Array<{
 *       agentId: string;
 *       agentName?: string;
 *       model: string;
 *       inputTokens: number;
 *       outputTokens: number;
 *       costCents: number;
 *       costDisplay: string;
 *     }>;
 *   }
 */

import { checkRunAccess } from "@/lib/auth/run-acl";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getRunTokenUsage,
  saveTokenUsage,
  computeTokenCost,
} from "@/lib/system/token-store";
import { existsSync, readFileSync } from "fs";
import { config } from "@/lib/config";
import path from "path";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { DEFAULT_COST_MODEL } from "@/lib/agents/agent-provider-catalog";
import {
  addTokenTotals,
  emptyTokenTotals,
  hasTokenCounts,
  providerForModel,
  readTranscriptTokens,
} from "@/lib/system/token-usage-extraction";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

export const GET = withErrorHandling(async (
  req: Request,
  context: { params: Promise<{ id: string }> }
) => {
  const { id: runId } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const acl = await checkRunAccess(req, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  // fast path: token store already populated
  const cached = getRunTokenUsage(namespaceId, runId);
  if (cached) {
    return buildResponse(cached.runId, cached.chainName, cached.totalInputTokens, cached.totalOutputTokens, cached.totalCostCents, cached.agentBreakdown);
  }

  // fallback: parse from run artifacts
  const runJsonPath = path.join(runsDir, runId, "run.json");
  if (!existsSync(runJsonPath)) {
    throw new NotFound("Run", runId);
  }

  const runData: {
    chain?: string;
    agents?: Array<{ id: string; name?: string }>;
    artifacts?: Array<{ agentId: string; type: string; path: string }>;
  } = JSON.parse(readFileSync(runJsonPath, "utf-8"));

  const chainName = runData.chain || runId;
  const artifacts = runData.artifacts || [];
  const agents = runData.agents || [];

  // group conversation artifact paths by agentId
  const agentConvPaths: Record<string, string[]> = {};
  for (const artifact of artifacts) {
    if (artifact.type !== "conversations") continue;
    if (!agentConvPaths[artifact.agentId]) agentConvPaths[artifact.agentId] = [];
    agentConvPaths[artifact.agentId].push(artifact.path);
  }

  if (Object.keys(agentConvPaths).length === 0) {
    // no conversation artifacts - return empty breakdown instead of 404
    return apiSuccess({
      runId,
      chainName,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostCents: 0,
      totalCostDisplay: "$0.0000",
      agentBreakdown: [],
    });
  }

  const repoRoot = config.codeRoot;

  interface AgentBreakdown {
    agentId: string;
    agentName?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
  }

  const breakdown: AgentBreakdown[] = [];

  for (const [agentId, convPaths] of Object.entries(agentConvPaths)) {
    const agentMeta = agents.find((a) => a.id === agentId);
    let totals = emptyTokenTotals();

    for (const convPath of convPaths) {
      // convPath is relative to repo root (e.g. namespaces/default/runs/.../artifacts/...)
      // conversations.json contains paths to JSONL files
      const artifactAbsPath = path.isAbsolute(convPath)
        ? convPath
        : `${repoRoot}/${convPath}`;

      if (!existsSync(artifactAbsPath)) continue;

      try {
        const convData = JSON.parse(readFileSync(artifactAbsPath, "utf-8")) as Array<{ path: string }>;
        for (const entry of convData) {
          if (!entry.path) continue;
          const jsonlPath = path.isAbsolute(entry.path) ? entry.path : `${repoRoot}/${entry.path}`;
          totals = addTokenTotals(totals, readTranscriptTokens(jsonlPath));
        }
      } catch {
        // skip bad artifact
      }
    }

    if (!hasTokenCounts(totals)) continue;

    // Pricing needs a model, but the record must not claim one the transcript
    // never named: an unobserved model prices at the default and reports an
    // unknown provider rather than asserting Claude.
    const model = totals.observedModel ?? DEFAULT_COST_MODEL;
    const costCents = computeTokenCost(
      model,
      totals.inputTokens,
      totals.outputTokens,
      totals.cacheReadTokens,
      totals.cacheWriteTokens,
    );

    breakdown.push({
      agentId,
      agentName: agentMeta?.name,
      model,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      costCents,
    });

    // cache to token store
    saveTokenUsage(namespaceId, {
      runId,
      chainName,
      agentId,
      agentName: agentMeta?.name,
      provider: providerForModel(totals.observedModel),
      model,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens,
      costCents,
      namespaceId,
      recordedAt: new Date().toISOString(),
    });
  }

  if (breakdown.length === 0) {
    // no token data found - return empty breakdown instead of 404
    return apiSuccess({
      runId,
      chainName,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostCents: 0,
      totalCostDisplay: "$0.0000",
      agentBreakdown: [],
    });
  }

  const totalIn = breakdown.reduce((s, a) => s + a.inputTokens, 0);
  const totalOut = breakdown.reduce((s, a) => s + a.outputTokens, 0);
  const totalCost = breakdown.reduce((s, a) => s + a.costCents, 0);

  return buildResponse(runId, chainName, totalIn, totalOut, totalCost, breakdown);
});

function buildResponse(
  runId: string,
  chainName: string,
  totalIn: number,
  totalOut: number,
  totalCost: number,
  agents: Array<{ agentId: string; agentName?: string; model: string; inputTokens: number; outputTokens: number; costCents: number }>
) {
  return apiSuccess({
    runId,
    chainName,
    totalInputTokens: totalIn,
    totalOutputTokens: totalOut,
    totalCostCents: totalCost,
    totalCostDisplay: `$${(totalCost / 100).toFixed(4)}`,
    agentBreakdown: agents.map((a) => ({
      ...a,
      costDisplay: `$${(a.costCents / 100).toFixed(4)}`,
    })),
  });
}
