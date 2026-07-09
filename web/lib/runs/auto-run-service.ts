/**
 * auto-run service
 *
 * Periodic polling loop used by the background worker.
 * Every 60s, calls POST /api/tasks/auto-run to process tasks
 * with auto_run=true that have their dependencies resolved.
 *
 * Follows the same pattern as scheduler-service.ts.
 */

// ---------------------------------------------------------------------------
// state (on globalThis to survive module reloads within a long-running host)
// ---------------------------------------------------------------------------

interface AutoRunServiceState {
  interval: ReturnType<typeof setInterval> | null;
  startedAt: string | null;
  lastCheck: string | null;
  checkCount: number;
  running: boolean;
  lastTriggered: number;
  lastError: string | null;
  healthy: boolean;
  checkInFlight: boolean;
}

const g = globalThis as typeof globalThis & { __autoRunServiceState?: AutoRunServiceState };
if (!g.__autoRunServiceState) {
  g.__autoRunServiceState = {
    interval: null,
    startedAt: null,
    lastCheck: null,
    checkCount: 0,
    running: false,
    lastTriggered: 0,
    lastError: null,
    healthy: false,
    checkInFlight: false,
  };
}
const state = g.__autoRunServiceState;

const CHECK_INTERVAL_MS = 60_000; // 60s
const HEALTH_CHECK_MAX_WAIT_MS = 30_000; // 30s max wait for platform startup
const HEALTH_CHECK_INTERVAL_MS = 2_000; // 2s between health checks

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export function startAutoRunService() {
  if (state.interval) return; // already running

  const secret = process.env.BETTER_AUTH_SECRET || "";
  if (!secret) {
    console.warn("[auto-run] BETTER_AUTH_SECRET not set -- service calls will fail auth. Set it in .env.local or env.");
  }

  state.startedAt = new Date().toISOString();
  state.running = true;
  console.log("[auto-run] service started (60s interval)");

  // wait for platform to be healthy before first check
  waitForHealth()
    .then(() => {
      if (!state.running) return; // stopped while waiting

      // run first check
      checkAutoRunTasks().catch((err) =>
        console.warn("[auto-run] initial check failed:", err)
      );

      state.interval = setInterval(() => {
        checkAutoRunTasks().catch((err) =>
          console.warn("[auto-run] check failed:", err)
        );
      }, CHECK_INTERVAL_MS);

      // don't prevent process exit
      state.interval.unref();
    })
    .catch((err) => {
      console.warn("[auto-run] health check failed, service degraded:", err);
      // still set up the interval - checks will fail gracefully
      state.interval = setInterval(() => {
        checkAutoRunTasks().catch((err2) =>
          console.warn("[auto-run] check failed:", err2)
        );
      }, CHECK_INTERVAL_MS);
      state.interval.unref();
    });
}

export function stopAutoRunService() {
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
  state.running = false;
  state.startedAt = null;
  state.lastCheck = null;
  state.checkCount = 0;
  state.healthy = false;
  console.log("[auto-run] service stopped");
}

export function getAutoRunServiceStatus() {
  const uptime = state.startedAt
    ? Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000)
    : undefined;

  return {
    status: state.running ? ("running" as const) : ("stopped" as const),
    uptime,
    lastCheck: state.lastCheck,
    checkCount: state.checkCount,
    lastTriggered: state.lastTriggered,
    lastError: state.lastError,
    healthy: state.healthy,
    startedAt: state.startedAt,
  };
}

// ---------------------------------------------------------------------------
// health check (wait for Next.js to be ready)
// ---------------------------------------------------------------------------

async function waitForHealth(): Promise<void> {
  const port = process.env.WEB_PORT || process.env.PORT || 3000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_CHECK_MAX_WAIT_MS) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        state.healthy = true;
        console.log("[auto-run] platform healthy, starting checks");
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  console.warn("[auto-run] platform not healthy after 30s, will retry on each check");
}

// ---------------------------------------------------------------------------
// core loop
// ---------------------------------------------------------------------------

async function checkAutoRunTasks() {
  // Don't stack scans: a full scan can exceed the 60s interval, and a second concurrent
  // scan would double-trigger through the non-atomic cap slice. The two fetches below are
  // each try/caught and the tail is pure assignment, so the guard is always released.
  if (state.checkInFlight) return;
  state.checkInFlight = true;
  const port = process.env.WEB_PORT || process.env.PORT || 3000;
  const secret = process.env.BETTER_AUTH_SECRET || "";
  const namespaceId = process.env.NAMESPACE_ID || "default";

  // reconcile task statuses first -- sync completed/failed runs back to tasks
  // so auto-run can see which tasks are now open and ready for the next step
  try {
    await fetch(`http://localhost:${port}/api/tasks/reconcile`, {
      headers: {
        "Authorization": `Bearer ${secret}`,
        "x-namespace-id": namespaceId,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // non-fatal -- auto-run will just work with stale statuses this cycle
  }

  try {
    const res = await fetch(`http://localhost:${port}/api/tasks/auto-run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
        "x-namespace-id": namespaceId,
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(120_000), // full scan can take ~45s+ on large task sets; must exceed it or every tick "fails"
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      state.lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      // 403 means auto-run is disabled in settings - not an error
      if (res.status === 403) {
        state.lastError = null;
      }
    } else {
      const data = await res.json();
      state.lastTriggered = data.triggered || 0;
      state.lastError = null;
      state.healthy = true;

      if (data.triggered > 0) {
        console.log(`[auto-run] triggered ${data.triggered} task(s)`);
      }
    }
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
    state.healthy = false;
    // don't log connection errors during startup - noisy
    if (state.checkCount > 0) {
      console.warn("[auto-run] check failed:", state.lastError);
    }
  }

  state.lastCheck = new Date().toISOString();
  state.checkCount++;
  state.checkInFlight = false;
}

// ---------------------------------------------------------------------------
// one-shot scan nudge (task-lifecycle "scan_unblocked_auto_run_tasks" effect)
// ---------------------------------------------------------------------------
// When a task closes (or a decision resolves), its dependents may have just
// become unblocked. This fires the SAME /api/tasks/auto-run route the 60s
// poller above hits -- empty body means "scan every candidate", not just the
// task that triggered this -- so a newly-unblocked dependent starts right away
// instead of waiting up to 60s. Fire-and-forget by design: callers do NOT
// await the returned promise, so a close/resolve can never fail because this
// downstream nudge failed or timed out. Errors are caught and logged here so
// there is never an unhandled rejection even though nobody awaits us.
export async function triggerAutoRunScan(namespaceId: string, orgId: string, completedTaskId?: string): Promise<void> {
  const port = process.env.WEB_PORT || process.env.PORT || 3000;
  const secret = process.env.BETTER_AUTH_SECRET || "";

  try {
    await fetch(`http://localhost:${port}/api/tasks/auto-run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
        "x-namespace-id": namespaceId,
        "x-org-id": orgId,
      },
      // completedTaskId -> the route scans only that task's direct dependents (surgical,
      // storm-safe). Omitted -> full-org scan (legacy callers). Fire-and-forget either way.
      body: JSON.stringify(completedTaskId ? { completedTaskId } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    console.warn("[auto-run] scan_unblocked_auto_run_tasks nudge failed:", err);
  }
}
