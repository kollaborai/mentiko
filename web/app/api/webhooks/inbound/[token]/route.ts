import { NextRequest } from "next/server";
import { findWebhookByToken, recordUsage } from "@/lib/webhooks/inbound-webhook-storage";
import { writeLog } from "@/lib/system/system-logger";
import { Unauthorized, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { internalApiUrl } from "@/lib/auth/internal-web-origin";

export const dynamic = "force-dynamic";

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

  writeLog(namespaceId, orgId, "info", "inbound-webhook", `Received: ${hook.name}`, JSON.stringify(payload ?? {}).slice(0, 200));

  // trigger chain or schedule
  if (hook.chainId) {
    const runRes = await fetch(internalApiUrl("/api/chains/run", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-namespace-id": namespaceId },
      body: JSON.stringify({
        chainId: hook.chainId,
        goal: `Triggered by inbound webhook: ${hook.name}`,
        context: payload,
        triggeredBy: "inbound-webhook",
      }),
    });
    const runData = await runRes.json();
    if (!runRes.ok) {
      throw new InternalServerError("failed to trigger chain", { runError: runData });
    }
    recordUsage(namespaceId, orgId, hook.id);
    return apiSuccess({ ok: true, runId: runData.data?.runId || runData.runId });
  }

  if (hook.scheduleId) {
    const trigRes = await fetch(internalApiUrl(`/api/schedules/${hook.scheduleId}/trigger`, request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-namespace-id": namespaceId },
      body: JSON.stringify({ triggeredBy: "inbound-webhook", payload }),
    });
    if (!trigRes.ok) {
      throw new InternalServerError("failed to trigger schedule", { status: trigRes.status });
    }
    recordUsage(namespaceId, orgId, hook.id);
    return apiSuccess({ ok: true });
  }

  throw new InternalServerError("no chain or schedule configured");
});
