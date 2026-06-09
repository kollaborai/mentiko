import { NextRequest } from "next/server";
import {
  createInboundTrigger,
  findWebhookByToken,
  recordUsage,
  updateInboundTrigger,
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
} from "@/lib/webhooks/webhook-runtime";

export const dynamic = "force-dynamic";

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
  const { trigger, statusToken } = createInboundTrigger(namespaceId, orgId, {
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
      recordUsage(namespaceId, orgId, hook.id);
      return apiSuccess({
        ok: true,
        runId: runData.runId,
        triggerId: trigger.id,
        statusToken,
        statusUrl: `/api/webhooks/inbound/triggers/${trigger.id}`,
      });
    } catch (error) {
      updateInboundTrigger(namespaceId, orgId, trigger.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  if (hook.scheduleId) {
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
      recordUsage(namespaceId, orgId, hook.id);
      return apiSuccess({
        ok: true,
        runId,
        triggerId: trigger.id,
        statusToken,
        statusUrl: `/api/webhooks/inbound/triggers/${trigger.id}`,
      });
    } catch (error) {
      updateInboundTrigger(namespaceId, orgId, trigger.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  updateInboundTrigger(namespaceId, orgId, trigger.id, {
    status: "failed",
    error: "no chain or schedule configured",
  });
  throw new InternalServerError("no chain or schedule configured");
});
