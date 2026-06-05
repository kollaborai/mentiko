import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, loadInvites, saveInvites, orgMatchesId } from "@/lib/orgs/org-storage";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; inviteId: string }> };

// DELETE /api/orgs/[id]/invites/[inviteId] - cancel invite
export const DELETE = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id, inviteId } = await context.params;
    const org = await loadOrg(namespaceId);

    if (!org || !orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    const invites = await loadInvites(namespaceId);
    const inviteIndex = invites.findIndex((i) => i.id === inviteId);

    if (inviteIndex === -1) {
      throw new NotFound("Invite", inviteId);
    }

    // mark as cancelled
    invites[inviteIndex].status = "cancelled";
    await saveInvites(namespaceId, invites);

    return apiSuccess({ cancelled: true });
  }
);
