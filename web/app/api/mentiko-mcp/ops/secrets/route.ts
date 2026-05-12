import { NextRequest, NextResponse } from "next/server";
import { requireOpsAuth, requireOpsPermission } from "@/lib/mentiko-mcp-ops-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { BadRequest } from "@/lib/api-errors";
import { listSecrets, createSecret, findProfilesUsingSecret } from "@/lib/secrets-store";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;

  const { namespaceId, orgId } = ctx;

  const secrets = listSecrets(namespaceId, orgId);

  // Return secrets without values
  const secretsWithoutValues = secrets.map((s) => ({
    name: s.name,
    envVar: s.envVar,
    description: s.description,
    usageCount: findProfilesUsingSecret(namespaceId, orgId, s.name).length,
  }));

  return apiSuccess({ secrets: secretsWithoutValues });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ctx = await requireOpsAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  const perm = requireOpsPermission(ctx, "manage_org", "secrets:write");
  if (perm) return perm;

  const { namespaceId, orgId } = ctx;

  const body = await request.json();
  const { name, envVar, value, description } = body;

  if (!name || !envVar || !value) {
    throw new BadRequest("name, envVar, and value are required");
  }

  if (!/^[A-Z_][A-Z0-9_]*$/.test(envVar)) {
    throw new BadRequest("envVar must be uppercase letters, digits, and underscores");
  }

  const secret = createSecret(namespaceId, orgId, { name, envVar, value, description });

  // Return without value
  return apiSuccess(
    {
      secret: {
        id: secret.id,
        name: secret.name,
        envVar: secret.envVar,
        description: secret.description,
      },
    },
    undefined,
    201
  );
});
