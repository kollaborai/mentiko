import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/rbac-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { evaluate, getSuspensionStatus, THRESHOLDS } from "@/lib/email-reputation";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// GET /api/email/reputation - return reputation status
export const GET = withErrorHandling(async (request: NextRequest) => {
  const perm = await requirePermission(request, "view_chains");
  if (perm) return perm;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const [evaluation, suspension] = await Promise.all([
    evaluate(namespaceId, orgId),
    getSuspensionStatus(namespaceId, orgId),
  ]);

  // if org-level suspension exists, use that status
  if (suspension?.suspended) {
    return apiSuccess({
      status: "suspended",
      bounceRate: evaluation.bounceRate,
      complaintRate: evaluation.complaintRate,
      sentLast7Days: evaluation.sentLast7Days,
      sentLast30Days: evaluation.sentLast30Days,
      suspendedReason: suspension.reason || "suspended at org level",
      thresholds: {
        bounceWarning: THRESHOLDS.bounceWarning,
        bouncePaused: THRESHOLDS.bouncePaused,
        bounceSuspended: THRESHOLDS.bounceSuspended,
        complaintWarning: THRESHOLDS.complaintWarning,
        complaintPaused: THRESHOLDS.complaintPaused,
      },
    });
  }

  return apiSuccess({
    status: evaluation.status,
    bounceRate: evaluation.bounceRate,
    complaintRate: evaluation.complaintRate,
    sentLast7Days: evaluation.sentLast7Days,
    sentLast30Days: evaluation.sentLast30Days,
    suspendedReason: evaluation.suspendedReason,
    thresholds: {
      bounceWarning: THRESHOLDS.bounceWarning,
      bouncePaused: THRESHOLDS.bouncePaused,
      bounceSuspended: THRESHOLDS.bounceSuspended,
      complaintWarning: THRESHOLDS.complaintWarning,
      complaintPaused: THRESHOLDS.complaintPaused,
    },
  });
});
