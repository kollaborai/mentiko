import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  loadInboxes,
  saveInboxes,
  deriveInboundSecret,
  appendAuditLog,
} from "@/lib/email/email-storage";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// POST /api/email/secret/rotate - rotate inbox HMAC secret
export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_org");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { inboxId } = await request.json();
  if (!inboxId) {
    throw new BadRequest("inboxId required", { field: "inboxId" });
  }

  const inboxes = await loadInboxes(namespaceId, orgId);
  const idx = inboxes.findIndex((i) => i.id === inboxId);
  if (idx === -1) {
    throw new NotFound("Inbox", inboxId);
  }

  const now = new Date().toISOString();
  inboxes[idx].secretVersion += 1;
  inboxes[idx].updatedAt = now;

  await saveInboxes(namespaceId, orgId, inboxes);

  // new secret derived from new version
  // old version (secretVersion - 1) remains valid for 24h overlap
  // handled by inbound verification checking version and version-1
  const newSecret = deriveInboundSecret(namespaceId, inboxes[idx].secretVersion);

  await appendAuditLog(namespaceId, orgId, {
    timestamp: now,
    event: "secret_rotated",
    namespaceId,
    details: { inboxId, newVersion: inboxes[idx].secretVersion },
  });

  // only time the secret is exposed in plaintext
  return apiSuccess({
    ok: true,
    secret: newSecret,
    version: inboxes[idx].secretVersion,
  });
});
