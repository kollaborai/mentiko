import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import {
  loadOrg,
  loadInvites,
  saveInvites,
  orgMatchesId,
  type OrgInvite,
} from "@/lib/orgs/org-storage";
import { Unauthorized, NotFound, BadRequest, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { execAuditLog } from "@/lib/api/audit-exec";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

// POST /api/orgs/[id]/invite - invite member by email
export const POST = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const sessionUser = await getSessionUser(request);
    if (!sessionUser) {
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
    const { email, role = "member" } = body;

    if (!email || typeof email !== "string") {
      throw new BadRequest("email is required and must be a string", { field: "email" });
    }

    const validRoles = ["admin", "member", "viewer"];
    if (!validRoles.includes(role)) {
      throw new BadRequest(`role must be one of: ${validRoles.join(", ")}`, { field: "role" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequest("Invalid email format", { field: "email" });
    }

    const invites = await loadInvites(namespaceId);

    const existingPending = invites.find(
      (i) => i.email === email && i.status === "pending"
    );
    if (existingPending) {
      throw new Conflict("Pending invite already exists for this email");
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const token = Buffer.from(`${id}:${email}:${now}`).toString("base64")
      .replace(/[+/=]/g, "")
      .slice(0, 32);

    const invite: OrgInvite = {
      id: crypto.randomUUID(),
      orgId: id,
      email: email.toLowerCase(),
      role,
      token,
      createdAt: now,
      expiresAt,
      invitedBy: sessionUser.id,
      status: "pending",
    };

    invites.push(invite);
    await saveInvites(namespaceId, invites);

    await execAuditLog(
      "member_invited",
      `invite sent to ${email}`,
      { org_id: id, email }
    );

    return apiSuccess({ invite }, undefined, 201);
  }
);
