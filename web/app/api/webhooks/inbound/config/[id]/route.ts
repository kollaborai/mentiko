import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  listInboundWebhooks,
  saveInboundWebhooks,
  generateToken,
  normalizeInboundAllowedOverrides,
  normalizeInboundRunDefaults,
} from "@/lib/webhooks/inbound-webhook-storage";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;
  const hooks = listInboundWebhooks(namespaceId, orgId);
  const existingIdx = hooks.findIndex((h) => h.id === id);

  if (existingIdx === -1) {
    throw new NotFound("Inbound webhook", id);
  }

  saveInboundWebhooks(namespaceId, orgId, hooks.filter((h) => h.id !== id));
  return apiSuccess({ ok: true });
});

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;
  const body = await request.json();

  const hooks = listInboundWebhooks(namespaceId, orgId);
  const idx = hooks.findIndex((h) => h.id === id);
  if (idx === -1) {
    throw new NotFound("Inbound webhook", id);
  }

  // regenerate token
  if (body.regenerate) {
    const { token, tokenHash, tokenPreview } = generateToken();
    hooks[idx] = { ...hooks[idx], tokenHash, tokenPreview };
    saveInboundWebhooks(namespaceId, orgId, hooks);
    return apiSuccess({ webhook: hooks[idx], token });
  }

  // update editable fields
  if (body.active !== undefined) hooks[idx] = { ...hooks[idx], active: Boolean(body.active) };
  if (body.name !== undefined) hooks[idx] = { ...hooks[idx], name: String(body.name).trim() };
  if (body.chainId !== undefined) hooks[idx] = { ...hooks[idx], chainId: body.chainId || undefined };
  if (body.scheduleId !== undefined) hooks[idx] = { ...hooks[idx], scheduleId: body.scheduleId || undefined };
  if (body.runDefaults !== undefined) hooks[idx] = { ...hooks[idx], runDefaults: normalizeInboundRunDefaults(body.runDefaults) };
  if (body.allowedOverrides !== undefined) hooks[idx] = { ...hooks[idx], allowedOverrides: normalizeInboundAllowedOverrides(body.allowedOverrides) };
  if (!hooks[idx].chainId && !hooks[idx].scheduleId) {
    throw new BadRequest("chainId or scheduleId required", { field: ["chainId", "scheduleId"] });
  }
  saveInboundWebhooks(namespaceId, orgId, hooks);
  return apiSuccess({ webhook: hooks[idx] });
});
