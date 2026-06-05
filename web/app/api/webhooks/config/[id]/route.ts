import { NextRequest } from "next/server";
import { join } from "path";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type MentikoWebhookConfig = {
  id: string;
  name: string;
  url: string;
  events: string[];
  secret?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  recentDeliveries?: Array<{
    id: string;
    status: "delivered" | "failed" | "pending";
    httpCode?: number;
    timestamp: string;
  }>;
};

const CONFIG_FILE = "mentiko-webhooks.json";
const DELIVERIES_FILE = "mentiko-webhook-deliveries.jsonl";

function getConfigPath(namespaceId: string, orgId: string): string {
  return join(orgPath(namespaceId, orgId), CONFIG_FILE);
}

function getDeliveriesPath(namespaceId: string, orgId: string): string {
  return join(orgPath(namespaceId, orgId), DELIVERIES_FILE);
}

async function loadConfigs(namespaceId: string, orgId: string): Promise<MentikoWebhookConfig[]> {
  try {
    const { promises: fs } = await import("fs");
    const path = getConfigPath(namespaceId, orgId);
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveConfigs(namespaceId: string, orgId: string, configs: MentikoWebhookConfig[]): Promise<void> {
  const { promises: fs } = await import("fs");
  const path = getConfigPath(namespaceId, orgId);
  await fs.mkdir(orgPath(namespaceId, orgId), { recursive: true });
  await fs.writeFile(path, JSON.stringify(configs, null, 2));
}

async function loadDeliveries(namespaceId: string, orgId: string, webhookId: string, limit = 10): Promise<MentikoWebhookConfig["recentDeliveries"]> {
  try {
    const { promises: fs } = await import("fs");
    const path = getDeliveriesPath(namespaceId, orgId);
    const data = await fs.readFile(path, "utf-8");
    const lines = data.trim().split("\n").filter(Boolean);

    const deliveries: MentikoWebhookConfig["recentDeliveries"] = [];
    for (let i = lines.length - 1; i >= 0 && deliveries.length < limit; i--) {
      try {
        const delivery = JSON.parse(lines[i]);
        if (delivery.webhookId === webhookId) {
          deliveries.push({
            id: delivery.id,
            status: delivery.status,
            httpCode: delivery.httpCode,
            timestamp: delivery.timestamp,
          });
        }
      } catch {
        // skip malformed lines
      }
    }
    return deliveries;
  } catch {
    return [];
  }
}

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { id } = await context.params;
  const configs = await loadConfigs(namespaceId, orgId);
  const config = configs.find((c) => c.id === id);

  if (!config) {
    throw new NotFound("Webhook", id);
  }

  const recentDeliveries = await loadDeliveries(namespaceId, orgId, id);

  return apiSuccess({ webhook: { ...config, recentDeliveries } });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { id } = await context.params;
  const configs = await loadConfigs(namespaceId, orgId);
  const filtered = configs.filter((c) => c.id !== id);

  if (filtered.length === configs.length) {
    throw new NotFound("Webhook", id);
  }

  await saveConfigs(namespaceId, orgId, filtered);

  return apiSuccess({ success: true, deleted: id });
});
