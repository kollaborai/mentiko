/**
 * GET /api/runs/[id]/cost
 *
 * Returns token usage and cost breakdown for a run.
 * Fast path: reads from token store at namespaces/{ns}/tokens/{runId}/
 * Fallback: parses JSONL conversation files from agent activity artifacts,
 *           then caches results in token store for future requests.
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

import { checkRunAccess } from "@/lib/run-acl";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  getRunTokenUsage,
  saveTokenUsage,
  computeTokenCost,
} from "@/lib/token-store";
import { existsSync, readFileSync } from "fs";
import { config } from "@/lib/config";
import path from "path";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";
import { DEFAULT_COST_MODEL } from "@/lib/agent-provider-catalog";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

interface JasonlMessage {
  type?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

async function parseJsonlTokens(
  filePath: string
): Promise<{ model: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number }> {
  const result = { model: DEFAULT_COST_MODEL, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
  if (!existsSync(filePath)) return result;

  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JasonlMessage;
        if (msg.type === "assistant" && msg.message?.usage) {
          const u = msg.message.usage;
          if (msg.message.model) result.model = msg.message.model;
          result.inputTokens += u.input_tokens ?? 0;
          result.outputTokens += u.output_tokens ?? 0;
          result.cacheRead += u.cache_read_input_tokens ?? 0;
          result.cacheWrite += u.cache_creation_input_tokens ?? 0;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // unreadable file
  }
  return result;
}

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
    let model = DEFAULT_COST_MODEL;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheWrite = 0;

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
          const parsed = await parseJsonlTokens(jsonlPath);
          model = parsed.model;
          inputTokens += parsed.inputTokens;
          outputTokens += parsed.outputTokens;
          cacheRead += parsed.cacheRead;
          cacheWrite += parsed.cacheWrite;
        }
      } catch {
        // skip bad artifact
      }
    }

    if (inputTokens === 0 && outputTokens === 0) continue;

    const costCents = computeTokenCost(model, inputTokens, outputTokens, cacheRead, cacheWrite);

    breakdown.push({
      agentId,
      agentName: agentMeta?.name,
      model,
      inputTokens,
      outputTokens,
      costCents,
    });

    // cache to token store
    saveTokenUsage(namespaceId, {
      runId,
      chainName,
      agentId,
      agentName: agentMeta?.name,
      provider: "claude",
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
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
