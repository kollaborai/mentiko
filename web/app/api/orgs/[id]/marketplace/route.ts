/**
 * GET /api/orgs/[id]/marketplace
 *
 * Returns the org-private marketplace: shared chains and agents visible only
 * to authenticated org members. Includes the shared resources created via
 * POST /api/orgs/[id]/shared/chains and /shared/profiles.
 *
 * POST /api/orgs/[id]/marketplace
 * Publish an existing chain/agent to the org-private marketplace.
 * Body: { type: "chain"|"agent", name: string, description?: string, data: object }
 * Role: admin/owner only.
 */

import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth-bridge";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, orgMatchesId } from "@/lib/org-storage";
import { listSharedChains, saveSharedChain, listSharedProfiles } from "@/lib/shared-resources";
import type { OrgMarketplaceItem } from "@/lib/marketplace-types";
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
  const typeFilter = searchParams.get("type");

  const items: OrgMarketplaceItem[] = [];

  // shared chains -> org marketplace
  if (!typeFilter || typeFilter === "chain") {
    for (const chain of listSharedChains(namespaceId, orgId)) {
      items.push({
        id: `chain:${chain.name}`,
        type: "chain",
        name: chain.name,
        description: chain.description,
        sharedAt: chain.sharedAt,
        sharedBy: chain.sharedBy,
        visibility: "org",
        data: chain.chainData,
      });
    }
  }

  // shared profiles -> org marketplace (as "agent" type using profile configs)
  if (!typeFilter || typeFilter === "agent") {
    for (const profile of listSharedProfiles(namespaceId, orgId)) {
      items.push({
        id: `profile:${profile.type}:${profile.name}`,
        type: "agent",
        name: `${profile.name} (${profile.type} profile)`,
        description: profile.description,
        sharedAt: profile.sharedAt,
        sharedBy: profile.sharedBy,
        visibility: "org",
        data: profile.profileData,
      });
    }
  }

  return apiSuccess({ items, orgId: orgId, orgName: org.name });
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
    type: "chain" | "agent";
    name: string;
    description?: string;
    data: Record<string, unknown>;
  };

  if (!body.name || !body.data) {
    throw new BadRequest("name and data required");
  }

  if (body.type === "chain") {
    saveSharedChain(namespaceId, orgId, {
      name: body.name,
      description: body.description,
      sharedAt: new Date().toISOString(),
      sharedBy: user.email,
      chainData: body.data,
    });
  }

  return apiSuccess({
    ok: true,
    item: {
      id: `${body.type}:${body.name}`,
      type: body.type,
      name: body.name,
      description: body.description,
      sharedAt: new Date().toISOString(),
      sharedBy: user.email,
      visibility: "org",
      data: body.data,
    } satisfies OrgMarketplaceItem,
  }, undefined, 201);
});
