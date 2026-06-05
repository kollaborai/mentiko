import { NextRequest } from "next/server";
import { NotFound, Gone, Unauthorized, Forbidden, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadInvites, loadOrg, loadMembers, saveMembers, saveInvites } from "@/lib/orgs/org-storage";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import type { OrgMember } from "@/lib/orgs/org-storage";
import type { OrgRole } from "@/lib/orgs/org-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/invite/[token] - look up invite details (public, no auth)
 * returns org name, role, invited email, and status.
 */
export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) => {
  const { token } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);

  const invites = await loadInvites(namespaceId);
  const invite = invites.find((i) => i.token === token);

  if (!invite) {
    throw new NotFound("Invite", token);
  }

  if (invite.status !== "pending") {
    throw new Gone(`Invite has already been ${invite.status}`);
  }

  if (new Date(invite.expiresAt) < new Date()) {
    throw new Gone("Invite has expired");
  }

  const org = await loadOrg(namespaceId);

  return apiSuccess({
    email: invite.email,
    role: invite.role,
    orgName: org?.name || namespaceId,
    orgSlug: org?.slug || namespaceId,
    expiresAt: invite.expiresAt,
  });
});

/**
 * POST /api/invite/[token] - accept the invite (requires auth).
 * adds the authenticated user to the org as the invited role.
 */
export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) => {
  const { token } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);

  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  const invites = await loadInvites(namespaceId);
  const inviteIndex = invites.findIndex((i) => i.token === token);

  if (inviteIndex === -1) {
    throw new NotFound("Invite", token);
  }

  const invite = invites[inviteIndex];

  if (invite.status !== "pending") {
    throw new Gone(`Invite has already been ${invite.status}`);
  }

  if (new Date(invite.expiresAt) < new Date()) {
    invite.status = "expired";
    await saveInvites(namespaceId, invites);
    throw new Gone("Invite has expired");
  }

  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Forbidden("This invite was sent to a different email address");
  }

  // check if already a member
  const members = await loadMembers(namespaceId);
  if (members.find((m) => m.userId === user.id)) {
    throw new Conflict("You are already a member of this organization");
  }

  // map legacy roles
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
    orgId: invite.orgId,
    userId: user.id,
    email: user.email,
    role: memberRole,
    joinedAt: new Date().toISOString(),
    invitedBy: invite.invitedBy,
  };

  members.push(newMember);
  await saveMembers(namespaceId, members);

  invite.status = "accepted";
  invites[inviteIndex] = invite;
  await saveInvites(namespaceId, invites);

  return apiSuccess({ member: newMember });
});
