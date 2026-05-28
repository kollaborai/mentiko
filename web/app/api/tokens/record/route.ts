/**
 * POST /api/tokens/record
 *
 * Internal endpoint — records token usage for a single agent invocation.
 * Called by chain-runner-complete.sh after each agent finishes.
 *
 * Body:
 *   runId        string  required
 *   chainName    string  required
 *   agentId      string  required
 *   agentName?   string
 *   provider?    string  "claude"|"openai"|"gemini"|"ollama"|"unknown"
 *   model        string  required
 *   inputTokens  number
 *   outputTokens number
 *   cacheReadTokens?  number
 *   cacheWriteTokens? number
 *   userId?      string
 *   namespaceId? string
 *
 * Auth: Bearer BETTER_AUTH_SECRET. Unconfigured local dev may use loopback.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  saveTokenUsage,
  computeTokenCost,
  type TokenUsageRecord,
} from "@/lib/token-store";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { hasInternalAuth } from "@/lib/internal-api-auth";

export const dynamic = "force-dynamic";

export const POST = withErrorHandling(async (request: NextRequest): Promise<NextResponse> => {
  if (!hasInternalAuth(request, "tokens-record")) {
    throw new Unauthorized();
  }

  const body = (await request.json()) as {
    runId: string;
    chainName: string;
    agentId: string;
    agentName?: string;
    provider?: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    userId?: string;
    namespaceId?: string;
  };

  if (!body.runId || !body.chainName || !body.agentId || !body.model) {
    throw new BadRequest("runId, chainName, agentId, model required");
  }

  const namespaceId =
    body.namespaceId || await getNamespaceIdFromRequest(request);
  const inputTokens = body.inputTokens ?? 0;
  const outputTokens = body.outputTokens ?? 0;
  const cacheReadTokens = body.cacheReadTokens ?? 0;
  const cacheWriteTokens = body.cacheWriteTokens ?? 0;

  const costCents = computeTokenCost(
    body.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens
  );

  const record: TokenUsageRecord = {
    runId: body.runId,
    chainName: body.chainName,
    agentId: body.agentId,
    agentName: body.agentName,
    provider: (body.provider as TokenUsageRecord["provider"]) ?? "unknown",
    model: body.model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costCents,
    namespaceId,
    userId: body.userId,
    recordedAt: new Date().toISOString(),
  };

  saveTokenUsage(namespaceId, record);

  return apiSuccess({ ok: true, costCents, record });
});
