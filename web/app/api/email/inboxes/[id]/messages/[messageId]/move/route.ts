import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getCurrentUser } from "@/lib/auth/rbac-auth";
import { loadInboxes, moveEmail, appendAuditLog } from "@/lib/email/email-storage";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; messageId: string }> };

const VALID_SUBFOLDERS = ["unread", "processed", "failed"] as const;
type ValidSubfolder = (typeof VALID_SUBFOLDERS)[number];

// POST /api/email/inboxes/[id]/messages/[messageId]/move
export const POST = withErrorHandling(async (request: NextRequest, { params }: Params) => {
  const perm = await requirePermission(request, "manage_org");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id, messageId } = await params;

  const body = await request.json();
  const { from, to } = body;

  // H5: whitelist validation for both from and to
  if (!VALID_SUBFOLDERS.includes(from)) {
    throw new BadRequest("from must be unread, processed, or failed", { field: "from" });
  }
  if (!VALID_SUBFOLDERS.includes(to)) {
    throw new BadRequest("to must be unread, processed, or failed", { field: "to" });
  }
  if (from === to) {
    throw new BadRequest("from and to must be different");
  }

  const inboxes = await loadInboxes(namespaceId, orgId);
  const inbox = inboxes.find((i) => i.id === id);
  if (!inbox) {
    throw new NotFound("Inbox", id);
  }

  await moveEmail(
    namespaceId,
    orgId,
    inbox.folder,
    messageId,
    from as ValidSubfolder,
    to as ValidSubfolder
  );

  const user = await getCurrentUser(request);
  const now = new Date().toISOString();

  await appendAuditLog(namespaceId, orgId, {
    timestamp: now,
    event: "email_moved",
    namespaceId,
    details: {
      inboxId: id,
      messageId,
      from,
      to,
      by: user?.id || "unknown",
    },
  });

  return apiSuccess({ ok: true, messageId, from, to });
});
