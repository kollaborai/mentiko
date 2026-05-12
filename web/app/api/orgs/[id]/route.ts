import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import {
  deleteOrg,
  loadOrgById,
  saveOrg,
  orgMatchesId,
} from "@/lib/org-storage";
import { Unauthorized, NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

// GET /api/orgs/[id] - get org by id (namespace-scoped)
export const GET = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id } = await context.params;
    const org = await loadOrgById(namespaceId, id);

    if (!org) {
      throw new NotFound("Org", id);
    }

    if (!orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    return apiSuccess({ org });
  }
);

// PUT /api/orgs/[id] - update org
export const PUT = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id } = await context.params;
    const org = await loadOrgById(namespaceId, id);

    if (!org) {
      throw new NotFound("Org", id);
    }

    if (!orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    const body = await request.json();
    const { name, slug, settings } = body;

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        throw new BadRequest("name must be a non-empty string", { field: "name" });
      }
      org.name = name.trim();
    }

    if (slug !== undefined) {
      if (typeof slug !== "string" || !slug.trim()) {
        throw new BadRequest("slug must be a non-empty string", { field: "slug" });
      }
      org.slug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    }

    if (settings !== undefined) {
      if (typeof settings !== "object" || settings === null) {
        throw new BadRequest("settings must be an object", { field: "settings" });
      }
      org.settings = settings;
    }

    await saveOrg(namespaceId, org);
    return apiSuccess({ org });
  }
);

// DELETE /api/orgs/[id] - delete org (dangerous)
export const DELETE = withErrorHandling(
  async (request: NextRequest, context: RouteCtx) => {
    if (!(await checkAuth(request))) {
      throw new Unauthorized();
    }

    const namespaceId = await getNamespaceIdFromRequest(request);
    const { id } = await context.params;
    const org = await loadOrgById(namespaceId, id);

    if (!org) {
      throw new NotFound("Org", id);
    }

    if (!orgMatchesId(org, id)) {
      throw new NotFound("Org", id);
    }

    await deleteOrg(namespaceId, org);

    return apiSuccess({ deleted: true });
  }
);
