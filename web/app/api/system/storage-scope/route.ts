import { createHash } from "crypto";
import { checkAuth } from "@/lib/auth/api-auth";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";
import config from "@/lib/config";

export const dynamic = "force-dynamic";

function storageScopeDigest(): string {
  return createHash("sha256")
    .update([
      config.globalRoot,
      config.namespaceId,
      config.orgId,
      config.projectRoot,
    ].join("\0"))
    .digest("hex")
    .slice(0, 20);
}

export const GET = withErrorHandling(async (request: Request) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  return apiSuccess({
    storageScope: `install:${storageScopeDigest()}`,
    namespaceId: config.namespaceId,
    orgId: config.orgId,
  });
});
