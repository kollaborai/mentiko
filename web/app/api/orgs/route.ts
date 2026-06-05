import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import {
  createOrg,
  listOrgs,
  type Org,
} from "@/lib/orgs/org-storage";
import { ensureNamespaceDirs } from "@/lib/auth/auth-server";
import { Conflict, BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/orgs - list organizations in the active namespace
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgs = await listOrgs(namespaceId);
  return apiSuccess({ orgs, org: orgs[0] ?? null });
});

// POST /api/orgs - create an organization in the active namespace
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const body = await request.json();
  const { name, slug } = body;

  if (!name || typeof name !== "string") {
    throw new BadRequest("name is required and must be a string", { field: "name" });
  }

  if (!slug || typeof slug !== "string") {
    throw new BadRequest("slug is required and must be a string", { field: "slug" });
  }

  const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const existingOrgs = await listOrgs(namespaceId);
  if (existingOrgs.some((org) => org.slug === normalizedSlug)) {
    throw new Conflict("Organization slug already exists");
  }

  const now = new Date().toISOString();
  const org: Org = {
    id: crypto.randomUUID(),
    name: name.trim(),
    slug: normalizedSlug,
    createdAt: now,
    updatedAt: now,
  };

  await createOrg(namespaceId, org);
  ensureNamespaceDirs(namespaceId);
  return apiSuccess({ org }, undefined, 201);
});
