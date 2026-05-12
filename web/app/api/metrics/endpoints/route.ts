import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import {
  getEndpointMetrics,
  getSubTimingMetrics,
  getSlowLog,
  resetMetrics,
} from "@/lib/api-metrics";

export const dynamic = "force-dynamic";

// GET /api/metrics/endpoints - per-endpoint timing stats
export const GET = requirePermission("manage_org")(
  withErrorHandling(async (request: NextRequest) => {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "all";
    const minCalls = parseInt(searchParams.get("min_calls") || "0", 10);

    let endpoints = getEndpointMetrics();
    if (minCalls > 0) {
      endpoints = endpoints.filter((e) => e.count >= minCalls);
    }

    if (view === "slow") {
      return apiSuccess({ slowLog: getSlowLog() });
    }

    if (view === "sub") {
      return apiSuccess({ subTimings: getSubTimingMetrics() });
    }

    return apiSuccess({
      endpoints,
      subTimings: getSubTimingMetrics(),
      slowLog: getSlowLog().slice(0, 20),
    });
  })
);

// DELETE /api/metrics/endpoints - reset all collected metrics
export const DELETE = requirePermission("manage_org")(
  withErrorHandling(async () => {
    resetMetrics();
    return apiSuccess({ reset: true });
  })
);
