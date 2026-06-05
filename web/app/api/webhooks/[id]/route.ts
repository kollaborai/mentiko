import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  deleteWebhook,
  getWebhookById,
  logWebhookEvent,
} from "@/lib/webhooks/webhook-storage";
import type { WebhookEvent, WebhookSource, WebhookEventType } from "@/lib/webhooks/webhook-types";
import { NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// DELETE /api/webhooks/[id] - delete subscription
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  // get webhook for logging before deletion
  const webhook = await getWebhookById(namespaceId, orgId, id);
  if (!webhook) {
    throw new NotFound("Webhook", id);
  }

  const deleted = await deleteWebhook(namespaceId, orgId, id);

  if (!deleted) {
    throw new NotFound("Webhook", id);
  }

  // log deletion event
  await logWebhookEvent(namespaceId, orgId, {
    id: crypto.randomUUID(),
    source: "custom",
    type: "custom",
    payload: { action: "deleted", webhookId: id },
    timestamp: new Date().toISOString(),
    processed: true,
    chainId: webhook.chainId,
  });

  return apiSuccess({ deleted: id });
});

// POST /api/webhooks/[id]/test - test webhook with sample payload
export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;
  const body = await request.json();
  const { source, type, payload } = body;

  // get webhook
  const webhook = await getWebhookById(namespaceId, orgId, id);
  if (!webhook) {
    throw new NotFound("Webhook", id);
  }

  // create test event
  const now = new Date().toISOString();
  const testEvent: WebhookEvent = {
    id: crypto.randomUUID(),
    source: (source as WebhookSource) || "custom",
    type: (type as WebhookEventType) || "custom",
    payload: payload || { test: true, message: "Test webhook payload" },
    timestamp: now,
    processed: false,
    chainId: webhook.chainId,
  };

  // log test event
  await logWebhookEvent(namespaceId, orgId, testEvent);

  // if endpointUrl exists, send actual test request
  let deliveryResult = null;
  if (webhook.endpointUrl) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Webhook-Source": testEvent.source,
        "X-Webhook-Type": testEvent.type,
        "X-Webhook-Test": "true",
      };

      if (webhook.secret) {
        headers["X-Webhook-Signature"] = webhook.secret;
      }

      const response = await fetch(webhook.endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(testEvent),
      });

      deliveryResult = {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
      };
    } catch (err) {
      deliveryResult = {
        error: (err as Error).message,
      };
    }
  }

  return apiSuccess({
    test: true,
    event: testEvent,
    delivery: deliveryResult,
  });
});
