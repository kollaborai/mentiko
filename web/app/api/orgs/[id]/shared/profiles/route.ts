/**
 * GET    /api/orgs/[id]/shared/profiles         - list org-shared config profiles
 * POST   /api/orgs/[id]/shared/profiles         - share a config profile (admin/owner)
 * DELETE /api/orgs/[id]/shared/profiles?type=&name= - unshare (admin/owner)
 */

import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth-bridge";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, orgMatchesId } from "@/lib/org-storage";
import {
  listSharedProfiles,
  saveSharedProfile,
  deleteSharedProfile,
} from "@/lib/shared-resources";
import { Unauthorized, NotFound, Forbidden, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

async function resolveOrg(namespaceId: string, orgId: string) {
  const org = await loadOrg(namespaceId);
  if (!org || !orgMatchesId(org, orgId)) return null;
  return org;
}

export const GET = withErrorHandling(async (request: NextRequest, ctx: RouteCtx) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { id: orgId } = await ctx.params;
  const org = await resolveOrg(namespaceId, orgId);
  if (!org) throw new NotFound("Org", orgId);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || undefined;

  return apiSuccess({ profiles: listSharedProfiles(namespaceId, orgId, type) });
});

export const POST = withErrorHandling(async (request: NextRequest, ctx: RouteCtx) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { id: orgId } = await ctx.params;
  const org = await resolveOrg(namespaceId, orgId);
  if (!org) throw new NotFound("Org", orgId);

  const user = await getSessionUser(request);
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Forbidden("Admin or owner role required");
  }

  const body = await request.json() as {
    type: string;
    name: string;
    description?: string;
    profileData: Record<string, unknown>;
  };

  if (!body.type || !body.name || !body.profileData) {
    throw new BadRequest("type, name, and profileData required");
  }

  const profile = {
    type: body.type,
    name: body.name,
    description: body.description,
    sharedAt: new Date().toISOString(),
    sharedBy: user.email,
    profileData: body.profileData,
  };

  saveSharedProfile(namespaceId, orgId, profile);
  return apiSuccess(profile, undefined, 201);
});

export const DELETE = withErrorHandling(async (request: NextRequest, ctx: RouteCtx) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { id: orgId } = await ctx.params;
  const org = await resolveOrg(namespaceId, orgId);
  if (!org) throw new NotFound("Org", orgId);

  const user = await getSessionUser(request);
  if (!user || !["owner", "admin"].includes(user.role)) {
    throw new Forbidden("Admin or owner role required");
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const name = searchParams.get("name");
  if (!type || !name) {
    throw new BadRequest("type and name required");
  }

  const deleted = deleteSharedProfile(namespaceId, orgId, type, name);
  if (!deleted) throw new NotFound("Shared profile", `${type}:${name}`);

  return apiSuccess({ ok: true });
});
