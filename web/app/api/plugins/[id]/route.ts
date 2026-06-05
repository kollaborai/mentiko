import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getPlugin, enablePlugin, disablePlugin, configurePlugin, maskConfig } from "@/lib/system/plugin-registry";
import { NotFound, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/plugins/[id] - get plugin details
export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  const plugin = getPlugin(namespaceId, orgId, id);
  if (!plugin) {
    throw new NotFound("Plugin", id);
  }

  return apiSuccess({
    plugin: { ...plugin, config: maskConfig(plugin.config, plugin.manifest.configSchema) }
  });
});

// POST /api/plugins/[id] - enable plugin (optionally with config)
export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  const body = await request.json().catch(() => ({}));
  const pluginConfig = body.config as Record<string, string | boolean> | undefined;

  const plugin = enablePlugin(namespaceId, orgId, id, pluginConfig);
  if (!plugin) {
    throw new NotFound("Plugin", id);
  }

  return apiSuccess({ plugin });
});

// PATCH /api/plugins/[id] - update plugin config
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  const body = await request.json();
  const pluginConfig = body.config as Record<string, string | boolean>;

  if (!pluginConfig || typeof pluginConfig !== "object") {
    throw new BadRequest("config object required", { field: "config" });
  }

  const plugin = configurePlugin(namespaceId, orgId, id, pluginConfig);
  if (!plugin) {
    throw new NotFound("Plugin", id);
  }

  return apiSuccess({ plugin });
});

// DELETE /api/plugins/[id] - disable plugin
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const perm = await requirePermission(request, "manage_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { id } = await context.params;

  const plugin = disablePlugin(namespaceId, orgId, id);
  if (!plugin) {
    throw new NotFound("Plugin", id);
  }

  return apiSuccess({ plugin });
});
