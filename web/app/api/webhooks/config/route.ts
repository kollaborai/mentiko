import { NextRequest } from "next/server";
import { join } from "path";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { orgPath } from "@/lib/config";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

type MentikoEventType = "chain_complete" | "chain_failed" | "agent_error" | "run_started";

interface MentikoWebhookConfig {
  id: string;
  name: string;
  url: string;
  events: MentikoEventType[];
  secret?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const CONFIG_FILE = "mentiko-webhooks.json";

function getConfigPath(namespaceId: string, orgId: string): string {
  return join(orgPath(namespaceId, orgId), CONFIG_FILE);
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

export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const configs = await loadConfigs(namespaceId, orgId);
  return apiSuccess({ webhooks: configs });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { name, url, events, secret, active } = body;

  if (!name || !url || !events?.length) {
    throw new BadRequest("name, url, and events required", {
      missing: !name ? ["name"] : !url ? ["url"] : ["events"]
    });
  }

  const now = new Date().toISOString();
  const newConfig: MentikoWebhookConfig = {
    id: crypto.randomUUID(),
    name,
    url,
    events,
    secret,
    active: active ?? true,
    createdAt: now,
    updatedAt: now,
  };

  const configs = await loadConfigs(namespaceId, orgId);
  configs.push(newConfig);
  await saveConfigs(namespaceId, orgId, configs);

  return apiSuccess({ webhook: newConfig }, undefined, 201);
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const body = await request.json();
  const { id, name, url, events, secret, active } = body;

  if (!id) {
    throw new BadRequest("id required", { field: "id" });
  }

  const configs = await loadConfigs(namespaceId, orgId);
  const index = configs.findIndex((c) => c.id === id);

  if (index === -1) {
    throw new NotFound("Webhook", id);
  }

  const updated: MentikoWebhookConfig = {
    ...configs[index],
    ...(name !== undefined && { name }),
    ...(url !== undefined && { url }),
    ...(events !== undefined && { events }),
    ...(secret !== undefined && { secret }),
    ...(active !== undefined && { active }),
    updatedAt: new Date().toISOString(),
  };

  configs[index] = updated;
  await saveConfigs(namespaceId, orgId, configs);

  return apiSuccess({ webhook: updated });
});
