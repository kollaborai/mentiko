/**
 * background worker lifecycle API
 *
 * reports the standalone worker that owns all background automation loops.
 *
 * Lifecycle is owned by process-manager, not an application request.
 */

import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { getBackgroundWorkerStatus } from "@/lib/system/background-worker-control";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const status = getBackgroundWorkerStatus();
  return apiSuccess(status as unknown as Record<string, unknown>);
});
