import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  loadInboxes,
  saveInboxes,
  validateInboxFolder,
  appendAuditLog,
} from "@/lib/email/email-storage";
import type { EmailInbox } from "@/lib/email/email-types";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest, Conflict, ValidationError } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

// GET /api/email/inboxes - list inboxes
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const inboxes = await loadInboxes(namespaceId, orgId);
  return apiSuccess({ inboxes });
});

// POST /api/email/inboxes - create inbox
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_org");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { name, address, folder, chainId } = body;

  if (!name || typeof name !== "string") {
    throw new BadRequest("name is required", { field: "name" });
  }
  if (!address || typeof address !== "string") {
    throw new BadRequest("address is required", { field: "address" });
  }
  if (!folder || typeof folder !== "string") {
    throw new BadRequest("folder is required", { field: "folder" });
  }

  if (!validateInboxFolder(folder)) {
    throw new ValidationError("folder must match /^emails\\/[a-z0-9][a-z0-9_-]{0,49}$//", { field: "folder" });
  }

  const existing = await loadInboxes(namespaceId, orgId);
  if (existing.some((i) => i.address === address)) {
    throw new Conflict("inbox address already exists", { field: "address" });
  }
  if (existing.some((i) => i.folder === folder)) {
    throw new Conflict("inbox folder already in use", { field: "folder" });
  }

  const now = new Date().toISOString();
  const inbox: EmailInbox = {
    id: crypto.randomUUID(),
    name,
    address,
    folder,
    chainId: chainId || undefined,
    enabled: true,
    allowAttachments: false,
    secretVersion: 1,
    createdAt: now,
    updatedAt: now,
  };

  existing.push(inbox);
  await saveInboxes(namespaceId, orgId, existing);

  await appendAuditLog(namespaceId, orgId, {
    timestamp: now,
    event: "inbox_created",
    namespaceId,
    details: { inboxId: inbox.id, address, folder },
  });

  return apiSuccess({ inbox }, undefined, 201);
});
