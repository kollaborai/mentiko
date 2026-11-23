import { existsSync, readdirSync, statfsSync, statSync } from "fs";
import { getHeapStatistics } from "v8";
import { join } from "path";
import config from "@/lib/config";
import { ping as redisPing, redisConfigured } from "@/lib/system/redis";
import type { BackgroundWorkerStatePaths } from "@/lib/system/background-worker-state";

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

export type RuntimeMode = "docker" | "standalone" | "development";

export function detectMode(): RuntimeMode {
  if (isDocker) return "docker";
  if (isSystemd || process.env.NODE_ENV === "production") return "standalone";
  return "development";
}

export type CheckStatus = "pass" | "fail" | "warn";

export interface HealthCheckResult {
  status: CheckStatus;
  message?: string;
  value?: unknown;
}

export type HealthChecks = { [key: string]: HealthCheckResult };

export async function checkPtyDaemon(): Promise<{ status: CheckStatus; message: string }> {
  if (!hasPtyMgr) {
    if (isDocker || isSystemd) {
      return { status: "warn", message: "pty-manager binary not found (expected in production)" };
    }
    return { status: "pass", message: `pty-manager not applicable (${detectMode()})` };
  }

  try {
    const { pty } = await import("@/lib/pty/pty-client");
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

export function checkDirectories(): {
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

export async function checkActiveSessions(): Promise<{
  status: "pass" | "warn";
  message: string;
  value?: number;
}> {
  if (!hasPtyMgr) {
    if (isDocker || isSystemd) {
      return { status: "warn", message: "pty-manager binary not found (expected in production)", value: 0 };
    }
    return { status: "pass", message: `sessions not applicable (${detectMode()})`, value: 0 };
  }

  try {
    const { pty } = await import("@/lib/pty/pty-client");
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

export async function checkDatabase(): Promise<{ status: CheckStatus; message: string }> {
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
    const { getDb } = await import("@/lib/auth/auth-server");
    const db = await getDb();
    if (!db) return { status: "warn", message: "sqlite not initialized" };
    db.prepare("SELECT 1").get();
    return { status: "pass", message: "sqlite connected" };
  } catch (err) {
    return { status: "fail", message: `sqlite error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function checkAuth(): Promise<{ status: CheckStatus; message: string }> {
  try {
    const { getAuth } = await import("@/lib/auth/auth-server");
    const auth = await getAuth();
    if (!auth) return { status: "fail", message: "auth failed to initialize (check startup logs)" };
    return { status: "pass", message: "auth initialized" };
  } catch (err) {
    return { status: "fail", message: `auth error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function checkDiskSpace(mode: RuntimeMode): { status: CheckStatus; message: string; value?: number } {
  try {
    const stats = statfsSync("/");
    const availablePercent = Math.round((stats.bavail / stats.blocks) * 100);
    if (availablePercent < 5) {
      // in development, disk pressure is an infra warning not an app failure — no process
      // manager or LB is polling this endpoint, so 503 would just break dev tooling
      const status = mode === "development" ? "warn" : "fail";
      return { status, message: `disk critically low: ${availablePercent}% free`, value: availablePercent };
    }
    if (availablePercent < 15) return { status: "warn", message: `disk space low: ${availablePercent}% free`, value: availablePercent };
    return { status: "pass", message: `disk ok: ${availablePercent}% free`, value: availablePercent };
  } catch {
    return { status: "warn", message: "disk check unavailable" };
  }
}

export function checkMemory(): { status: "pass" | "warn"; message: string; value?: number } {
  const heapUsed = process.memoryUsage().heapUsed;
  // Measure against heap_size_limit (V8's hard ceiling, ~= --max-old-space-size),
  // NOT heapTotal. heapTotal is only the currently-committed heap, which V8 keeps
  // close to heapUsed and grows lazily — so heapUsed/heapTotal sits at 85-98% under
  // normal load and reported a false "degraded". Real pressure is heapUsed nearing
  // the limit, which is what this now measures.
  const heapLimit = getHeapStatistics().heap_size_limit;
  const usedMb = Math.round(heapUsed / 1024 / 1024);
  const limitMb = Math.round(heapLimit / 1024 / 1024);
  const usedPct = Math.round((heapUsed / heapLimit) * 100);
  if (usedPct > 90) return { status: "warn", message: `heap high: ${usedMb}/${limitMb} MB (${usedPct}%)`, value: usedMb };
  return { status: "pass", message: `heap ok: ${usedMb}/${limitMb} MB (${usedPct}%)`, value: usedMb };
}

export function checkMetrics(): {
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

export function checkRecentRuns(): {
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

export async function checkRedis(): Promise<{ status: CheckStatus; message: string }> {
  try {
    const alive = await redisPing();
    if (alive) return { status: "pass", message: "redis connected" };
    return { status: "warn", message: "redis not configured or unreachable" };
  } catch (err) {
    return { status: "warn", message: `redis error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function checkAuditQueue(): Promise<{ status: CheckStatus; message: string; value?: { depth: number; active: number; failed: number } }> {
  if (detectMode() === "development") {
    return { status: "pass", message: "audit queue check skipped in development" };
  }

  if (!redisConfigured) {
    return { status: "warn", message: "audit queue not initialized (redis unavailable)" };
  }

  const { getAuditQueue } = await import("@/lib/api/audit-queue");
  const auditQueue = await getAuditQueue();
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

// issue #136: the background worker is the task board's heartbeat. Signals:
// the registered owner pid's liveness, plus the status-file mtime the worker
// refreshes on every 5s heartbeat tick.
const WORKER_HEARTBEAT_STALE_MS = 120_000;

export async function checkBackgroundWorker(
  paths?: BackgroundWorkerStatePaths,
): Promise<HealthCheckResult> {
  try {
    const workerState = await import("@/lib/system/background-worker-state");
    const { claimProcessMatchesIdentity } = await import("@/lib/runner-v2/file-claim");
    const statePaths = paths ?? workerState.getBackgroundWorkerPaths();
    const owner = workerState.readBackgroundWorkerOwner(statePaths);
    const status = workerState.readBackgroundWorkerStatusFile(statePaths);
    if (!owner) {
      return {
        status: "warn",
        message: status?.status === "stopped"
          ? "background worker stopped"
          : "background worker not registered",
      };
    }
    if (!claimProcessMatchesIdentity(owner.pid, owner.processIdentity)) {
      // pid existence alone is not identity: a recycled pid (or one rewritten
      // by another actor) must not pass for a live worker (codex rev2 P2).
      return {
        status: "fail",
        message: `background worker pid ${owner.pid} is not the registered process (stale owner, last status: ${status?.status ?? "unknown"})`,
      };
    }
    if (status?.status === "stopped") {
      return {
        status: "fail",
        message: `background worker status reports stopped while pid ${owner.pid} is registered`,
      };
    }
    const heartbeatAge = Date.now() - statSync(statePaths.statusFile).mtimeMs;
    if (heartbeatAge > WORKER_HEARTBEAT_STALE_MS) {
      return {
        status: "warn",
        message: `background worker heartbeat stale (${Math.round(heartbeatAge / 1000)}s old, pid ${owner.pid} alive)`,
      };
    }
    // issue #136: a job held past its overrun threshold stops only that job;
    // while any is overrunning, the worker is degraded, not healthy.
    const overrunning = status?.overrunningJobs ?? [];
    if (overrunning.length > 0) {
      return {
        status: "warn",
        message: `background worker degraded: job${overrunning.length > 1 ? "s" : ""} overrunning: ${overrunning.join(", ")} (pid ${owner.pid})`,
      };
    }
    return { status: "pass", message: `background worker running (pid ${owner.pid})` };
  } catch (err) {
    return {
      status: "warn",
      message: `background worker check unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Every platform health check, keyed exactly as /api/health reports them. */
export async function runAllHealthChecks(mode: RuntimeMode = detectMode()): Promise<HealthChecks> {
  const [ptyCheck, sessionsCheck, dbCheck, authCheck, redisCheck, auditCheck, workerCheck] = await Promise.all([
    checkPtyDaemon(),
    checkActiveSessions(),
    checkDatabase(),
    checkAuth(),
    checkRedis(),
    checkAuditQueue(),
    checkBackgroundWorker(),
  ]);

  return {
    database: dbCheck,
    auth: authCheck,
    pty_daemon: ptyCheck,
    directories: checkDirectories(),
    sessions: sessionsCheck,
    disk: checkDiskSpace(mode),
    memory: checkMemory(),
    metrics: checkMetrics(),
    runs: checkRecentRuns(),
    redis: redisCheck,
    audit_queue: auditCheck,
    background_worker: workerCheck,
  };
}

/** Overall roll-up used by /api/health and the monitor digest. */
export function overallHealthStatus(checks: HealthChecks): "healthy" | "degraded" | "unhealthy" {
  const hasFail = Object.values(checks).some((c) => c.status === "fail");
  const hasWarn = Object.values(checks).some((c) => c.status === "warn");
  if (hasFail) return "unhealthy";
  if (hasWarn) return "degraded";
  return "healthy";
}

/**
 * Checks excluded from the platform readiness verdict (codex rev2 P1, issue
 * #136). The background worker starts AFTER the platform (processes.json:
 * worker dependsOn platform), and the pm's critical platform readiness probe
 * polls /api/health and fails the platform on 503. A stale dead worker owner
 * from a previous run must not fail the platform that is about to start the
 * replacement worker. The worker check stays in `checks` and in the monitor
 * digest's full roll-up — it is only excluded from the readiness decision.
 */
const PLATFORM_READINESS_EXCLUDE = new Set(["background_worker"]);

/** Readiness verdict for the platform process itself, used for the HTTP status code. */
export function readinessHealthStatus(checks: HealthChecks): "healthy" | "degraded" | "unhealthy" {
  const scoped: HealthChecks = {};
  for (const [key, value] of Object.entries(checks)) {
    if (!PLATFORM_READINESS_EXCLUDE.has(key)) scoped[key] = value;
  }
  return overallHealthStatus(scoped);
}
