import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, loadMembers, saveMembers, orgMatchesId, type OrgMember } from "@/lib/orgs/org-storage";
import { Unauthorized, NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { execAuditLog } from "@/lib/api/audit-exec";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string; userId: string }> };

export const PUT = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id, userId } = await context.params;
    const org = await loadOrg(namespaceId);

    if (!org || !orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    const body = await request.json();
    const { role } = body;

    const validRoles = ["owner", "admin", "member", "guest"];
    if (!role || !validRoles.includes(role)) {
      throw new BadRequest(`role must be one of: ${validRoles.join(", ")}`, { field: "role" });
    }

    const members = await loadMembers(namespaceId);
    const memberIndex = members.findIndex((m) => m.userId === userId);

    if (memberIndex === -1) {
      throw new NotFound("Member", userId);
    }

    members[memberIndex].role = role as OrgMember["role"];
    await saveMembers(namespaceId, members);

    await execAuditLog(
      "member_role_changed",
      `role changed to ${role} for user ${userId}`,
      { org_id: id, user_id: userId, new_role: role }
    );

    return apiSuccess({ member: members[memberIndex] });
  }
);

export const DELETE = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id, userId } = await context.params;
    const org = await loadOrg(namespaceId);

    if (!org || !orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    const members = await loadMembers(namespaceId);
    const memberIndex = members.findIndex((m) => m.userId === userId);

    if (memberIndex === -1) {
      throw new NotFound("Member", userId);
    }

    members.splice(memberIndex, 1);
    await saveMembers(namespaceId, members);

    await execAuditLog(
      "member_removed",
      `user ${userId} removed from org`,
      { org_id: id, user_id: userId }
    );

    return apiSuccess({ removed: true });
  }
);
