import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { readOnboardingState, writeOnboardingState, nextOperation, CURRENT_SETUP_VERSION } from "@/lib/onboarding/onboarding-state";
import { importGitHubWorkspace } from "@/lib/workspaces/github-import";

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();
  const body = await request.json();
  const idempotencyKey = String(body.idempotencyKey || "");
  const setupVersion = Number(body.setupVersion);
  if (!idempotencyKey || !body.name || !body.gitUrl) {
    throw new BadRequest("name, gitUrl and idempotencyKey are required");
  }
  if (setupVersion !== CURRENT_SETUP_VERSION) {
    throw new BadRequest("Unsupported setupVersion", { setupVersion, current: CURRENT_SETUP_VERSION });
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { state, op, reused } = nextOperation(namespaceId, orgId, "workspace_import", idempotencyKey, "workspace");
  if (reused) {
    const prior = readOnboardingState(namespaceId, orgId);
    return apiSuccess({ operationId: op.operationId, status: prior.workspace.status, workspaceId: prior.workspace.id });
  }

  const result = importGitHubWorkspace({
    namespaceId,
    orgId,
    name: String(body.name),
    gitUrl: String(body.gitUrl),
    branch: body.branch,
  });
  const next = readOnboardingState(namespaceId, orgId);
  next.setupVersion = setupVersion;
  next.workspace = { status: "ready", id: result.workspace.id };
  next.operations[op.operationId] = { ...op, status: "completed", result: result.workspace };
  writeOnboardingState(namespaceId, orgId, next, state.revision);
  return apiSuccess({ operationId: op.operationId, status: "ready", workspaceId: result.workspace.id, workspace: result.workspace, reused: result.reused });
});
