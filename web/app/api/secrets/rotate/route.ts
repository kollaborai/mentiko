import { NextRequest } from "next/server";
import { rotateSecrets } from "@/lib/secrets/secrets-store";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { BadRequest, Unauthorized, Conflict } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { timingSafeEqual } from "@/lib/auth/security";

export const dynamic = "force-dynamic";

function checkAdminKey(request: NextRequest): boolean {
  const adminKey = request.headers.get("x-admin-key");
  const secretKey = process.env.BETTER_AUTH_SECRET;

  // use BETTER_AUTH_SECRET as admin key (same as other internal endpoints)
  if (!adminKey || !secretKey) {
    return false;
  }

  try {
    return timingSafeEqual(adminKey, secretKey);
  } catch {
    return false;
  }
}

export const POST = withErrorHandling(async (request: NextRequest) => {
  // check admin key
  if (!checkAdminKey(request)) {
    throw new Unauthorized("Admin key required");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const body = await request.json();
  const { oldSecret, dryRun } = body;

  if (!oldSecret || typeof oldSecret !== "string") {
    throw new BadRequest("oldSecret is required and must be a string", {
      field: "oldSecret",
    });
  }

  const currentSecret = process.env.BETTER_AUTH_SECRET;
  if (!currentSecret) {
    throw new BadRequest("BETTER_AUTH_SECRET not configured in environment", {
      internal: true,
    });
  }

  // check if old secret == current secret (nothing to rotate)
  if (!dryRun && timingSafeEqual(oldSecret, currentSecret)) {
    throw new BadRequest("oldSecret cannot equal current BETTER_AUTH_SECRET", {
      hint: "the old and new keys must be different",
    });
  }

  const result = rotateSecrets(namespaceId, orgId, oldSecret, { dryRun });

  // if all secrets failed, return error
  if (!result.ok && result.error) {
    throw new Conflict(result.error, { result });
  }

  return apiSuccess(result);
});
