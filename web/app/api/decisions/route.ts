import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listDecisions, createDecision } from "@/lib/decision-storage";
import { getWorkspacePath } from "@/lib/workspace-params";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspacePath(request);
  const params = new URL(request.url).searchParams;
  const statusFilter = params.get("status");
  const categoryFilter = params.get("category");

  let decisions = listDecisions(nsId, orgId, workspacePath);

  if (statusFilter) {
    decisions = decisions.filter((d) => d.status === statusFilter);
  }
  if (categoryFilter) {
    decisions = decisions.filter((d) => d.category === categoryFilter);
  }

  return apiSuccess({ decisions });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }

  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const workspacePath = getWorkspacePath(request);
  const { prompt } = await request.json();

  if (!prompt || typeof prompt !== "string") {
    throw new BadRequest("prompt is required");
  }

  const decision = createDecision(nsId, orgId, { prompt }, workspacePath);
  return apiSuccess({ decision }, undefined, 201);
});
