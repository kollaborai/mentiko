import { NextRequest } from "next/server";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listWorkspaces, removeWorkspace, updateWorkspace, checkWorkspaceAccess } from "@/lib/workspaces/workspace-storage";
import type { WorkspaceExecution, WorkspaceModel, WorkspaceProject } from "@/lib/workspaces/workspace-storage";
import { Unauthorized, NotFound, Forbidden } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { advanceWorkspaceDecisionAutoApprovals } from "@/lib/decisions/decision-auto-advance";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: Context
) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspaces = listWorkspaces(namespaceId, orgId);
  const workspace = workspaces.find((w) => w.id === decodeURIComponent(id));
  if (!workspace) {
    throw new NotFound("Workspace", id);
  }

  // check workspace membership
  if (!checkWorkspaceAccess(workspace, user.id)) {
    throw new Forbidden("You do not have access to this workspace");
  }

  return apiSuccess({ workspace });
});

export const PATCH = withErrorHandling(async (
  request: NextRequest,
  context: Context
) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  // check workspace access before updating
  const workspaces = listWorkspaces(namespaceId, orgId);
  const existing = workspaces.find((w) => w.id === decodeURIComponent(id));
  if (!existing) {
    throw new NotFound("Workspace", id);
  }
  if (!checkWorkspaceAccess(existing, user.id)) {
    throw new Forbidden("You do not have access to this workspace");
  }

  const body = await request.json();
  const {
    icon,
    name,
    description,
    execution,
    model,
    env,
    max_agents,
    max_rounds,
    default_branch,
    default_agent_profile,
    project,
    auto_run,
    auto_approve_decisions,
    members,
  } = body as {
    icon?: string;
    name?: string;
    description?: string;
    execution?: WorkspaceExecution;
    model?: WorkspaceModel;
    env?: Record<string, string>;
    max_agents?: number;
    max_rounds?: number;
    default_branch?: string;
    default_agent_profile?: string;
    project?: WorkspaceProject;
    auto_run?: "enabled" | "disabled" | "inherit";
    auto_approve_decisions?: boolean;
    members?: string[];
  };

  const workspace = updateWorkspace(namespaceId, orgId, decodeURIComponent(id), {
    icon,
    name,
    description,
    execution,
    model,
    env,
    max_agents,
    max_rounds,
    default_branch,
    default_agent_profile,
    project,
    auto_run,
    auto_approve_decisions,
    members,
  });
  if (workspace.auto_approve_decisions) {
    advanceWorkspaceDecisionAutoApprovals({
      namespaceId,
      orgId,
      workspacePath: workspace.path,
    });
  }
  return apiSuccess({ workspace });
});

export const DELETE = withErrorHandling(async (
  request: NextRequest,
  context: Context
) => {
  const user = await getSessionUser(request);
  if (!user) {
    throw new Unauthorized();
  }

  const { id } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  // check workspace access before deleting
  const workspaces = listWorkspaces(namespaceId, orgId);
  const existing = workspaces.find((w) => w.id === decodeURIComponent(id));
  if (!existing) {
    throw new NotFound("Workspace", id);
  }
  if (!checkWorkspaceAccess(existing, user.id)) {
    throw new Forbidden("You do not have access to this workspace");
  }

  removeWorkspace(namespaceId, orgId, decodeURIComponent(id));
  return apiSuccess({ success: true });
});
