import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import {
  createOutboundWebhook,
  listOutboundDeliveries,
  listOutboundWebhooks,
  toOutboundClientConfig,
  updateOutboundWebhook,
} from "@/lib/webhooks/outbound-webhook-storage";

export const dynamic = "force-dynamic";

function badConfigError(error: unknown): never {
  throw new BadRequest(error instanceof Error ? error.message : "invalid webhook config");
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const webhooks = listOutboundWebhooks(namespaceId, orgId).map((config) =>
    toOutboundClientConfig(config, listOutboundDeliveries(namespaceId, orgId, config.id))
  );
  return apiSuccess({ webhooks });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  let webhook;
  try {
    webhook = createOutboundWebhook(namespaceId, orgId, body);
  } catch (error) {
    badConfigError(error);
  }
  return apiSuccess({ webhook: toOutboundClientConfig(webhook) }, undefined, 201);
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  if (!body.id) {
    throw new BadRequest("id required", { field: "id" });
  }

  let webhook;
  try {
    webhook = updateOutboundWebhook(namespaceId, orgId, body.id, body);
  } catch (error) {
    badConfigError(error);
  }
  if (!webhook) {
    throw new NotFound("Webhook", body.id);
  }

  return apiSuccess({ webhook: toOutboundClientConfig(webhook) });
});
