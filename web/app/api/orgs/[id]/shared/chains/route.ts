/**
 * GET  /api/orgs/[id]/shared/chains          - list org-shared chains
 * POST /api/orgs/[id]/shared/chains          - share a chain (admin/owner only)
 * DELETE /api/orgs/[id]/shared/chains?name=  - unshare a chain (admin/owner only)
 */

import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth-bridge";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, orgMatchesId } from "@/lib/org-storage";
import {
  listSharedChains,
  getSharedChain,
  saveSharedChain,
  deleteSharedChain,
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
  const name = searchParams.get("name");

  if (name) {
    const chain = getSharedChain(namespaceId, orgId, name);
    if (!chain) throw new NotFound("Shared chain", name);
    return apiSuccess(chain);
  }

  return apiSuccess({ chains: listSharedChains(namespaceId, orgId) });
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
    name: string;
    description?: string;
    chainData: Record<string, unknown>;
  };

  if (!body.name || !body.chainData) {
    throw new BadRequest("name and chainData required");
  }

  const chain = {
    name: body.name,
    description: body.description,
    sharedAt: new Date().toISOString(),
    sharedBy: user.email,
    chainData: body.chainData,
  };

  saveSharedChain(namespaceId, orgId, chain);
  return apiSuccess(chain, undefined, 201);
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
  const name = searchParams.get("name");
  if (!name) throw new BadRequest("name required");

  const deleted = deleteSharedChain(namespaceId, orgId, name);
  if (!deleted) throw new NotFound("Shared chain", name);

  return apiSuccess({ ok: true });
});
