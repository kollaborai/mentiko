import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { loadLink, deleteLink } from "@/lib/links/link-utils";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { normalizeLinkId } from "@/lib/links/link-run-runtime";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const decodedId = normalizeLinkId(decodeURIComponent(id));
  if (!decodedId) {
    throw new BadRequest("Invalid link ID");
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const linksDir = orgPath(namespaceId, orgId, "links");
  const link = loadLink(linksDir, decodedId);

  if (!link) {
    throw new NotFound("Link", decodedId);
  }

  return apiSuccess({ link });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const { id } = await context.params;
  const decodedId = normalizeLinkId(decodeURIComponent(id));
  if (!decodedId) {
    throw new BadRequest("Invalid link ID");
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const linksDir = orgPath(namespaceId, orgId, "links");
  const link = loadLink(linksDir, decodedId);

  if (!link) {
    throw new NotFound("Link", decodedId);
  }

  deleteLink(linksDir, decodedId);

  return apiSuccess({ success: true, deleted: decodedId });
});
