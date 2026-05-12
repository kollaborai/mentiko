/**
 * GET    /api/orgs/[id]/shared/secrets         - list secrets (values masked by role)
 * POST   /api/orgs/[id]/shared/secrets         - create/update secret (admin/owner only)
 * DELETE /api/orgs/[id]/shared/secrets?name=   - delete secret (admin/owner only)
 *
 * Secret values are only returned in plaintext when caller's role >= secret.minRole.
 * Otherwise value is returned as "***" with canRead: false.
 */

import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth-bridge";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { loadOrg, orgMatchesId } from "@/lib/org-storage";
import {
  listSharedSecrets,
  getSharedSecret,
  saveSharedSecret,
  deleteSharedSecret,
  type SecretMinRole,
} from "@/lib/shared-resources";
import type { OrgRole } from "@/lib/org-types";
import { Unauthorized, NotFound, Forbidden, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

const VALID_MIN_ROLES: SecretMinRole[] = ["member", "admin", "owner"];

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

  const user = await getSessionUser(request);
  const callerRole: OrgRole = (user?.role as OrgRole) || "guest";

  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name");

  if (name) {
    const secret = getSharedSecret(namespaceId, orgId, name, callerRole);
    if (!secret) throw new NotFound("Secret", name);
    return apiSuccess(secret);
  }

  return apiSuccess({ secrets: listSharedSecrets(namespaceId, orgId, callerRole) });
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
    value: string;
    minRole?: SecretMinRole;
  };

  if (!body.name || !body.value) {
    throw new BadRequest("name and value required");
  }

  const minRole: SecretMinRole = VALID_MIN_ROLES.includes(body.minRole as SecretMinRole)
    ? (body.minRole as SecretMinRole)
    : "member";

  const now = new Date().toISOString();
  const secret = {
    name: body.name,
    description: body.description,
    minRole,
    value: body.value,
    createdAt: now,
    updatedAt: now,
    createdBy: user.email,
  };

  saveSharedSecret(namespaceId, orgId, secret);

  // never return the value in the creation response
  const { value: _v, ...publicView } = secret;
  void _v;
  return apiSuccess({ ...publicView, canRead: true }, undefined, 201);
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

  const deleted = deleteSharedSecret(namespaceId, orgId, name);
  if (!deleted) throw new NotFound("Secret", name);

  return apiSuccess({ ok: true });
});
