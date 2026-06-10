import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listSecrets, createSecret, deleteSecret, updateSecret, findProfilesUsingSecret, getSecretsStatus } from "@/lib/secrets/secrets-store";
import { Unauthorized, BadRequest, NotFound, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/secrets
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized("Authentication required");
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const secrets = listSecrets(namespaceId, orgId);
  const statusMap = new Map(getSecretsStatus(namespaceId, orgId).map((s) => [s.id, s.status]));

  // add usage count and status for each secret
  const secretsWithMeta = secrets.map((s) => ({
    ...s,
    usageCount: findProfilesUsingSecret(namespaceId, orgId, s.name).length,
    status: statusMap.get(s.id) || "unknown",
  }));

  return apiSuccess({ secrets: secretsWithMeta });
});

// POST /api/secrets
export const POST = withErrorHandling(async (request: NextRequest) => {
  // creating/updating org secrets (API keys / credentials) is owner-level,
  // matching the secrets:write gate on /api/mentiko-mcp/ops/secrets.
  const authError = await requirePermission(request, "manage_org");
  if (authError) return authError;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { name, envVar, value, description, id: updateId } = body;

  if (updateId) {
    // update existing
    const updated = updateSecret(namespaceId, orgId, updateId, { name, envVar, value, description });
    if (!updated) throw new NotFound("Secret", updateId);
    return apiSuccess({ secret: updated });
  }

  if (!name || !envVar || !value) {
    throw new BadRequest("name, envVar, and value are required", { field: "name,envVar,value" });
  }

  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) {
    throw new BadRequest("envVar must be uppercase letters, digits, and underscores", { field: "envVar" });
  }

  const secret = createSecret(namespaceId, orgId, { name, envVar, value, description });
  return apiSuccess({ secret }, undefined, 201);
});

// DELETE /api/secrets?id=<id>
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  // deleting org secrets is owner-level
  const authError = await requirePermission(request, "manage_org");
  if (authError) return authError;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) throw new BadRequest("id required", { field: "id" });

  // validate id to prevent path traversal
  if (!/^sec-[0-9]+-[a-f0-9]{6}$/.test(id)) {
    throw new BadRequest("Invalid id format", { field: "id" });
  }

  const result = deleteSecret(namespaceId, orgId, id);

  if (!result.ok) {
    if (result.error === "Secret not found") {
      throw new NotFound("Secret", id);
    }
    // Conflict: secret is in use
    throw new Conflict(result.error, { usages: result.usages });
  }

  return apiSuccess({ ok: true });
});
