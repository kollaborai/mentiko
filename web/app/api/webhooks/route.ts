import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  loadWebhooks,
  saveWebhooks,
  logWebhookEvent,
} from "@/lib/webhooks/webhook-storage";
import type { WebhookSubscription } from "@/lib/webhooks/webhook-types";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/webhooks - list subscriptions
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chainId");

  let webhooks = await loadWebhooks(namespaceId, orgId);

  // filter by chain if specified
  if (chainId) {
    webhooks = webhooks.filter((w) => w.chainId === chainId);
  }

  // augment each subscription with the receive URL; strip secret (encrypted at rest, never sent to client)
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  const webhooksWithUrls = webhooks.map(({ secret, ...w }) => ({
    ...w,
    hasSecret: Boolean(secret),
    receiveUrl: `${baseUrl}/api/webhooks/${w.id}/receive?ns=${namespaceId}`,
  }));

  return apiSuccess({ webhooks: webhooksWithUrls });
});

// POST /api/webhooks - create subscription
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { chainId, eventFilter, endpointUrl, secret } = body;

  // validation
  if (!chainId || typeof chainId !== "string") {
    throw new BadRequest("chainId is required", { field: "chainId" });
  }

  if (!eventFilter || typeof eventFilter !== "object") {
    throw new BadRequest("eventFilter is required", { field: "eventFilter" });
  }

  if (endpointUrl && typeof endpointUrl !== "string") {
    throw new BadRequest("endpointUrl must be a string", { field: "endpointUrl" });
  }

  // create subscription. always assign a secret — the receive endpoint
  // authenticates every incoming request, so generate one when none is given.
  const resolvedSecret =
    typeof secret === "string" && secret.length > 0
      ? secret
      : randomBytes(32).toString("hex");
  const now = new Date().toISOString();
  const webhook: WebhookSubscription = {
    id: crypto.randomUUID(),
    chainId,
    eventFilter,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...(endpointUrl && { endpointUrl }),
    secret: resolvedSecret,
  };

  const webhooks = await loadWebhooks(namespaceId, orgId);
  webhooks.push(webhook);
  await saveWebhooks(namespaceId, orgId, webhooks);

  // log creation event
  await logWebhookEvent(namespaceId, orgId, {
    id: crypto.randomUUID(),
    source: "custom",
    type: "custom",
    payload: { action: "created", webhookId: webhook.id },
    timestamp: now,
    processed: true,
    chainId,
  });

  const { secret: _s, ...webhookSafe } = webhook;
  return apiSuccess(
    // return the secret exactly once, at creation, so it can be configured on
    // the sending side (github/gitlab/slack). it is never returned on GET.
    { webhook: { ...webhookSafe, hasSecret: true, secret: resolvedSecret } },
    undefined,
    201
  );
});
