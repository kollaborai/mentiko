import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { loadInboxes, saveInboxes, appendAuditLog } from "@/lib/email-storage";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/email/inboxes/[id] - get inbox details
export const GET = withErrorHandling(async (request: NextRequest, { params }: Params) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;

  const inboxes = await loadInboxes(namespaceId, orgId);
  const inbox = inboxes.find((i) => i.id === id);
  if (!inbox) {
    throw new NotFound("Inbox", id);
  }
  return apiSuccess({ inbox });
});

// PATCH /api/email/inboxes/[id] - update inbox
export const PATCH = withErrorHandling(async (request: NextRequest, { params }: Params) => {
  const perm = await requirePermission(request, "manage_org");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;

  const body = await request.json();

  const inboxes = await loadInboxes(namespaceId, orgId);
  const idx = inboxes.findIndex((i) => i.id === id);
  if (idx === -1) {
    throw new NotFound("Inbox", id);
  }

  // only allow updating these fields
  const { name, chainId, enabled } = body;
  if (name !== undefined) {
    if (typeof name !== "string" || !name) {
      throw new BadRequest("name must be a non-empty string", { field: "name" });
    }
    inboxes[idx].name = name;
  }
  if (chainId !== undefined) {
    inboxes[idx].chainId = chainId || undefined;
  }
  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") {
      throw new BadRequest("enabled must be a boolean", { field: "enabled" });
    }
    inboxes[idx].enabled = enabled;
  }

  const now = new Date().toISOString();
  inboxes[idx].updatedAt = now;

  await saveInboxes(namespaceId, orgId, inboxes);

  await appendAuditLog(namespaceId, orgId, {
    timestamp: now,
    event: "inbox_updated",
    namespaceId,
    details: { inboxId: id, changes: { name, chainId, enabled } },
  });

  return apiSuccess({ inbox: inboxes[idx] });
});

// DELETE /api/email/inboxes/[id] - delete inbox
export const DELETE = withErrorHandling(async (request: NextRequest, { params }: Params) => {
  const perm = await requirePermission(request, "manage_org");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;

  const inboxes = await loadInboxes(namespaceId, orgId);
  const idx = inboxes.findIndex((i) => i.id === id);
  if (idx === -1) {
    throw new NotFound("Inbox", id);
  }

  const deleted = inboxes[idx];
  const remaining = inboxes.filter((i) => i.id !== id);
  await saveInboxes(namespaceId, orgId, remaining);

  const now = new Date().toISOString();
  await appendAuditLog(namespaceId, orgId, {
    timestamp: now,
    event: "inbox_deleted",
    namespaceId,
    details: { inboxId: id, address: deleted.address, folder: deleted.folder },
  });

  return apiSuccess({ ok: true });
});
