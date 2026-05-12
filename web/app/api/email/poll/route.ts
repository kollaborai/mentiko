/**
 * email poll route
 * returns unread counts per inbox
 * used by UI to show unread badge counts
 */

import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import { nsPath } from "@/lib/config";
import { loadInboxes } from "@/lib/email-storage";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/email/poll - returns unread counts per inbox
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const inboxes = await loadInboxes(namespaceId, orgId);
  const counts: Record<string, number> = {};
  let total = 0;

  // count unread emails in each inbox
  for (const inbox of inboxes) {
    const unreadDir = nsPath(namespaceId, inbox.folder, "unread");

    try {
      const files = await fs.readdir(unreadDir);
      const count = files.filter((f) => f.endsWith(".json")).length;
      counts[inbox.id] = count;
      total += count;
    } catch {
      // dir doesn't exist yet
      counts[inbox.id] = 0;
    }
  }

  return apiSuccess({ counts, total });
});
