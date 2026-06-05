/**
 * background worker lifecycle API
 *
 * manages the standalone worker that owns scheduler + reconciler loops.
 *
 * GET    - status (running/stopped, uptime, last check)
 * POST   - start worker
 * DELETE - stop worker
 */

import { InternalServerError, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import {
  getBackgroundWorkerStatus,
  checkBackgroundWorker,
  stopBackgroundWorker,
} from "@/lib/system/background-worker-control";

export const dynamic = "force-dynamic";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  const status = getBackgroundWorkerStatus();
  return apiSuccess(status as unknown as Record<string, unknown>);
});

export const POST = withErrorHandling(async (req: Request) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req as import("next/server").NextRequest);
  if (blockResult?.blocked) return blockResult.response;

  const current = checkBackgroundWorker();
  if (current.status === "running") {
    return apiSuccess(current as unknown as Record<string, unknown>);
  }

  throw new InternalServerError(
    "Background worker is not running. It is managed by process-manager -- restart the dev server to start it."
  );
});

export const DELETE = withErrorHandling(async (req: Request) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req as import("next/server").NextRequest);
  if (blockResult?.blocked) return blockResult.response;

  try {
    const result = await stopBackgroundWorker();
    return apiSuccess(result as unknown as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InternalServerError(message);
  }
});
