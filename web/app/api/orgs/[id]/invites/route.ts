import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, loadInvites, saveInvites, orgMatchesId } from "@/lib/orgs/org-storage";
import { Unauthorized, NotFound, BadRequest, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/orgs/[id]/invites - list invites
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

    const invites = await loadInvites(namespaceId);
    return apiSuccess({ invites });
  }
);

// POST /api/orgs/[id]/invites - create invite
export const POST = withErrorHandling(
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

    const body = await request.json();
    const { email, role } = body;

    if (!email || !role) {
      throw new BadRequest("email and role are required");
    }

    const invites = await loadInvites(namespaceId);

    // check for existing pending invite
    const existing = invites.find(
      (i) => i.email === email && i.status === "pending"
    );
    if (existing) {
      throw new Conflict("Pending invite already exists for this email");
    }

    // expires in 7 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const newInvite = {
      id: crypto.randomUUID(),
      orgId: id,
      email: email.toLowerCase().trim(),
      role,
      token: crypto.randomUUID(),
      status: "pending" as const,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      invitedBy: "current-user",
    };

    invites.push(newInvite);
    await saveInvites(namespaceId, invites);

    return apiSuccess({ invite: newInvite }, undefined, 201);
  }
);
