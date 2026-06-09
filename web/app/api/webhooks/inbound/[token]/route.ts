import { NextRequest } from "next/server";
import {
  claimInboundIdempotency,
  createInboundTrigger,
  finalizeInboundIdempotency,
  findInboundIdempotency,
  findWebhookByToken,
  getInboundTriggerById,
  recordUsage,
  releaseInboundIdempotencyClaim,
  updateInboundTrigger,
  type InboundWebhook,
} from "@/lib/webhooks/inbound-webhook-storage";
import { writeLog } from "@/lib/system/system-logger";
import { Unauthorized, Forbidden, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { internalApiUrl } from "@/lib/auth/internal-web-origin";
import { mintSessionToken } from "@/lib/auth/session-token";
import { startChainRun } from "@/lib/runs/chain-run-service";
import { isOrgRole } from "@/lib/orgs/org-types";
import { loadMembers } from "@/lib/orgs/org-storage";
import {
  buildInboundRunBody,
  loadChainForInboundWebhook,
  normalizeWebhookHeaders,
  readWebhookPayloadValue,
} from "@/lib/webhooks/webhook-runtime";

export const dynamic = "force-dynamic";

// Idempotency key comes from a standard header, or a configured payload path
// (e.g. "delivery.id"). Hooks/requests without a key keep prior behavior.
function extractIdempotencyKey(
  request: NextRequest,
  hook: InboundWebhook,
  payload: unknown,
): string | undefined {
  const headerKey =
    request.headers.get("idempotency-key") || request.headers.get("x-idempotency-key");
  let raw = headerKey || undefined;
  if (!raw && hook.idempotencyKeyPath) {
    raw = readWebhookPayloadValue(payload, hook.idempotencyKeyPath);
  }
  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

async function getWebhookActor(namespaceId: string, hook: { createdBy?: string; createdByRole?: unknown }) {
  if (!hook.createdBy) {
    throw new Forbidden("inbound webhook creator is missing or invalid");
  }

  const members = await loadMembers(namespaceId);
  if (members.length > 0) {
    const member = members.find((candidate) => candidate.userId === hook.createdBy);
    if (!member || !isOrgRole(member.role)) {
      throw new Forbidden("inbound webhook creator is no longer an org member");
    }
    return { userId: hook.createdBy, role: member.role };
  }

  if (!isOrgRole(hook.createdByRole)) {
    throw new Forbidden("inbound webhook creator is missing or invalid");
  }
  return { userId: hook.createdBy, role: hook.createdByRole };
}

function duplicateIdempotencyResponse(
  namespaceId: string,
  orgId: string,
  triggerId: string,
  runId?: string,
) {
  const prior = getInboundTriggerById(namespaceId, orgId, triggerId);
  return apiSuccess({
    ok: true,
    idempotent: true,
    runId: runId ?? prior?.runId,
    triggerId,
    status: prior?.status ?? "accepted",
    statusUrl: `/api/webhooks/inbound/triggers/${triggerId}`,
  });
}

// No auth required — token IS the auth
export const POST = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) => {
  const { token } = await params;
  if (!token) {
    throw new Unauthorized("invalid token");
  }

  // derive namespace from query param or default
  const { searchParams } = new URL(request.url);
  const namespaceId = searchParams.get("ns") || "default";
  const orgId = searchParams.get("org") || "default";

  const hook = findWebhookByToken(namespaceId, orgId, token);
  if (!hook) {
    throw new Unauthorized("invalid or inactive token");
  }

  // read payload
  let payload: unknown = null;
  try { payload = await request.json(); } catch { /* not JSON — ok */ }
  const requestBody = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const headers = normalizeWebhookHeaders(request.headers);

  // idempotency: if this delivery carries a key we've already processed, return
  // the original trigger/run instead of starting a duplicate run.
  const idempotencyKey = extractIdempotencyKey(request, hook, payload);
  if (idempotencyKey) {
    const existing = findInboundIdempotency(namespaceId, orgId, hook.id, idempotencyKey);
    if (existing) {
      return duplicateIdempotencyResponse(namespaceId, orgId, existing.triggerId, existing.runId);
    }
  }

  const triggerId = crypto.randomUUID();
  let idempotencyClaimed = false;
  if (idempotencyKey) {
    const claim = claimInboundIdempotency(namespaceId, orgId, {
      webhookId: hook.id,
      idempotencyKey,
      triggerId,
    });
    if (!claim.claimed) {
      return duplicateIdempotencyResponse(namespaceId, orgId, claim.record.triggerId, claim.record.runId);
    }
    idempotencyClaimed = true;
  }

  const { trigger, statusToken } = createInboundTrigger(namespaceId, orgId, {
    id: triggerId,
    webhookId: hook.id,
    chainId: hook.chainId,
    scheduleId: hook.scheduleId,
    status: "accepted",
    payload,
    headers,
  });

  writeLog(namespaceId, orgId, "info", "inbound-webhook", `Received: ${hook.name}`, JSON.stringify(payload ?? {}).slice(0, 200));

  // trigger chain or schedule
  if (hook.chainId) {
    let runStarted = false;
    try {
      const actor = await getWebhookActor(namespaceId, hook);
      const chain = loadChainForInboundWebhook(namespaceId, orgId, hook.chainId);
      const runToken = await mintSessionToken({
        sub: actor.userId,
        jti: `inbound-webhook-${trigger.id}`,
        ns: namespaceId,
        org: orgId,
        role: actor.role,
        scopes: ["ops:*"],
      });
      const runHeaders = new Headers(request.headers);
      runHeaders.set("authorization", `Bearer ${runToken}`);
      runHeaders.set("x-namespace-id", namespaceId);
      runHeaders.set("x-org-id", orgId);
      const runRequest = new Request(request.url, {
        method: "POST",
        headers: runHeaders,
      });
      const runData = await startChainRun({
        request: runRequest,
        namespaceId,
        orgId,
        body: buildInboundRunBody({
          hook,
          chain,
          payload,
          headers,
          triggerId: trigger.id,
          overrides: requestBody.overrides,
        }),
      });
      updateInboundTrigger(namespaceId, orgId, trigger.id, {
        status: "started",
        runId: runData.runId,
      });
      runStarted = true;
      if (idempotencyKey) {
        finalizeInboundIdempotency(namespaceId, orgId, {
          webhookId: hook.id,
          idempotencyKey,
          triggerId: trigger.id,
          runId: runData.runId,
        });
      }
      recordUsage(namespaceId, orgId, hook.id);
      return apiSuccess({
        ok: true,
        runId: runData.runId,
        triggerId: trigger.id,
        statusToken,
        statusUrl: `/api/webhooks/inbound/triggers/${trigger.id}`,
      });
    } catch (error) {
      if (!runStarted) {
        updateInboundTrigger(namespaceId, orgId, trigger.id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        if (idempotencyKey && idempotencyClaimed) {
          releaseInboundIdempotencyClaim(namespaceId, orgId, hook.id, idempotencyKey);
        }
      }
      throw error;
    }
  }

  if (hook.scheduleId) {
    let runStarted = false;
    try {
      const actor = await getWebhookActor(namespaceId, hook);
      const secret = process.env.BETTER_AUTH_SECRET;
      if (!secret) {
        throw new InternalServerError("BETTER_AUTH_SECRET is required to trigger webhook schedules");
      }
      const runAsSessionToken = await mintSessionToken({
        sub: actor.userId,
        jti: `inbound-webhook-${trigger.id}`,
        ns: namespaceId,
        org: orgId,
        role: actor.role,
        scopes: ["ops:*"],
      });
      const trigRes = await fetch(internalApiUrl("/api/schedules/run", request.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-namespace-id": namespaceId,
          "x-org-id": orgId,
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          id: hook.scheduleId,
          triggeredBy: "inbound-webhook",
          payload,
          runAsSessionToken,
        }),
      });
      const data = await trigRes.json();
      if (!trigRes.ok) {
        throw new InternalServerError("failed to trigger schedule", { status: trigRes.status, runError: data });
      }
      const runId = data.data?.runId || data.runId;
      updateInboundTrigger(namespaceId, orgId, trigger.id, {
        status: "started",
        ...(runId ? { runId } : {}),
      });
      runStarted = true;
      if (idempotencyKey) {
        finalizeInboundIdempotency(namespaceId, orgId, {
          webhookId: hook.id,
          idempotencyKey,
          triggerId: trigger.id,
          ...(runId ? { runId } : {}),
        });
      }
      recordUsage(namespaceId, orgId, hook.id);
      return apiSuccess({
        ok: true,
        runId,
        triggerId: trigger.id,
        statusToken,
        statusUrl: `/api/webhooks/inbound/triggers/${trigger.id}`,
      });
    } catch (error) {
      if (!runStarted) {
        updateInboundTrigger(namespaceId, orgId, trigger.id, {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
        if (idempotencyKey && idempotencyClaimed) {
          releaseInboundIdempotencyClaim(namespaceId, orgId, hook.id, idempotencyKey);
        }
      }
      throw error;
    }
  }

  updateInboundTrigger(namespaceId, orgId, trigger.id, {
    status: "failed",
    error: "no chain or schedule configured",
  });
  if (idempotencyKey && idempotencyClaimed) {
    releaseInboundIdempotencyClaim(namespaceId, orgId, hook.id, idempotencyKey);
  }
  throw new InternalServerError("no chain or schedule configured");
});
