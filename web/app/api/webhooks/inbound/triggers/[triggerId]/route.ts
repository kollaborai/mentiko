import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { findInboundTriggerByStatusToken } from "@/lib/webhooks/inbound-webhook-storage";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

function readTriggeredRun(namespaceId: string, orgId: string, runId: string | undefined) {
  if (!runId) return undefined;
  const runPath = join(resolveLinkRunsDir(namespaceId, orgId), runId, "run.json");
  if (!existsSync(runPath)) return undefined;
  try {
    const run = JSON.parse(readFileSync(runPath, "utf-8")) as Record<string, unknown>;
    return {
      id: run.id,
      status: run.status,
      chainId: run.chainId,
      goal: run.goal,
      started: run.started,
      completed: run.completed,
      error: run.error || run.status_message,
    };
  } catch {
    return undefined;
  }
}

export const GET = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ triggerId: string }> }
) => {
  const { triggerId } = await params;
  const token = new URL(request.url).searchParams.get("token") || request.headers.get("x-webhook-status-token");
  if (!token) {
    throw new BadRequest("status token required", { field: "token" });
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const trigger = findInboundTriggerByStatusToken(namespaceId, orgId, triggerId, token);
  if (!trigger) {
    throw new NotFound("Webhook trigger", triggerId);
  }

  return apiSuccess({
    trigger: {
      id: trigger.id,
      webhookId: trigger.webhookId,
      chainId: trigger.chainId,
      scheduleId: trigger.scheduleId,
      status: trigger.status,
      runId: trigger.runId,
      acceptedAt: trigger.acceptedAt,
      startedAt: trigger.startedAt,
      failedAt: trigger.failedAt,
      error: trigger.error,
    },
    run: readTriggeredRun(namespaceId, orgId, trigger.runId),
  });
});
