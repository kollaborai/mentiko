import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  listInboundWebhooks,
  saveInboundWebhooks,
  generateToken,
} from "@/lib/webhooks/inbound-webhook-storage";
import { NotFound } from "@/lib/api-errors";
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

  // update active state or name
  if (body.active !== undefined) hooks[idx] = { ...hooks[idx], active: body.active };
  if (body.name !== undefined) hooks[idx] = { ...hooks[idx], name: body.name };
  saveInboundWebhooks(namespaceId, orgId, hooks);
  return apiSuccess({ webhook: hooks[idx] });
});
