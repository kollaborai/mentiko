import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import {
  loadOrg,
  loadInvites,
  saveInvites,
  loadMembers,
  saveMembers,
  orgMatchesId,
  type OrgMember,
} from "@/lib/orgs/org-storage";
import type { OrgRole } from "@/lib/orgs/org-types";
import {
  Unauthorized,
  NotFound,
  BadRequest,
  Conflict,
} from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/orgs/[id]/join - accept invite with token
export const POST = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id } = await context.params;
    const org = await loadOrg(namespaceId);

    if (!org) {
      throw new NotFound("Org", id);
    }

    if (!orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    const body = await request.json();
    const { token, userId, email } = body;

    if (!token || typeof token !== "string") {
      throw new BadRequest("token is required", { field: "token" });
    }

    if (!userId || typeof userId !== "string") {
      throw new BadRequest("userId is required", { field: "userId" });
    }

    if (!email || typeof email !== "string") {
      throw new BadRequest("email is required", { field: "email" });
    }

    const invites = await loadInvites(namespaceId);
    const inviteIndex = invites.findIndex(
      (i) => i.token === token && i.orgId === id
    );

    if (inviteIndex === -1) {
      throw new NotFound("Invite", token);
    }

    const invite = invites[inviteIndex];

    if (invite.status !== "pending") {
      throw new Conflict("Invite has already been used");
    }

    if (new Date(invite.expiresAt) < new Date()) {
      invite.status = "expired";
      await saveInvites(namespaceId, invites);
      throw new Conflict("Invite has expired");
    }

    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      throw new BadRequest("Email does not match invite");
    }

    const members = await loadMembers(namespaceId);
    const existingMember = members.find((m) => m.userId === userId);
    if (existingMember) {
      throw new Conflict("User is already a member");
    }

    // map legacy "viewer" role to "guest"
    const roleMapping: Record<string, OrgRole> = {
      viewer: "guest",
      owner: "owner",
      admin: "admin",
      member: "member",
      guest: "guest",
    };
    const memberRole = roleMapping[invite.role] || invite.role;

    const newMember: OrgMember = {
      id: crypto.randomUUID(),
      orgId: id,
      userId,
      email: invite.email,
      role: memberRole,
      joinedAt: new Date().toISOString(),
      invitedBy: invite.invitedBy,
    };

    members.push(newMember);
    await saveMembers(namespaceId, members);

    invite.status = "accepted";
    invites[inviteIndex] = invite;
    await saveInvites(namespaceId, invites);

    return apiSuccess({ member: newMember }, undefined, 201);
  }
);
