/**
 * circuit breaker API
 *
 * GET  - get current circuit breaker state
 * PUT  - update circuit breaker config (enabled, maxConcurrentRuns)
 * POST - trip/reset/kill-switch actions
 */

import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
import { requirePermission } from "@/lib/rbac-auth";
import { enforceGuestWrites } from "@/lib/middleware";
import {
  getCircuitBreakerState,
  updateCircuitBreaker,
  tripCircuitBreaker,
  resetCircuitBreaker,
  killSwitch,
  enableCircuitBreaker,
  type CircuitBreakerState,
} from "@/lib/circuit-breaker";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (req: Request) => {
  if (!(await checkAuth(req))) {
    throw new Unauthorized();
  }

  return apiSuccess(getCircuitBreakerState());
});

export const PUT = withErrorHandling(async (req: Request) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req as import("next/server").NextRequest);
  if (blockResult?.blocked) return blockResult.response;

  const body = await req.json();
  const { enabled, maxConcurrentRuns } = body;

  const updates: Partial<CircuitBreakerState> = {};

  if (typeof enabled === "boolean") {
    updates.enabled = enabled;
  }

  if (typeof maxConcurrentRuns === "number" && maxConcurrentRuns > 0) {
    updates.maxConcurrentRuns = maxConcurrentRuns;
  }

  if (Object.keys(updates).length === 0) {
    throw new BadRequest("No valid updates");
  }

  const updated = updateCircuitBreaker(updates);
  return apiSuccess(updated);
});

export const POST = withErrorHandling(async (req: Request) => {
  const perm = await requirePermission(req, "manage_chains");
  if (perm) return perm;

  const blockResult = await enforceGuestWrites(req as import("next/server").NextRequest);
  if (blockResult?.blocked) return blockResult.response;

  const body = await req.json();
  const { action, reason } = body;

  switch (action) {
    case "trip":
      if (!reason || typeof reason !== "string") {
        throw new BadRequest("reason required for trip");
      }
      return apiSuccess(tripCircuitBreaker(reason));

    case "reset":
      return apiSuccess(resetCircuitBreaker());

    case "kill-switch":
      return apiSuccess(killSwitch());

    case "enable":
      return apiSuccess(enableCircuitBreaker());

    default:
      throw new BadRequest("Invalid action. Use: trip, reset, kill-switch, or enable");
  }
});
