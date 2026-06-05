import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getChainWebhooks, saveChainWebhooks, type ChainWebhook } from "@/lib/webhooks/webhook-utils";
import { randomUUID } from "crypto";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { id } = await _context.params;
  const decodedId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const webhooks = getChainWebhooks(namespaceId, orgId, decodedId);

  return apiSuccess({ webhooks });
});

export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await _context.params;
  const decodedId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { url, events, name, headers, secret } = body;

  if (!url || !events || !Array.isArray(events)) {
    throw new BadRequest("url and events array required");
  }

  const validEvents = ["started", "completed", "failed"];
  const invalidEvents = events.filter((e: string) => !validEvents.includes(e));
  if (invalidEvents.length > 0) {
    throw new BadRequest(`invalid events: ${invalidEvents.join(", ")}`);
  }

  const existing = getChainWebhooks(namespaceId, orgId, decodedId);

  const newWebhook: ChainWebhook = {
    id: randomUUID(),
    name: name || url,
    url,
    events,
    headers: headers || {},
    secret: secret || undefined,
    enabled: true,
  };

  const result = saveChainWebhooks(namespaceId, orgId, decodedId, [
    ...existing,
    newWebhook,
  ]);

  if (!result.success) {
    throw new BadRequest(result.error || "Failed to save webhook");
  }

  return apiSuccess({ webhook: newWebhook });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await _context.params;
  const decodedId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { webhookId } = body;

  if (!webhookId) {
    throw new BadRequest("webhookId required");
  }

  const existing = getChainWebhooks(namespaceId, orgId, decodedId);
  const filtered = existing.filter((w) => w.id !== webhookId);

  const result = saveChainWebhooks(namespaceId, orgId, decodedId, filtered);

  if (!result.success) {
    throw new BadRequest(result.error || "Failed to delete webhook");
  }

  return apiSuccess({ success: true, deleted: webhookId });
});

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await _context.params;
  const decodedId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { webhookId, enabled } = body;

  if (!webhookId) {
    throw new BadRequest("webhookId required");
  }

  const existing = getChainWebhooks(namespaceId, orgId, decodedId);
  const updated = existing.map((w) =>
    w.id === webhookId ? { ...w, enabled: enabled ?? w.enabled } : w
  );

  const result = saveChainWebhooks(namespaceId, orgId, decodedId, updated);

  if (!result.success) {
    throw new BadRequest(result.error || "Failed to update webhook");
  }

  return apiSuccess({ success: true });
});
