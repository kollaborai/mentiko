/**
 * GET  /api/workspaces/[id]/task-provider  - get current task provider config
 * PUT  /api/workspaces/[id]/task-provider  - set task provider config
 * POST /api/workspaces/[id]/task-provider/ping - test connectivity
 */

import { NextRequest } from "next/server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getWorkspace, updateWorkspace, checkWorkspaceAccess } from "@/lib/workspaces/workspace-storage";
import { createTaskProvider, isTaskProviderType, TASK_PROVIDER_META } from "@/lib/task-provider";
import type { TaskProviderConfig, TaskProvider } from "@/lib/task-provider/types";
import { Unauthorized, NotFound, BadRequest, Forbidden, InternalServerError } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";

export const dynamic = "force-dynamic";

interface TaskProviderContext {
  params: Promise<{ id: string }>;
}

function maskCredentials(config: TaskProviderConfig): TaskProviderConfig {
  if (!config.credentials) return config;
  const masked: Record<string, string> = {};
  for (const [key, val] of Object.entries(config.credentials)) {
    // Don't mask secret references - user should see {secret:NAME}
    if (val && val.match(/^\{secret:/)) {
      masked[key] = val;
    } else {
      masked[key] = val ? "••••••••" : "";
    }
  }
  return { ...config, credentials: masked };
}

function normalizeProviderConfig(config: Partial<TaskProviderConfig> | undefined): TaskProviderConfig {
  if (!config || !isTaskProviderType(config.type)) {
    return { type: "native" };
  }
  return {
    type: config.type,
    credentials: config.credentials,
    options: config.options,
  };
}

export const GET = withErrorHandling(async (req: NextRequest, context: TaskProviderContext) => {
  const user = await getSessionUser(req);
  if (!user) throw new Unauthorized();

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const { id } = await context.params;

  const workspace = getWorkspace(nsId, orgId, id);
  if (!workspace) throw new NotFound("Workspace", id);

  // check workspace membership
  if (!checkWorkspaceAccess(workspace, user.id)) {
    throw new Forbidden("You do not have access to this workspace");
  }

  const config = normalizeProviderConfig(workspace.taskProvider);
  const type = config.type;
  return apiSuccess({
    config: maskCredentials(config),
    meta: TASK_PROVIDER_META[type],
    available: Object.values(TASK_PROVIDER_META),
  });
});

export const PUT = withErrorHandling(async (req: NextRequest, context: TaskProviderContext) => {
  const user = await getSessionUser(req);
  if (!user) throw new Unauthorized();

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const { id } = await context.params;

  const workspace = getWorkspace(nsId, orgId, id);
  if (!workspace) throw new NotFound("Workspace", id);

  // check workspace membership
  if (!checkWorkspaceAccess(workspace, user.id)) {
    throw new Forbidden("You do not have access to this workspace");
  }

  const body = (await req.json()) as TaskProviderConfig;
  if (!body.type) throw new BadRequest("type is required", { field: "type" });
  if (!isTaskProviderType(body.type)) {
    throw new BadRequest("Unknown task provider type", { field: "type" });
  }

  const existing = workspace.taskProvider;

  // Merge credentials: if a field is "••••••••", keep the existing value
  const credentials = body.credentials ?? {};
  if (existing?.credentials) {
    for (const [key, val] of Object.entries(credentials)) {
      if (val === "••••••••" && existing.credentials[key]) {
        credentials[key] = existing.credentials[key];
      }
    }
  }

  const newConfig: TaskProviderConfig = {
    type: body.type,
    credentials,
    options: body.options,
  };

  updateWorkspace(nsId, orgId, id, { taskProvider: newConfig });

  return apiSuccess({ config: maskCredentials(newConfig) });
});

export const POST = withErrorHandling(async (req: NextRequest, context: TaskProviderContext) => {
  const user = await getSessionUser(req);
  if (!user) throw new Unauthorized();

  const nsId = await getNamespaceIdFromRequest(req);
  const orgId = await getOrgIdFromRequest(req);
  const { id } = await context.params;

  const workspace = getWorkspace(nsId, orgId, id);
  if (!workspace) throw new NotFound("Workspace", id);

  // check workspace membership
  if (!checkWorkspaceAccess(workspace, user.id)) {
    throw new Forbidden("You do not have access to this workspace");
  }

  const config = normalizeProviderConfig(workspace.taskProvider);

  let provider: TaskProvider;
  try {
    provider = createTaskProvider(config, nsId, orgId, workspace.path);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Failed to create provider";
    throw new InternalServerError(errorMsg);
  }

  const pingErr = await provider.ping();
  return apiSuccess({ ok: !pingErr, error: pingErr });
});
