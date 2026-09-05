import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { listWorkspaces, checkWorkspaceAccess } from "@/lib/workspaces/workspace-storage";
import { readOnboardingState, writeOnboardingState, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";

export const dynamic = "force-dynamic";

// Persist an existing/local workspace selection into the onboarding record so it
// survives a state refresh. Without this, chooseWorkspace was client-only and the
// sample-run gate (state.workspace must be ready) could never be satisfied.
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const user = await getSessionUser(request);
  if (!user) throw new Unauthorized();
  const body = await request.json();
  const workspaceId = String(body.workspaceId || "");
  const setupVersion = Number(body.setupVersion);
  if (!workspaceId) throw new BadRequest("workspaceId is required");
  if (setupVersion !== CURRENT_SETUP_VERSION) throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspace = listWorkspaces(namespaceId, orgId).find((ws) => ws.id === workspaceId && checkWorkspaceAccess(ws, user.id));
  if (!workspace) throw new BadRequest("Workspace not found or not accessible", { workspaceId });
  const state = readOnboardingState(namespaceId, orgId);
  state.setupVersion = setupVersion;
  state.workspaceName = workspace.name;
  state.workspace = { status: "ready", id: workspace.id };
  writeOnboardingState(namespaceId, orgId, state, state.revision);
  return apiSuccess({ workspaceId: workspace.id, workspaceName: workspace.name, status: "ready" });
});
