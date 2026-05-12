import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { loadInboxes, listEmails } from "@/lib/email-storage";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/email/inboxes/[id]/messages - list messages
export const GET = withErrorHandling(async (request: NextRequest, { params }: Params) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await params;
  const { searchParams } = new URL(request.url);

  // whitelist subfolder values
  const rawFolder = searchParams.get("folder") || "unread";
  if (!["unread", "processed", "failed"].includes(rawFolder)) {
    throw new BadRequest("folder must be unread, processed, or failed", { field: "folder" });
  }
  const subfolder = rawFolder as "unread" | "processed" | "failed";

  // H9: pagination bounds
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50"), 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);

  const inboxes = await loadInboxes(namespaceId, orgId);
  const inbox = inboxes.find((i) => i.id === id);
  if (!inbox) {
    throw new NotFound("Inbox", id);
  }

  const result = await listEmails(namespaceId, orgId, inbox.folder, subfolder, limit, offset);
  return apiSuccess({ ...result, limit, offset, folder: subfolder });
});
