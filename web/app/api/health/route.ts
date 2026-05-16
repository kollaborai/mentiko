import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync, statfsSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { ping as redisPing, redisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

// detect runtime environment for conditional checks
// /.dockerenv is created by Docker in every container - most reliable signal
const isDocker = existsSync("/.dockerenv");
const isSystemd = !!process.env.INVOCATION_ID;

// pty-mgr is available in production (lib/pty-manager.mjs, /usr/local/bin/pty-mgr) or dev (bin/pty-mgr)
const hasPtyMgr = (() => {
  return existsSync(join(config.libDir, "pty-manager.mjs")) ||
         existsSync(join(config.binDir, "pty-mgr")) ||
         existsSync("/usr/local/bin/pty-mgr");
})();

type RuntimeMode = "docker" | "standalone" | "development";
function detectMode(): RuntimeMode {
  if (isDocker) return "docker";
  if (isSystemd || process.env.NODE_ENV === "production") return "standalone";
  return "development";
}
const runtimeMode = detectMode();

interface HealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  timestamp: string;
  uptime_seconds: number;
  checks: {
    [key: string]: {
      status: "pass" | "fail" | "warn";
      message?: string;
      value?: unknown;
    };
  };
}

async function checkPtyDaemon(): Promise<{ status: "pass" | "fail" | "warn"; message: string }> {
  if (!hasPtyMgr) {
    if (isDocker || isSystemd) {
      return { status: "warn", message: "pty-manager binary not found (expected in production)" };
    }
    return { status: "pass", message: `pty-manager not applicable (${runtimeMode})` };
  }

  try {
    const { pty } = await import("@/lib/pty-client");
    const daemonStatus = await pty.status();
    if (daemonStatus) {
      return {
        status: "pass",
        message: `pty-manager daemon running (pid ${daemonStatus.pid})`,
      };
    }
    return {
      status: "warn",
      message: "pty-manager daemon not running",
    };
  } catch {
    return {
      status: "warn",
      message: "pty-manager not available",
    };
  }
}

function checkDirectories(): {
  status: "pass" | "warn";
  message: string;
  value: { [key: string]: boolean };
} {
  const dirs = {
    chains: existsSync(config.chainsDir),
    state: existsSync(config.stateDir),
    events: existsSync(config.eventsDir),
    workspace: existsSync(config.workspaceDir),
    reports: existsSync(config.reportsDir),
  };

  const allExist = Object.values(dirs).every((v) => v);

  return {
    status: allExist ? "pass" : "warn",
    message: allExist ? "all directories exist" : "some directories missing",
    value: dirs,
  };
}

async function checkActiveSessions(): Promise<{
  status: "pass" | "warn";
  message: string;
  value?: number;
}> {
  if (!hasPtyMgr) {
    if (isDocker || isSystemd) {
      return { status: "warn", message: "pty-manager binary not found (expected in production)", value: 0 };
    }
    return { status: "pass", message: `sessions not applicable (${runtimeMode})`, value: 0 };
  }

  try {
    const { pty } = await import("@/lib/pty-client");
    const sessions = await pty.list();
    const alive = sessions.filter((s: { alive: boolean }) => s.alive).length;

    return {
      status: "pass",
      message: `${alive} active sessions`,
      value: alive,
    };
  } catch {
    return {
      status: "pass",
      message: "no active sessions",
      value: 0,
    };
  }
}

async function checkDatabase(): Promise<{ status: "pass" | "fail" | "warn"; message: string }> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return { status: "warn", message: "DATABASE_URL not set" };

  const isPostgres = dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://");

  if (isPostgres) {
    try {
      // dynamic import to avoid loading pg in edge/SQLite environments
      const { Pool } = await import("pg");
      const pool = new Pool({ connectionString: dbUrl, max: 1 });
      await pool.query("SELECT 1");
      await pool.end();
      return { status: "pass", message: "postgres connected" };
    } catch (err) {
      return { status: "fail", message: `postgres unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // SQLite — use getDb() which is now async
  try {
    const { getDb } = await import("@/lib/auth-server");
    const db = await getDb();
    if (!db) return { status: "warn", message: "sqlite not initialized" };
    db.prepare("SELECT 1").get();
    return { status: "pass", message: "sqlite connected" };
  } catch (err) {
    return { status: "fail", message: `sqlite error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkAuth(): Promise<{ status: "pass" | "fail" | "warn"; message: string }> {
  try {
    const { getAuth } = await import("@/lib/auth-server");
    const auth = await getAuth();
    if (!auth) return { status: "fail", message: "auth failed to initialize (check startup logs)" };
    return { status: "pass", message: "auth initialized" };
  } catch (err) {
    return { status: "fail", message: `auth error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function checkDiskSpace(): { status: "pass" | "warn" | "fail"; message: string; value?: number } {
  try {
    const stats = statfsSync("/");
    const availablePercent = Math.round((stats.bavail / stats.blocks) * 100);
    if (availablePercent < 5) return { status: "fail", message: `disk critically low: ${availablePercent}% free`, value: availablePercent };
    if (availablePercent < 15) return { status: "warn", message: `disk space low: ${availablePercent}% free`, value: availablePercent };
    return { status: "pass", message: `disk ok: ${availablePercent}% free`, value: availablePercent };
  } catch {
    return { status: "warn", message: "disk check unavailable" };
  }
}

function checkMemory(): { status: "pass" | "warn"; message: string; value?: number } {
  const heapUsed = process.memoryUsage().heapUsed;
  const heapTotal = process.memoryUsage().heapTotal;
  const usedMb = Math.round(heapUsed / 1024 / 1024);
  const totalMb = Math.round(heapTotal / 1024 / 1024);
  const usedPct = Math.round((heapUsed / heapTotal) * 100);
  if (usedPct > 90) return { status: "warn", message: `heap high: ${usedMb}/${totalMb} MB (${usedPct}%)`, value: usedMb };
  return { status: "pass", message: `heap ok: ${usedMb}/${totalMb} MB`, value: usedMb };
}

function checkMetrics(): {
  status: "pass" | "warn";
  message: string;
} {
  const metricsDir = join(process.env.HOME || "", ".mentiko-metrics");

  if (!existsSync(metricsDir)) {
    return {
      status: "warn",
      message: "metrics directory not initialized",
    };
  }

  return {
    status: "pass",
    message: "metrics directory exists",
  };
}

function checkRecentRuns(): {
  status: "pass" | "warn";
  message: string;
  value?: number;
} {
  const runsDir = config.runsDir;

  if (!existsSync(runsDir)) {
    return {
      status: "pass",
      message: "no runs directory yet",
      value: 0,
    };
  }

  try {
    const entries = readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("run-"))
      .length;

    return {
      status: "pass",
      message: `${entries} runs tracked`,
      value: entries,
    };
  } catch {
    return {
      status: "warn",
      message: "could not read runs directory",
    };
  }
}

async function checkRedis(): Promise<{ status: "pass" | "fail" | "warn"; message: string }> {
  try {
    const alive = await redisPing();
    if (alive) return { status: "pass", message: "redis connected" };
    return { status: "warn", message: "redis not configured or unreachable" };
  } catch (err) {
    return { status: "warn", message: `redis error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkAuditQueue(): Promise<{ status: "pass" | "fail" | "warn"; message: string; value?: { depth: number; active: number; failed: number } }> {
  if (runtimeMode === "development") {
    return { status: "pass", message: "audit queue check skipped in development" };
  }

  if (!redisConfigured) {
    return { status: "warn", message: "audit queue not initialized (redis unavailable)" };
  }

  const { auditQueue } = await import("@/lib/audit-queue");
  if (!auditQueue) {
    return { status: "warn", message: "audit queue not initialized (redis unavailable)" };
  }
  try {
    const [waiting, active, failed] = await Promise.all([
      auditQueue.getWaitingCount(),
      auditQueue.getActiveCount(),
      auditQueue.getFailedCount(),
    ]);
    const value = { depth: waiting, active, failed };
    if (failed > 100) return { status: "warn", message: `audit queue: ${failed} failed jobs`, value };
    return { status: "pass", message: `audit queue ok: ${waiting} waiting, ${active} active, ${failed} failed`, value };
  } catch (err) {
    return { status: "warn", message: `audit queue error: ${err instanceof Error ? err.message : String(err)}` };
  }
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

  const [ptyCheck, sessionsCheck, dbCheck, authCheck, redisCheck, auditCheck] = await Promise.all([
    checkPtyDaemon(),
    checkActiveSessions(),
    checkDatabase(),
    checkAuth(),
    checkRedis(),
    checkAuditQueue(),
  ]);

  const checks: HealthStatus["checks"] = {
    database: dbCheck,
    auth: authCheck,
    pty_daemon: ptyCheck,
    directories: checkDirectories(),
    sessions: sessionsCheck,
    disk: checkDiskSpace(),
    memory: checkMemory(),
    metrics: checkMetrics(),
    runs: checkRecentRuns(),
    redis: redisCheck,
    audit_queue: auditCheck,
  };

  // determine overall status
  const hasFail = Object.values(checks).some((c) => c.status === "fail");
  const hasWarn = Object.values(checks).some((c) => c.status === "warn");

  let status: HealthStatus["status"] = "healthy";
  if (hasFail) status = "unhealthy";
  else if (hasWarn) status = "degraded";

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
