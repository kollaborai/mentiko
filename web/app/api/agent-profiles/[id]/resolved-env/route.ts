import { requirePermission } from "@/lib/auth/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getProfile } from "@/lib/agents/agent-profile-storage";
import { resolveProfileEnvVars } from "@/lib/secrets/secrets-store";
import { NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface EnvResponse {
  env: Record<string, string>;
  profile: {
    id: string;
    name: string;
    cli: string;
    model?: string;
  };
}

/**
 * GET /api/agent-profiles/[id]/resolved-env
 *
 * Returns the agent profile with env vars resolved.
 * Secret references like {secret:NAME} are replaced with actual decrypted values.
 */
export const GET = withErrorHandling(
  async (
    req: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    // This returns FULLY DECRYPTED secret values, so gate it at manage_org
    // (owner) — matching the secrets:write gate on /api/mentiko-mcp/ops/secrets.
    // namespace/org below are session-derived (getNamespaceFromSession), so a
    // caller can only ever resolve profiles within their own active org.
    const authError = await requirePermission(req, "manage_org");
    if (authError) return authError;

    const { id } = await context.params;
    const namespaceId = await getNamespaceIdFromRequest(req);
    const orgId = await getOrgIdFromRequest(req);

    const profile = getProfile(namespaceId, orgId, id);
    if (!profile) {
      throw new NotFound("Profile", id);
    }

    // resolve secret references in env
    const resolvedEnv = resolveProfileEnvVars(namespaceId, orgId, profile.env || {});

    const response: EnvResponse = {
      env: resolvedEnv,
      profile: {
        id: profile.id,
        name: profile.name,
        cli: profile.cli,
        model: profile.model,
      },
    };

    return apiSuccess(response);
  }
);
