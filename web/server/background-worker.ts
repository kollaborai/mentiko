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
import { createBackgroundWorkerShutdown } from "./background-worker-shutdown";

const CHECK_INTERVAL_MS = 60_000;
const RECONCILE_STARTUP_DELAY_MS = 3000;
const EXTERNAL_DRAIN_INTERVAL_MS = 15_000;
const WATCHDOG_INTERVAL_MS = 60_000;

let reconcileInterval: ReturnType<typeof setInterval> | null = null;
let decisionReconcileInterval: ReturnType<typeof setInterval> | null = null;
let externalDrainInterval: ReturnType<typeof setInterval> | null = null;
let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let externalDrainInFlight = false;
let watchdogInFlight = false;
let decisionReconcileInFlight = false;

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
    lastExternalDrain: externalDrainState.lastRun,
    lastExternalDispatched: externalDrainState.lastDispatched,
    note: note || reconcilerState.note || decisionReconcilerState.lastError || externalDrainState.note,
  };
}

async function runDecisionReconciler(label: string) {
  if (decisionReconcileInFlight) return;
  decisionReconcileInFlight = true;
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
  } finally {
    decisionReconcileInFlight = false;
    persistStatus();
  }
}

function persistStatus(note?: string) {
  writeBackgroundWorkerStatusFile(workerOwner, currentStatus(note));
}

async function runReconciler(label: string) {
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
  } finally {
    persistStatus();
  }
}

/**
 * Recover stalled runs from the same long-lived TypeScript worker that owns
 * scheduling and event-triggered launches. PTY observation failure is surfaced
 * in status and the watchdog itself fails closed without mutating runs.
 */
async function runWatchdog(label: string) {
  if (watchdogInFlight) return;
  watchdogInFlight = true;
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
  } finally {
    watchdogInFlight = false;
    persistStatus();
  }
}

/**
 * Deliver runner-v2 queued external effects (notifications, webhooks, task
 * status, plugins). Typed completion records them in an outbox instead of
 * firing them from the tenant runtime; this worker is the live dispatcher.
 */
async function runExternalDrain(label: string) {
  if (externalDrainInFlight) return;
  externalDrainInFlight = true;
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
  } finally {
    externalDrainInFlight = false;
    persistStatus();
  }
}

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
  persistStatus("scheduler + auto-run + chain watcher started");

  await new Promise((resolve) => setTimeout(resolve, RECONCILE_STARTUP_DELAY_MS));
  await runReconciler("startup");
  await runDecisionReconciler("startup");
  await runWatchdog("startup");
  await runExternalDrain("startup");

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

  heartbeatInterval = setInterval(() => {
    persistStatus();
  }, 5000);

  console.log("[worker] background worker started");
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

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaught exception:", err);
  persistStatus(err instanceof Error ? err.message : String(err));
  void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandled rejection:", err);
  persistStatus(err instanceof Error ? err.message : String(err));
  void shutdown("unhandledRejection", 1);
});

void start().catch((err) => {
  console.error("[worker] failed to start:", err);
  persistStatus(err instanceof Error ? err.message : String(err));
  void shutdown("startupFailure", 1);
});
