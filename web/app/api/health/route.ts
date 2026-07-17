import { NextRequest, NextResponse } from "next/server";
import config from "@/lib/config";
import {
  detectMode,
  overallHealthStatus,
  runAllHealthChecks,
  type HealthChecks,
  type RuntimeMode,
} from "@/lib/system/health-checks";

export const dynamic = "force-dynamic";

const runtimeMode = detectMode();

interface HealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  uptime_seconds: number;
  checks: HealthChecks;
}

// startup grace period: don't report unhealthy while services are still warming up.
// the process manager's readiness probe polls this endpoint and kills the process
// on 503, so returning "unhealthy" during cold start causes a crash loop.
const STARTUP_GRACE_SECONDS = 15;

// GET /api/health - health check endpoint
export async function GET(_request: NextRequest) {
  // health checks should not require auth for k8s/lb probes
  const uptimeSeconds = Math.floor(process.uptime());
  const inGracePeriod = uptimeSeconds < STARTUP_GRACE_SECONDS;

  const checks = await runAllHealthChecks(runtimeMode);

  let status: HealthStatus["status"] = overallHealthStatus(checks);

  // during grace period, downgrade "unhealthy" to "degraded" so the process
  // manager doesn't kill us before services finish initializing
  if (inGracePeriod && status === "unhealthy") {
    status = "degraded";
  }

  // namespace identity — allows control plane to verify tenant isolation
  const identity = {
    namespaceId: config.namespaceId,
    orgId: config.orgId,
    mentikoRoot: config.globalRoot,
    mentikoCodeRoot: config.codeRoot,
    namespaceRoot: config.namespaceRoot,
    orgRoot: config.orgRoot,
    ...(process.env.MENTIKO_TIER && { tier: process.env.MENTIKO_TIER }),
    ...(process.env.ENV_SCHEMA_VERSION && { envSchemaVersion: process.env.ENV_SCHEMA_VERSION }),
  };

  const response: HealthStatus & { mode: RuntimeMode; grace_period?: boolean; identity?: typeof identity } = {
    status,
    mode: runtimeMode,
    timestamp: new Date().toISOString(),
    uptime_seconds: uptimeSeconds,
    checks,
    identity,
    ...(inGracePeriod && { grace_period: true }),
  };

  const statusCode = status === "unhealthy" ? 503 : 200;

  return NextResponse.json(response, {
    status: statusCode,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
