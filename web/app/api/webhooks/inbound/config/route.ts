import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  createInboundWebhook,
  listInboundWebhooks,
} from "@/lib/webhooks/inbound-webhook-storage";
import { BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";

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
  const { name, chainId, scheduleId, runDefaults, allowedOverrides } = await request.json();

  if (!name) {
    throw new BadRequest("name required", { field: "name" });
  }
  if (!chainId && !scheduleId) {
    throw new BadRequest("chainId or scheduleId required", { field: ["chainId", "scheduleId"] });
  }

  const user = await getSessionUser(request);
  const { webhook, token } = createInboundWebhook(namespaceId, orgId, {
    name,
    chainId: chainId || undefined,
    scheduleId: scheduleId || undefined,
    createdBy: user?.id,
    createdByRole: user?.role,
    runDefaults,
    allowedOverrides,
  });

  // return the raw token ONCE — never stored
  return apiSuccess({ webhook, token }, undefined, 201);
});
