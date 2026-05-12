import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { checkDiskQuota, getSendCount } from "@/lib/email-storage";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const DEFAULT_DISK_QUOTA_MB = parseInt(process.env.EMAIL_DISK_QUOTA_MB || "500");
const DEFAULT_SEND_QUOTA = parseInt(process.env.EMAIL_SEND_QUOTA_PER_DAY || "1000");

// GET /api/email/quota - disk and send quota for namespace
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const [quotaResult, sendCount] = await Promise.all([
    checkDiskQuota(namespaceId, orgId),
    getSendCount(namespaceId, orgId),
  ]);

  const now = new Date();
  const resetAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();

  return apiSuccess({
    disk: {
      usedBytes: quotaResult.usedBytes,
      quotaBytes: quotaResult.quotaBytes,
      usedMb: Math.round((quotaResult.usedBytes / 1024 / 1024) * 100) / 100,
      quotaMb: DEFAULT_DISK_QUOTA_MB,
      ok: quotaResult.ok,
    },
    sends: {
      count: sendCount,
      quota: DEFAULT_SEND_QUOTA,
      resetAt,
      ok: sendCount < DEFAULT_SEND_QUOTA,
    },
  });
});
