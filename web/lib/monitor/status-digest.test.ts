import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Overrides = {
  checks?: Record<string, { status: "pass" | "fail" | "warn"; message?: string }>;
  worker?: Record<string, unknown>;
  taskCounts?: Record<string, number>;
  webhookDeliveries?: Array<Record<string, unknown>>;
  webhookCounts?: { total: number; delivered: number; failed: number; pending: number };
  breaker?: Record<string, unknown>;
  logs?: Array<Record<string, unknown>>;
  escalations?: Array<{ sessionId: string; task: string; startedAt: string }>;
  sessions?: Array<{ name: string; alive: boolean }>;
};

const PASSING_CHECKS = {
  database: { status: "pass" as const },
  redis: { status: "warn" as const, message: "redis not configured or unreachable" },
  metrics: { status: "warn" as const, message: "metrics directory not initialized" },
};

describe("buildMonitorStatusDigest", () => {
  const originalEnv = process.env;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-monitor-digest-"));
    process.env = { ...originalEnv, MENTIKO_GLOBAL_ROOT: root, NAMESPACE_ID: "digest-test", ORG_ID: "default" };
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(root, { recursive: true, force: true });
  });

  async function setup(overrides: Overrides = {}) {
    jest.doMock("@/lib/system/health-checks", () => ({
      detectMode: () => "development",
      runAllHealthChecks: async () => overrides.checks ?? PASSING_CHECKS,
      overallHealthStatus: (checks: Record<string, { status: string }>) => {
        const values = Object.values(checks);
        if (values.some((c) => c.status === "fail")) return "unhealthy";
        if (values.some((c) => c.status === "warn")) return "degraded";
        return "healthy";
      },
    }));
    jest.doMock("@/lib/system/background-worker-control", () => ({
      getBackgroundWorkerStatus: () => ({
        status: "running",
        autoRun: { status: "running" },
        watchdog: { status: "running" },
        chainWatcher: { status: "running" },
        ...overrides.worker,
      }),
    }));
    jest.doMock("@/lib/pty/pty-client", () => ({
      pty: {
        status: async () => ({ pid: 4242, sessions: { total: 0, alive: 0, dead: 0 } }),
        list: async () => overrides.sessions ?? [{ name: "agent-1", alive: true }],
      },
    }));
    jest.doMock("@/lib/tasks/task-store", () => ({
      taskCount: (_org: string, filter?: { status?: string }) =>
        overrides.taskCounts?.[filter?.status ?? ""] ?? 0,
    }));
    jest.doMock("@/lib/runner-v2/integration-contract", () => ({
      resolveLegacyWebhookStateDir: () => join(root, "webhook-state"),
      listLegacyWebhookDeliveries: () => overrides.webhookDeliveries ?? [],
      legacyWebhookDeliveryCounts: () =>
        overrides.webhookCounts ?? { total: 0, delivered: 0, failed: 0, pending: 0 },
    }));
    jest.doMock("@/lib/api/circuit-breaker", () => ({
      getCircuitBreakerState: () => ({
        enabled: true,
        tripped: false,
        activeRuns: 0,
        maxConcurrentRuns: 3,
        totalRunsToday: 0,
        ...overrides.breaker,
      }),
    }));
    jest.doMock("@/lib/system/system-logger", () => ({
      readLogs: () => overrides.logs ?? [],
    }));
    jest.doMock("@/lib/system/peer-escalations", () => ({
      listPendingEscalations: () => overrides.escalations ?? [],
    }));

    const { buildMonitorStatusDigest } = await import("@/lib/monitor/status-digest");
    const config = (await import("@/lib/config")).default;
    return { buildMonitorStatusDigest, runsDir: config.runsDir };
  }

  function writeRun(runsDir: string, name: string, meta: Record<string, unknown>) {
    mkdirSync(join(runsDir, name), { recursive: true });
    writeFileSync(join(runsDir, name, "run.json"), JSON.stringify(meta));
  }

  it("reports ok with a headline despite cosmetic health warns", async () => {
    const { buildMonitorStatusDigest } = await setup({
      taskCounts: { in_progress: 2, open: 5, blocked: 0 },
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    expect(digest.overall).toBe("ok");
    expect(digest.health.status).toBe("degraded");
    expect(digest.health.warning).toEqual(expect.arrayContaining(["redis", "metrics"]));
    expect(digest.headline).toContain("all clear");
    expect(digest.headline).toContain("2 tasks in flight");
    expect(digest.tasks).toEqual({ open: 5, inProgress: 2, blocked: 0 });
  });

  it("goes unhealthy on a failing health check and names it", async () => {
    const { buildMonitorStatusDigest } = await setup({
      checks: { ...PASSING_CHECKS, database: { status: "fail", message: "sqlite error: locked" } },
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    expect(digest.overall).toBe("unhealthy");
    expect(digest.health.failing).toEqual(["database"]);
    expect(digest.attention[0]).toMatchObject({
      severity: "critical",
      message: expect.stringContaining("database"),
    });
  });

  it("surfaces a fresh failed run as attention but ignores stale failures", async () => {
    const { buildMonitorStatusDigest, runsDir } = await setup();
    writeRun(runsDir, "run-fresh", {
      id: "run-fresh",
      chain: "deploy",
      status: "failed",
      updatedAt: new Date().toISOString(),
      status_message: "agent exited 1",
    });
    writeRun(runsDir, "run-stale", {
      id: "run-stale",
      chain: "old-chain",
      status: "failed",
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    expect(digest.overall).toBe("degraded");
    expect(digest.runs.recentFailures).toHaveLength(1);
    expect(digest.runs.recentFailures[0]).toMatchObject({ id: "run-fresh", detail: "agent exited 1" });
    expect(digest.attention).toEqual([
      expect.objectContaining({
        severity: "warn",
        message: expect.stringContaining("run-fresh"),
        actionUrl: "/runs?id=run-fresh",
      }),
    ]);
  });

  it("clamps embedded error-page blobs in run details to one readable line", async () => {
    const { buildMonitorStatusDigest, runsDir } = await setup();
    const htmlBlob = `generation import failed: 500 <!DOCTYPE html><html>${"x".repeat(5000)}</html>`;
    writeRun(runsDir, "run-blob", {
      id: "run-blob",
      chain: "summary",
      status: "failed",
      updatedAt: new Date().toISOString(),
      status_message: htmlBlob,
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    const detail = digest.runs.recentFailures[0].detail!;
    expect(detail.length).toBeLessThan(300);
    expect(detail).toContain("… [truncated]");
    expect(detail).toContain("generation import failed: 500");
  });

  it("classifies reaped runs as self-heals, not failures", async () => {
    const { buildMonitorStatusDigest, runsDir } = await setup();
    writeRun(runsDir, "run-reaped", {
      id: "run-reaped",
      chain: "research",
      status: "failed",
      updatedAt: new Date().toISOString(),
      status_message: "reaped: no agent liveness for >45m (dead session); freed concurrency slot",
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    expect(digest.runs.recentFailures).toHaveLength(0);
    expect(digest.runs.recentlyReaped).toHaveLength(1);
    expect(digest.autoFixes).toEqual([
      expect.objectContaining({
        kind: "reaped-dead-run",
        detail: expect.stringContaining("run-reaped"),
      }),
    ]);
  });

  it("masks webhook urls to origin and carries the remote http code", async () => {
    const now = new Date().toISOString();
    const { buildMonitorStatusDigest } = await setup({
      webhookCounts: { total: 10, delivered: 8, failed: 2, pending: 0 },
      webhookDeliveries: [
        {
          event_id: "evt-1",
          event_type: "chain_complete",
          url: "https://hooks.example.com/webhook?token=SUPER_SECRET",
          attempts: 3,
          status: "failed",
          created_at: now,
          updated_at: now,
          http_code: "503",
        },
      ],
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    expect(digest.webhooks.recentFailures[0]).toMatchObject({
      urlOrigin: "https://hooks.example.com",
      httpCode: "503",
    });
    expect(JSON.stringify(digest)).not.toContain("SUPER_SECRET");
    expect(digest.attention).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("HTTP 503"),
        actionUrl: "/webhooks",
      }),
    ]);
  });

  it("treats a tripped circuit breaker as critical", async () => {
    const { buildMonitorStatusDigest } = await setup({
      breaker: { tripped: true, tripReason: "3 consecutive failures" },
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    expect(digest.overall).toBe("unhealthy");
    expect(digest.attention).toEqual([
      expect.objectContaining({
        severity: "critical",
        message: expect.stringContaining("circuit breaker tripped"),
        actionUrl: "/schedules",
      }),
    ]);
  });

  it("lists pending peer escalations as attention", async () => {
    const { buildMonitorStatusDigest } = await setup({
      escalations: [{ sessionId: "link-7", task: "refactor auth", startedAt: new Date().toISOString() }],
    });
    const digest = await buildMonitorStatusDigest("digest-test", "default");

    expect(digest.attention).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("link-7"),
        actionUrl: "/links",
      }),
    ]);
  });
});
