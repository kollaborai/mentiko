import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { getCircuitBreakerState } from "@/lib/api/circuit-breaker";
import { getBackgroundWorkerStatus } from "@/lib/system/background-worker-control";
import {
  detectMode,
  overallHealthStatus,
  runAllHealthChecks,
} from "@/lib/system/health-checks";
import { listPendingEscalations } from "@/lib/system/peer-escalations";
import { readLogs } from "@/lib/system/system-logger";
import { taskCount } from "@/lib/tasks/task-store";
import {
  legacyWebhookDeliveryCounts,
  listLegacyWebhookDeliveries,
  resolveLegacyWebhookStateDir,
} from "@/lib/runner-v2/integration-contract";

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RUN_SCAN_CAP = 200;

export interface MonitorRunSnapshot {
  id: string;
  chain: string;
  status: string;
  at?: string;
  detail?: string;
}

export interface MonitorAttentionItem {
  severity: "warn" | "critical";
  message: string;
  actionUrl?: string;
}

export interface MonitorAutoFix {
  kind: "reaped-dead-run" | "reconciler" | "self-heal";
  detail: string;
  at?: string;
}

export interface MonitorStatusDigest {
  generatedAt: string;
  mode: string;
  overall: "ok" | "degraded" | "unhealthy";
  headline: string;
  health: {
    status: "healthy" | "degraded" | "unhealthy";
    failing: string[];
    warning: string[];
  };
  loops: {
    worker: "running" | "stopped";
    autoRun?: { status: string; lastError?: string | null; lastTriggered?: number };
    watchdog?: { status: string; lastStalled?: number; lastError?: string };
    chainWatcher?: { status: string; lastError?: string | null };
    lastReconcileCleaned?: number;
  };
  runs: {
    total: number;
    active: number;
    recentFailures: MonitorRunSnapshot[];
    recentlyReaped: MonitorRunSnapshot[];
  };
  tasks: { open: number; inProgress: number; blocked: number };
  sessions: { daemonUp: boolean; alive: number; dead: number };
  webhooks: {
    total: number;
    delivered: number;
    failed: number;
    pending: number;
    recentFailures: {
      eventType: string;
      urlOrigin: string;
      httpCode?: string;
      attempts: number;
      at?: string;
    }[];
  };
  schedules: {
    circuitBreaker: {
      enabled: boolean;
      tripped: boolean;
      tripReason?: string;
      activeRuns: number;
      maxConcurrentRuns: number;
    };
  };
  autoFixes: MonitorAutoFix[];
  errorsRecent: { ts: string; level: string; source: string; message: string }[];
  attention: MonitorAttentionItem[];
}

/** Webhook URLs can embed tokens in paths or query strings — expose the origin only. */
function maskWebhookUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "invalid-url";
  }
}

function runTimestamp(meta: Record<string, unknown>): string | undefined {
  for (const key of ["updatedAt", "completed", "blockedAt", "resumedAt", "startedAt", "started"]) {
    const value = meta[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function isRecent(at: string | undefined, now: number): boolean {
  if (!at) return false;
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) && now - parsed <= RECENT_WINDOW_MS;
}

function scanRuns(now: number): MonitorStatusDigest["runs"] {
  const runsDir = config.runsDir;
  const result: MonitorStatusDigest["runs"] = {
    total: 0,
    active: 0,
    recentFailures: [],
    recentlyReaped: [],
  };
  if (!existsSync(runsDir)) return result;

  let names: string[];
  try {
    names = readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("run-"))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return result;
  }

  result.total = names.length;

  for (const name of names.slice(0, RUN_SCAN_CAP)) {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(readFileSync(join(runsDir, name, "run.json"), "utf-8"));
    } catch {
      continue;
    }
    const status = typeof meta.status === "string" ? meta.status : "unknown";
    const at = runTimestamp(meta);
    const snapshot: MonitorRunSnapshot = {
      id: typeof meta.id === "string" ? meta.id : name,
      chain: typeof meta.chain === "string" ? meta.chain : "unknown",
      status,
      ...(at ? { at } : {}),
    };

    if (status === "running" || status === "pending") result.active += 1;

    const statusMessage = typeof meta.status_message === "string" ? meta.status_message : "";
    if (statusMessage.startsWith("reaped:") && isRecent(at, now) && result.recentlyReaped.length < 5) {
      result.recentlyReaped.push({ ...snapshot, detail: statusMessage });
      continue;
    }
    if ((status === "failed" || status === "stopped") && isRecent(at, now) && result.recentFailures.length < 5) {
      result.recentFailures.push({
        ...snapshot,
        ...(statusMessage ? { detail: statusMessage } : {}),
      });
    }
  }

  return result;
}

async function scanSessions(): Promise<MonitorStatusDigest["sessions"]> {
  try {
    const { pty } = await import("@/lib/pty/pty-client");
    const [daemon, sessions] = await Promise.all([pty.status(), pty.list()]);
    const alive = sessions.filter((s) => s.alive).length;
    return { daemonUp: !!daemon, alive, dead: sessions.length - alive };
  } catch {
    return { daemonUp: false, alive: 0, dead: 0 };
  }
}

function countTasks(namespaceId: string, orgId: string): MonitorStatusDigest["tasks"] {
  const count = (status: string): number => {
    try {
      return taskCount(orgId, { status }, undefined, namespaceId);
    } catch {
      return 0;
    }
  };
  return {
    open: count("open"),
    inProgress: count("in_progress"),
    blocked: count("blocked"),
  };
}

function scanWebhooks(now: number): MonitorStatusDigest["webhooks"] {
  try {
    const stateDir = resolveLegacyWebhookStateDir();
    const counts = legacyWebhookDeliveryCounts(stateDir);
    const recentFailures = listLegacyWebhookDeliveries(stateDir)
      .filter((d) => d.status === "failed" && isRecent(d.updated_at || d.created_at, now))
      .slice(0, 5)
      .map((d) => ({
        eventType: d.event_type,
        urlOrigin: maskWebhookUrl(d.url),
        ...(d.http_code ? { httpCode: d.http_code } : {}),
        attempts: d.attempts,
        ...(d.updated_at || d.created_at ? { at: d.updated_at || d.created_at } : {}),
      }));
    return { ...counts, recentFailures };
  } catch {
    return { total: 0, delivered: 0, failed: 0, pending: 0, recentFailures: [] };
  }
}

function collectAutoFixes(
  runs: MonitorStatusDigest["runs"],
  logs: ReturnType<typeof readLogs>,
  lastReconcileCleaned: number | undefined,
): MonitorAutoFix[] {
  const fixes: MonitorAutoFix[] = [];
  for (const reaped of runs.recentlyReaped) {
    fixes.push({
      kind: "reaped-dead-run",
      detail: `run ${reaped.id} (${reaped.chain}) had a dead session — terminalized and freed its slot`,
      ...(reaped.at ? { at: reaped.at } : {}),
    });
  }
  for (const entry of logs) {
    if (entry.source === "task-reconciler" && fixes.length < 12) {
      fixes.push({ kind: "reconciler", detail: entry.message, at: entry.ts });
    }
  }
  if (lastReconcileCleaned && lastReconcileCleaned > 0) {
    fixes.push({
      kind: "self-heal",
      detail: `reconciler cleaned ${lastReconcileCleaned} orphaned run${lastReconcileCleaned === 1 ? "" : "s"} on its last pass`,
    });
  }
  return fixes.slice(0, 12);
}

function buildHeadline(digest: Omit<MonitorStatusDigest, "headline">): string {
  const inFlight = `${digest.tasks.inProgress} task${digest.tasks.inProgress === 1 ? "" : "s"} in flight`;
  const runsActive = `${digest.runs.active} run${digest.runs.active === 1 ? "" : "s"} active`;
  if (digest.overall === "ok") {
    return `all clear — ${inFlight}, ${runsActive}, ${digest.sessions.alive} live session${digest.sessions.alive === 1 ? "" : "s"}`;
  }
  const top = digest.attention[0];
  if (top) return `${digest.overall}: ${top.message}`;
  return `${digest.overall} — ${inFlight}, ${runsActive}`;
}

/**
 * The Mentiko Monitor's single view of the platform: health, automation loops,
 * runs, tasks, sessions, webhooks, self-heals, and what needs a human.
 *
 * `overall` keys off operational signals (check FAILs, loop errors, tripped
 * breaker, fresh failures). Cosmetic health warns — redis absent in dev,
 * metrics dir missing — are listed in health.warning but do not flip the
 * verdict on their own, so the monitor does not cry wolf on every dev box.
 */
export async function buildMonitorStatusDigest(
  namespaceId: string,
  orgId: string,
): Promise<MonitorStatusDigest> {
  const now = Date.now();
  const mode = detectMode();

  const [checks, sessions] = await Promise.all([runAllHealthChecks(mode), scanSessions()]);
  const healthStatus = overallHealthStatus(checks);
  const failing = Object.entries(checks).filter(([, c]) => c.status === "fail").map(([k]) => k);
  const warning = Object.entries(checks).filter(([, c]) => c.status === "warn").map(([k]) => k);

  const worker = getBackgroundWorkerStatus();
  const runs = scanRuns(now);
  const tasks = countTasks(namespaceId, orgId);
  const webhooks = scanWebhooks(now);
  const breaker = getCircuitBreakerState();

  let logs: ReturnType<typeof readLogs> = [];
  try {
    logs = readLogs(namespaceId, orgId, 100);
  } catch {
    // no system log yet
  }
  const errorsRecent = logs
    .filter((l) => (l.level === "error" || l.level === "warn") && isRecent(l.ts, now))
    .slice(0, 8)
    .map((l) => ({ ts: l.ts, level: l.level, source: l.source, message: l.message }));

  const attention: MonitorAttentionItem[] = [];
  for (const key of failing) {
    attention.push({ severity: "critical", message: `health check failing: ${key} — ${checks[key].message ?? ""}`.trim() });
  }
  if (worker.status === "stopped") {
    attention.push({
      severity: mode === "development" ? "warn" : "critical",
      message: "background worker is stopped — reconciler, watchdog, and auto-run are not running",
    });
  }
  if (breaker.tripped) {
    attention.push({
      severity: "critical",
      message: `schedule circuit breaker tripped: ${breaker.tripReason ?? "unknown reason"}`,
      actionUrl: "/schedules",
    });
  }
  for (const loop of ["autoRun", "chainWatcher"] as const) {
    const lastError = worker[loop]?.lastError;
    if (lastError) {
      attention.push({ severity: "warn", message: `${loop} loop error: ${lastError}` });
    }
  }
  if (worker.watchdog?.lastError) {
    attention.push({ severity: "warn", message: `watchdog error: ${worker.watchdog.lastError}` });
  }
  for (const failure of runs.recentFailures) {
    attention.push({
      severity: "warn",
      message: `run ${failure.id} (${failure.chain}) ${failure.status}${failure.detail ? `: ${failure.detail}` : ""}`,
      actionUrl: `/runs?id=${encodeURIComponent(failure.id)}`,
    });
  }
  if (webhooks.recentFailures.length > 0) {
    const first = webhooks.recentFailures[0];
    attention.push({
      severity: "warn",
      message: `${webhooks.recentFailures.length} webhook deliver${webhooks.recentFailures.length === 1 ? "y" : "ies"} failed recently (latest: ${first.eventType} to ${first.urlOrigin}${first.httpCode ? `, HTTP ${first.httpCode}` : ""})`,
      actionUrl: "/webhooks",
    });
  }
  let escalations: ReturnType<typeof listPendingEscalations> = [];
  try {
    escalations = listPendingEscalations();
  } catch {
    // registry unreadable — skip rather than fail the digest
  }
  for (const escalation of escalations) {
    attention.push({
      severity: "warn",
      message: `peer session ${escalation.sessionId} escalated and is waiting on your reply (task: ${escalation.task})`,
      actionUrl: "/links",
    });
  }

  const hasCritical = attention.some((a) => a.severity === "critical");
  const overall: MonitorStatusDigest["overall"] =
    healthStatus === "unhealthy" || hasCritical
      ? "unhealthy"
      : attention.length > 0
        ? "degraded"
        : "ok";

  const autoFixes = collectAutoFixes(runs, logs, worker.lastReconcileCleaned);

  const withoutHeadline: Omit<MonitorStatusDigest, "headline"> = {
    generatedAt: new Date(now).toISOString(),
    mode,
    overall,
    health: { status: healthStatus, failing, warning },
    loops: {
      worker: worker.status,
      ...(worker.autoRun
        ? {
            autoRun: {
              status: worker.autoRun.status,
              ...(worker.autoRun.lastError !== undefined ? { lastError: worker.autoRun.lastError } : {}),
              ...(worker.autoRun.lastTriggered !== undefined ? { lastTriggered: worker.autoRun.lastTriggered } : {}),
            },
          }
        : {}),
      ...(worker.watchdog
        ? {
            watchdog: {
              status: worker.watchdog.status,
              ...(worker.watchdog.lastStalled !== undefined ? { lastStalled: worker.watchdog.lastStalled } : {}),
              ...(worker.watchdog.lastError !== undefined ? { lastError: worker.watchdog.lastError } : {}),
            },
          }
        : {}),
      ...(worker.chainWatcher
        ? {
            chainWatcher: {
              status: worker.chainWatcher.status,
              ...(worker.chainWatcher.lastError !== undefined ? { lastError: worker.chainWatcher.lastError } : {}),
            },
          }
        : {}),
      ...(worker.lastReconcileCleaned !== undefined
        ? { lastReconcileCleaned: worker.lastReconcileCleaned }
        : {}),
    },
    runs,
    tasks,
    sessions,
    webhooks,
    schedules: {
      circuitBreaker: {
        enabled: breaker.enabled,
        tripped: breaker.tripped,
        ...(breaker.tripReason ? { tripReason: breaker.tripReason } : {}),
        activeRuns: breaker.activeRuns,
        maxConcurrentRuns: breaker.maxConcurrentRuns,
      },
    },
    autoFixes,
    errorsRecent,
    attention,
  };

  return { ...withoutHeadline, headline: buildHeadline(withoutHeadline) };
}
