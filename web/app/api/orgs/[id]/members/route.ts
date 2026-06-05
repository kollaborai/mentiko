import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, loadMembers, orgMatchesId } from "@/lib/orgs/org-storage";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/orgs/[id]/members - list members
export const GET = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id } = await context.params;
    const org = await loadOrg(namespaceId);

    if (!org || !orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    const members = await loadMembers(namespaceId);
    return apiSuccess({ members });
  }
);
