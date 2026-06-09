import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import {
  deleteOutboundWebhook,
  listOutboundDeliveries,
  listOutboundWebhooks,
  toOutboundClientConfig,
} from "@/lib/webhooks/outbound-webhook-storage";
import { fireOutboundWebhook } from "@/lib/webhooks/webhook-utils";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const config = listOutboundWebhooks(namespaceId, orgId).find((candidate) => candidate.id === id);
  if (!config) {
    throw new NotFound("Webhook", id);
  }

  return apiSuccess({
    webhook: toOutboundClientConfig(config, listOutboundDeliveries(namespaceId, orgId, id)),
  });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  if (!deleteOutboundWebhook(namespaceId, orgId, id)) {
    throw new NotFound("Webhook", id);
  }

  return apiSuccess({ success: true, deleted: id });
});

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const config = listOutboundWebhooks(namespaceId, orgId).find((candidate) => candidate.id === id);
  if (!config) {
    throw new NotFound("Webhook", id);
  }

  const result = await fireOutboundWebhook(namespaceId, orgId, config, {
    event: "started",
    chainId: "webhook-test",
    runId: `run-${Date.now()}`,
    timestamp: new Date().toISOString(),
    chain: {
      name: "Webhook Test",
      description: "Manual webhook test delivery",
    },
    data: { test: true },
  });

  return apiSuccess({
    ok: result.ok,
    httpCode: result.httpCode,
    message: result.ok ? "Delivered" : result.error || "Test delivery failed",
  }, undefined, result.ok ? 200 : 502);
});
