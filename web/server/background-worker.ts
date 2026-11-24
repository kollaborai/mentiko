#!/usr/bin/env node

import {
  captureBackgroundWorkerOwner,
  commitStoppedBackgroundWorkerState,
  registerBackgroundWorker,
  writeBackgroundWorkerStatusFile,
} from "../lib/system/background-worker-state";
import { reconcileOrphanedRuns } from "../lib/runs/run-reconciler";
import { reconcileDecisions } from "../lib/decisions/decision-reconciler";
import { drainRunnerV2ExternalEffects } from "../lib/runner-v2/external-effects";
import {
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
} from "../lib/schedules/scheduler-service";
import {
  getAutoRunServiceStatus,
  startAutoRunService,
  stopAutoRunService,
} from "../lib/runs/auto-run-service";
import {
  getChainWatcherServiceStatus,
  startChainWatcherService,
  stopChainWatcherService,
} from "../lib/runner-v2/chain-watcher-service";
import { runTypedWatchdogScan } from "../lib/runner-v2/watchdog";
import { reconcileRoutedLaunchJobs } from "../lib/runner-v2/launch-job-runner";
import { reconstructResumeLaunchEnvironment } from "../lib/runner-v2/resume-launch-credentials";
import { reconcileGitNodeWorkspaceCleanups } from "../lib/runner-v2/workspace-cleanup";
import { createBackgroundWorkerShutdown } from "./background-worker-shutdown";
import { createBoundedJob, describeJobError, getOverrunningJobs, runGuardedJob } from "./guarded-job";
import config from "../lib/config";
import { writeLog } from "../lib/system/system-logger";

const CHECK_INTERVAL_MS = 60_000;
const RECONCILE_STARTUP_DELAY_MS = 3000;
const EXTERNAL_DRAIN_INTERVAL_MS = 15_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const LAUNCH_JOB_INTERVAL_MS = 15_000;
const WORKSPACE_CLEANUP_INTERVAL_MS = 30_000;

let reconcileInterval: ReturnType<typeof setInterval> | null = null;
let decisionReconcileInterval: ReturnType<typeof setInterval> | null = null;
let externalDrainInterval: ReturnType<typeof setInterval> | null = null;
let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let launchJobInterval: ReturnType<typeof setInterval> | null = null;
let workspaceCleanupInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

const startedAt = new Date().toISOString();
const workerOwner = captureBackgroundWorkerOwner(process.pid);
const reconcilerState: {
  lastRun?: string;
  lastCleaned?: number;
  note?: string;
} = {};
const decisionReconcilerState: {
  lastCheck?: string;
  checkCount: number;
  examined?: number;
  activeGenerating?: number;
  deadPointers?: number;
  recoveriesScheduled?: number;
  replaysScheduled?: number;
  exhausted?: number;
  coolingDown?: number;
  lastError?: string;
} = { checkCount: 0 };
const externalDrainState: {
  lastRun?: string;
  lastDispatched?: number;
  note?: string;
} = {};
const watchdogState: {
  lastCheck?: string;
  checkCount: number;
  lastStalled?: number;
  transportAvailable?: boolean;
  lastError?: string;
} = { checkCount: 0 };
const launchJobState: {
  lastCheck?: string;
  checkCount: number;
  examined?: number;
  scheduled?: number;
  active?: number;
  lastError?: string;
} = { checkCount: 0 };
const workspaceCleanupState: {
  lastCheck?: string;
  checkCount: number;
  examined?: number;
  completed?: number;
  preserved?: number;
  lastError?: string;
} = { checkCount: 0 };

function currentStatus(note?: string) {
  const scheduler = getSchedulerStatus();
  const autoRun = getAutoRunServiceStatus();
  const chainWatcher = getChainWatcherServiceStatus();
  const uptime = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);

  return {
    status: shutdownController.isStopping() ? "stopped" as const : "running" as const,
    pid: process.pid,
    startedAt,
    uptime,
    // issue #136: the heartbeat refreshes this every 5s so /api/health sees a
    // hung job as a degraded worker within one heartbeat interval
    overrunningJobs: getOverrunningJobs(),
    lastCheck: scheduler.lastCheck ?? undefined,
    checkCount: scheduler.checkCount,
    lastReconcile: reconcilerState.lastRun,
    lastReconcileCleaned: reconcilerState.lastCleaned,
    decisionReconciler: {
      status: shutdownController.isStopping() ? "stopped" as const : "running" as const,
      lastCheck: decisionReconcilerState.lastCheck,
      checkCount: decisionReconcilerState.checkCount,
      examined: decisionReconcilerState.examined,
      activeGenerating: decisionReconcilerState.activeGenerating,
      deadPointers: decisionReconcilerState.deadPointers,
      recoveriesScheduled: decisionReconcilerState.recoveriesScheduled,
      replaysScheduled: decisionReconcilerState.replaysScheduled,
      exhausted: decisionReconcilerState.exhausted,
      coolingDown: decisionReconcilerState.coolingDown,
      lastError: decisionReconcilerState.lastError,
    },
    autoRun: {
      status: autoRun.status,
      lastCheck: autoRun.lastCheck,
      checkCount: autoRun.checkCount,
      lastTriggered: autoRun.lastTriggered,
      lastError: autoRun.lastError,
    },
    chainWatcher: {
      status: chainWatcher.status,
      startedAt: chainWatcher.startedAt,
      lastCheck: chainWatcher.lastCheck,
      checkCount: chainWatcher.checkCount,
      lastError: chainWatcher.lastError,
    },
    watchdog: {
      status: shutdownController.isStopping() ? "stopped" as const : "running" as const,
      lastCheck: watchdogState.lastCheck,
      checkCount: watchdogState.checkCount,
      lastStalled: watchdogState.lastStalled,
      transportAvailable: watchdogState.transportAvailable,
      lastError: watchdogState.lastError,
    },
    launchJobs: {
      status: shutdownController.isStopping() ? "stopped" as const : "running" as const,
      lastCheck: launchJobState.lastCheck,
      checkCount: launchJobState.checkCount,
      examined: launchJobState.examined,
      scheduled: launchJobState.scheduled,
      active: launchJobState.active,
      lastError: launchJobState.lastError,
    },
    workspaceCleanups: {
      status: shutdownController.isStopping() ? "stopped" as const : "running" as const,
      lastCheck: workspaceCleanupState.lastCheck,
      checkCount: workspaceCleanupState.checkCount,
      examined: workspaceCleanupState.examined,
      completed: workspaceCleanupState.completed,
      preserved: workspaceCleanupState.preserved,
      lastError: workspaceCleanupState.lastError,
    },
    lastExternalDrain: externalDrainState.lastRun,
    lastExternalDispatched: externalDrainState.lastDispatched,
    note: note
      || reconcilerState.note
      || decisionReconcilerState.lastError
      || workspaceCleanupState.lastError
      || externalDrainState.note,
  };
}

// codex rev2 P2: job errors must reach the system log (system.jsonl), not
// only the terminal. Runners rethrow after updating their state so the
// bounded wrapper logs job name + stack; callbacks that cannot rethrow
// (per-job onError during a reconciler pass) log through here.
function logWorkerError(context: string, error: unknown) {
  const { message, detail } = describeJobError(error);
  writeLog(config.namespaceId, config.orgId, "error", "worker", `${context}: ${message}`, detail);
}

const runLaunchJobReconciler = createBoundedJob("launch-jobs", (label: string) => {
  try {
    const runtimeErrors: string[] = [];
    const result = reconcileRoutedLaunchJobs({
      // Accepted resume jobs get their scoped session token and profile/secrets
      // reconstructed at claim time (#142 r2); a failure blocks the job visibly
      // instead of launching unauthenticated work.
      dependencies: { reconstructResumeEnvironment: reconstructResumeLaunchEnvironment },
      onError: (error) => {
        runtimeErrors.push(error.message);
        console.warn(`[worker] routed launch job ${label} failed:`, error);
        logWorkerError(`launch job (${label})`, error);
      },
    });
    launchJobState.lastCheck = new Date().toISOString();
    launchJobState.checkCount += 1;
    launchJobState.examined = result.examined;
    launchJobState.scheduled = result.scheduled;
    launchJobState.active = result.active;
    launchJobState.lastError = [...result.errors, ...runtimeErrors].join("; ") || undefined;
    if (result.scheduled > 0) {
      console.log(`[worker] routed launch reconciler ${label}: ${result.scheduled} jobs scheduled, ${result.active} active`);
    }
  } catch (error) {
    launchJobState.lastCheck = new Date().toISOString();
    launchJobState.checkCount += 1;
    launchJobState.lastError = error instanceof Error ? error.message : String(error);
    console.warn(`[worker] routed launch reconciler ${label} failed:`, error);
    throw error;
  } finally {
    persistStatus();
  }
});

const runWorkspaceCleanupReconciler = createBoundedJob("workspace-cleanup", (label: string) => {
  try {
    const result = reconcileGitNodeWorkspaceCleanups();
    workspaceCleanupState.lastCheck = new Date().toISOString();
    workspaceCleanupState.checkCount += 1;
    workspaceCleanupState.examined = result.examined;
    workspaceCleanupState.completed = result.completed;
    workspaceCleanupState.preserved = result.preserved;
    workspaceCleanupState.lastError = result.errors.join("; ") || undefined;
    if (result.completed > 0 || result.preserved > 0) {
      console.log(
        `[worker] workspace cleanup reconciler ${label}: ${result.completed} completed, `
        + `${result.preserved} preserved`,
      );
    }
  } catch (error) {
    workspaceCleanupState.lastCheck = new Date().toISOString();
    workspaceCleanupState.checkCount += 1;
    workspaceCleanupState.lastError = error instanceof Error ? error.message : String(error);
    console.warn(`[worker] workspace cleanup reconciler ${label} failed:`, error);
    throw error;
  } finally {
    persistStatus();
  }
});

const runDecisionReconciler = createBoundedJob("decision-reconciler", (label: string) => {
  try {
    const result = reconcileDecisions();
    decisionReconcilerState.lastCheck = new Date().toISOString();
    decisionReconcilerState.checkCount += 1;
    decisionReconcilerState.examined = result.examined;
    decisionReconcilerState.activeGenerating = result.activeGenerating;
    decisionReconcilerState.deadPointers = result.deadPointers;
    decisionReconcilerState.recoveriesScheduled = result.recoveriesScheduled;
    decisionReconcilerState.replaysScheduled = result.replaysScheduled;
    decisionReconcilerState.exhausted = result.exhausted;
    decisionReconcilerState.coolingDown = result.coolingDown;
    decisionReconcilerState.lastError = result.errors.length > 0
      ? result.errors.join("; ")
      : undefined;

    if (
      result.deadPointers > 0
      || result.recoveriesScheduled > 0
      || result.replaysScheduled > 0
      || result.exhausted > 0
    ) {
      console.log(
        `[worker] decision reconciler ${label}: ${result.examined} examined, `
        + `${result.deadPointers} dead, ${result.recoveriesScheduled} recoveries scheduled, `
        + `${result.replaysScheduled} import replays scheduled, ${result.exhausted} exhausted`,
      );
    }
  } catch (error) {
    decisionReconcilerState.lastCheck = new Date().toISOString();
    decisionReconcilerState.checkCount += 1;
    decisionReconcilerState.lastError = error instanceof Error ? error.message : String(error);
    console.warn(`[worker] decision reconciler ${label} failed:`, error);
    throw error;
  } finally {
    persistStatus();
  }
});

function persistStatus(note?: string) {
  writeBackgroundWorkerStatusFile(workerOwner, currentStatus(note));
}

const runReconciler = createBoundedJob("reconciler", async (label: string) => {
  try {
    const result = await reconcileOrphanedRuns();
    reconcilerState.lastRun = new Date().toISOString();
    reconcilerState.lastCleaned = result.cleaned.length;
    reconcilerState.note = result.cleaned.length > 0
      ? `reconciler ${label}: cleaned ${result.cleaned.length} runs`
      : undefined;

    if (result.cleaned.length > 0) {
      console.log(`[worker] reconciler ${label}: cleaned ${result.cleaned.length} runs`);
    }
  } catch (err) {
    reconcilerState.lastRun = new Date().toISOString();
    reconcilerState.note = err instanceof Error ? err.message : String(err);
    console.warn(`[worker] reconciler ${label} failed:`, err);
    throw err;
  } finally {
    persistStatus();
  }
});

/**
 * Recover stalled runs from the same long-lived TypeScript worker that owns
 * scheduling and event-triggered launches. PTY observation failure is surfaced
 * in status and the watchdog itself fails closed without mutating runs.
 */
const runWatchdog = createBoundedJob("watchdog", async (label: string) => {
  try {
    const result = await runTypedWatchdogScan();
    watchdogState.lastCheck = new Date().toISOString();
    watchdogState.checkCount += 1;
    watchdogState.lastStalled = result.stalled.length;
    watchdogState.transportAvailable = result.transportAvailable;
    watchdogState.lastError = result.errors.length > 0 ? result.errors.join("; ") : undefined;

    if (result.stalled.length > 0 || result.errors.length > 0) {
      console.log(
        `[worker] watchdog ${label}: ${result.stalled.length} stalled, `
        + `${result.sessionsRemoved.length + result.orphanSessionsRemoved.length} sessions removed, `
        + `${result.errors.length} errors`,
      );
    }
  } catch (err) {
    watchdogState.lastCheck = new Date().toISOString();
    watchdogState.checkCount += 1;
    watchdogState.lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[worker] watchdog ${label} failed:`, err);
    throw err;
  } finally {
    persistStatus();
  }
});

/**
 * Deliver runner-v2 queued external effects (notifications, webhooks, task
 * status, plugins). Typed completion records them in an outbox instead of
 * firing them from the tenant runtime; this worker is the live dispatcher.
 */
const runExternalDrain = createBoundedJob("external-drain", async (label: string) => {
  try {
    const result = await drainRunnerV2ExternalEffects();
    externalDrainState.lastRun = new Date().toISOString();
    externalDrainState.lastDispatched = result.dispatched;
    externalDrainState.note = result.failed > 0
      ? `external drain ${label}: ${result.failed} effects failed permanently`
      : undefined;

    if (result.handled > 0) {
      console.log(
        `[worker] external drain ${label}: ${result.dispatched} dispatched, ${result.skipped} skipped, `
        + `${result.requeued} requeued, ${result.failed} failed (${result.outboxes} outboxes)`,
      );
    }
  } catch (err) {
    externalDrainState.lastRun = new Date().toISOString();
    externalDrainState.note = err instanceof Error ? err.message : String(err);
    console.warn(`[worker] external drain ${label} failed:`, err);
    throw err;
  } finally {
    persistStatus();
  }
});

async function start() {
  registerBackgroundWorker(workerOwner);
  persistStatus("worker booting");

  startScheduler();
  startAutoRunService();
  startChainWatcherService({
    onFatalError: (error) => {
      console.error("[worker] chain watcher failed; requesting supervised restart:", error);
      void shutdown("chainWatcherFailure", 1);
    },
  });

  // issue #136 (codex rev2 P1): periodic scheduling and the heartbeat are
  // installed BEFORE any startup work is awaited. One startup job that never
  // settles must not block every later tick, and the heartbeat keeps the
  // status file fresh even while startup work hangs. Every tick below is a
  // guarded job (createBoundedJob): a throw is isolated, a job that never
  // settles stops only that job, and the overrun is logged and surfaced in
  // the status file so /api/health reports the worker degraded.
  reconcileInterval = setInterval(() => {
    void runReconciler("periodic");
  }, CHECK_INTERVAL_MS);

  decisionReconcileInterval = setInterval(() => {
    void runDecisionReconciler("periodic");
  }, CHECK_INTERVAL_MS);

  externalDrainInterval = setInterval(() => {
    void runExternalDrain("periodic");
  }, EXTERNAL_DRAIN_INTERVAL_MS);

  watchdogInterval = setInterval(() => {
    void runWatchdog("periodic");
  }, WATCHDOG_INTERVAL_MS);

  launchJobInterval = setInterval(() => {
    void runLaunchJobReconciler("periodic");
  }, LAUNCH_JOB_INTERVAL_MS);

  workspaceCleanupInterval = setInterval(() => {
    void runWorkspaceCleanupReconciler("periodic");
  }, WORKSPACE_CLEANUP_INTERVAL_MS);

  heartbeatInterval = setInterval(() => {
    void runGuardedJob("heartbeat", () => persistStatus());
  }, 5000);

  console.log("[worker] background worker started");

  // startup pass, fire-and-forget: nothing here is awaited, so a hung startup
  // job cannot stall the timers above. Each job is bounded on its own.
  setTimeout(() => {
    void runReconciler("startup");
    void runDecisionReconciler("startup");
    void runWatchdog("startup");
    void runExternalDrain("startup");
    void runLaunchJobReconciler("startup");
    void runWorkspaceCleanupReconciler("startup");
  }, RECONCILE_STARTUP_DELAY_MS);
}

async function stopWorkerServices() {
  if (reconcileInterval) {
    clearInterval(reconcileInterval);
    reconcileInterval = null;
  }
  if (decisionReconcileInterval) {
    clearInterval(decisionReconcileInterval);
    decisionReconcileInterval = null;
  }
  if (externalDrainInterval) {
    clearInterval(externalDrainInterval);
    externalDrainInterval = null;
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (launchJobInterval) {
    clearInterval(launchJobInterval);
    launchJobInterval = null;
  }
  if (workspaceCleanupInterval) {
    clearInterval(workspaceCleanupInterval);
    workspaceCleanupInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  const failures: unknown[] = [];
  try { stopScheduler(); } catch (error) { failures.push(error); }
  try { stopAutoRunService(); } catch (error) { failures.push(error); }
  try { await stopChainWatcherService(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw failures[0];
}

const shutdownController = createBackgroundWorkerShutdown({
  stop: stopWorkerServices,
  finalize: ({ signal }) => {
    const finalStatus = {
      ...currentStatus(`worker stopped (${signal})`),
      status: "stopped" as const,
      pid: undefined,
    };
    commitStoppedBackgroundWorkerState(
      workerOwner,
      finalStatus,
    );
  },
  exit: (exitCode) => {
    setTimeout(() => process.exit(Math.max(exitCode, shutdownController.exitCode())), 0);
  },
  onError: (error) => {
    console.error("[worker] shutdown error:", error);
  },
});

function shutdown(signal: string, exitCode = 0): Promise<void> {
  return shutdownController.request(signal, exitCode);
}

// issue #136: a fatal error still exits the process (the process manager
// restarts it), but the cause is written to the system log first so it is on
// disk instead of only on the terminal that started the stack. A disk/log
// failure must never swallow the shutdown that follows (codex rev2 P2): the
// write is guarded, stderr is the fallback, and this function never throws.
function logFatalAndPersist(kind: string, error: unknown) {
  const { message, detail } = describeJobError(error);
  console.error(`[worker] ${kind}:`, error);
  try {
    writeLog(config.namespaceId, config.orgId, "error", "worker", `${kind}: ${message}`, detail);
  } catch (logError) {
    // stderr fallback — no disk write can be guaranteed on a full disk
    console.error(`[worker] system log write failed for ${kind}:`, logError);
  }
  try { persistStatus(message); } catch { /* already failing */ }
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("uncaughtException", (err) => {
  logFatalAndPersist("uncaught exception", err);
  void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (err) => {
  logFatalAndPersist("unhandled rejection", err);
  void shutdown("unhandledRejection", 1);
});

void start().catch((err) => {
  logFatalAndPersist("startup failure", err);
  void shutdown("startupFailure", 1);
});
