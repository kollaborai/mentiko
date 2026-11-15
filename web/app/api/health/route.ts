import { NextRequest, NextResponse } from "next/server";
import config from "@/lib/config";
import {
  detectMode,
  overallHealthStatus,
  readinessHealthStatus,
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

  // issue #136 (codex rev2 P1): the reported status is the full truth — a
  // down background worker makes the platform "unhealthy". But the HTTP
  // status code drives the pm's critical platform readiness probe, and the
  // worker starts only after the platform is ready; a stale worker owner from
  // a previous run must not 503 the platform that would start the
  // replacement worker. So the code keys off the platform's own readiness,
  // with the background_worker check excluded from that verdict only.
  let status: HealthStatus["status"] = overallHealthStatus(checks);
  let readiness: HealthStatus["status"] = readinessHealthStatus(checks);

  // during grace period, downgrade "unhealthy" to "degraded" so the process
  // manager doesn't kill us before services finish initializing
  if (inGracePeriod && status === "unhealthy") {
    status = "degraded";
  }
  if (inGracePeriod && readiness === "unhealthy") {
    readiness = "degraded";
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

  const response: HealthStatus & {
    mode: RuntimeMode;
    grace_period?: boolean;
    readiness?: HealthStatus["status"];
    identity?: typeof identity;
  } = {
    status,
    mode: runtimeMode,
    timestamp: new Date().toISOString(),
    uptime_seconds: uptimeSeconds,
    checks,
    identity,
    ...(inGracePeriod && { grace_period: true }),
    readiness,
  };

  const statusCode = readiness === "unhealthy" ? 503 : 200;

  return NextResponse.json(response, {
    status: statusCode,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
