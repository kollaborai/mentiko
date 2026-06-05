import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  listInboundWebhooks,
  saveInboundWebhooks,
  generateToken,
} from "@/lib/webhooks/inbound-webhook-storage";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  return apiSuccess({ webhooks: listInboundWebhooks(namespaceId, orgId) });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { name, chainId, scheduleId } = await request.json();

  if (!name) {
    throw new BadRequest("name required", { field: "name" });
  }
  if (!chainId && !scheduleId) {
    throw new BadRequest("chainId or scheduleId required", { field: ["chainId", "scheduleId"] });
  }

  const { token, tokenHash, tokenPreview } = generateToken();
  const hook = {
    id: crypto.randomUUID(),
    name,
    tokenHash,
    tokenPreview,
    chainId: chainId || undefined,
    scheduleId: scheduleId || undefined,
    active: true,
    createdAt: new Date().toISOString(),
    useCount: 0,
  };

  const hooks = listInboundWebhooks(namespaceId, orgId);
  hooks.push(hook);
  saveInboundWebhooks(namespaceId, orgId, hooks);

  // return the raw token ONCE — never stored
  return apiSuccess({ webhook: hook, token }, undefined, 201);
});
