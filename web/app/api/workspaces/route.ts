import { NextRequest } from "next/server";
import { existsSync, accessSync, constants } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listWorkspaces, addWorkspace, slugify, checkWorkspaceAccess } from "@/lib/workspaces/workspace-storage";
import type { Workspace } from "@/lib/workspaces/workspace-storage";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";

export const dynamic = "force-dynamic";

type Context = { params: Promise<Record<string, string>> };

export const GET = withErrorHandling(async (request: NextRequest, _context: Context) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const allWorkspaces = listWorkspaces(namespaceId, orgId);

  // filter to only workspaces user has access to
  const workspaces = allWorkspaces.filter(ws => checkWorkspaceAccess(ws, user.id));

  return apiSuccess({ workspaces });
});

export const POST = withErrorHandling(async (request: NextRequest, _context: Context) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const { name, path: wsPath, execution, icon, description, project, members } = body as {
    name: string;
    path?: string;
    execution?: Workspace["execution"];
    icon?: string;
    description?: string;
    project?: Workspace["project"];
    members?: string[];
  };

  if (!name) {
    throw new BadRequest("name is required", { field: "name" });
  }

  // only validate local path exists and is writable (skip for SSH/Docker workspaces)
  if (wsPath && (!execution || execution.type === "local")) {
    if (!existsSync(wsPath)) {
      throw new BadRequest(`Path does not exist: ${wsPath}`, { field: "path" });
    }
    // check write permissions
    try {
      accessSync(wsPath, constants.W_OK);
    } catch {
      throw new BadRequest(`Path is not writable by the web server user: ${wsPath}`, { field: "path" });
    }
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspace: Workspace = {
    id: slugify(name),
    name,
    path: wsPath || "",
    addedAt: new Date().toISOString(),
    execution,
    icon,
    description,
    project,
    members,
  };

  addWorkspace(namespaceId, orgId, workspace);

  // auto-init git for local workspaces
  if (wsPath && (!execution || execution.type === "local")) {
    const initResults: { git?: boolean } = {};

    // init git if not already a repo
    if (!existsSync(join(wsPath, ".git"))) {
      try {
        execSync("git init", { cwd: wsPath, stdio: "pipe", timeout: 30000 });
        initResults.git = true;
      } catch {
        initResults.git = false;
      }
    } else {
      initResults.git = true;
    }

    return apiSuccess({ workspace, init: initResults }, undefined, 201);
  }

  return apiSuccess({ workspace }, undefined, 201);
});
