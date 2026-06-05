/**
 * Chain publish/unpublish endpoints.
 *
 * GET    /api/chains/[id]/publish   — get publish status for this chain
 * POST   /api/chains/[id]/publish   — publish (or update) chain to marketplace
 * DELETE /api/chains/[id]/publish   — unpublish chain
 *
 * Body (POST): { description?, tags?, category?, visibility? }
 */

import { NextRequest } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { getNamespaceConfig, getNamespaceIdFromRequest } from "@/lib/namespace-config";
import {
  publishChain,
  unpublishChain,
  getPublishedChain,
  type ChainVisibility,
  type PublishRequest,
} from "@/lib/chains/chain-publish-store";
import { Unauthorized, NotFound, Forbidden, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["general", "development", "business", "research", "content", "automation", "data"];
const VALID_VISIBILITIES: ChainVisibility[] = ["public", "org", "private"];

export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
  const meta = getPublishedChain(chainId);
  return apiSuccess({ published: !!meta, meta: meta || null });
});

export const POST = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const user = await getSessionUser(request);
  if (!user) throw new Unauthorized();

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const namespaceConfig = await getNamespaceConfig(request);

  // load the chain
  const chainPath = join(namespaceConfig.chainsDir, chainId, "chain.json");
  if (!existsSync(chainPath)) {
    throw new NotFound("Chain", chainId);
  }

  let chainData: Record<string, unknown>;
  try {
    chainData = JSON.parse(readFileSync(chainPath, "utf-8"));
  } catch {
    throw new BadRequest("Failed to read chain");
  }

  const body = await request.json() as PublishRequest;

  // validate category
  if (body.category && !VALID_CATEGORIES.includes(body.category)) {
    throw new BadRequest(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }

  // validate visibility
  if (body.visibility && !VALID_VISIBILITIES.includes(body.visibility)) {
    throw new BadRequest(`visibility must be one of: ${VALID_VISIBILITIES.join(", ")}`);
  }

  // sanitize tags (max 10, max 32 chars each)
  if (body.tags) {
    body.tags = body.tags
      .slice(0, 10)
      .map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32))
      .filter(Boolean);
  }

  const meta = publishChain(
    chainId,
    chainData,
    { id: user.id, name: user.name || user.email, email: user.email },
    namespaceId,
    body
  );

  return apiSuccess(meta, undefined, 201);
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const user = await getSessionUser(request);
  if (!user) throw new Unauthorized();

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);

  // verify publisher owns this listing
  const meta = getPublishedChain(chainId);
  if (!meta) throw new NotFound("Published chain", chainId);
  if (meta.publisherId !== user.id) {
    throw new Forbidden("You do not own this listing");
  }

  unpublishChain(chainId);
  return apiSuccess({ unpublished: true, chainId });
});
