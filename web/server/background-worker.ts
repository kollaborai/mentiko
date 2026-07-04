#!/usr/bin/env node

import {
  clearBackgroundWorkerPid,
  writeBackgroundWorkerPid,
  writeBackgroundWorkerStatusFile,
} from "../lib/system/background-worker-state";
import { reconcileOrphanedRuns } from "../lib/runs/run-reconciler";
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

const CHECK_INTERVAL_MS = 60_000;
const RECONCILE_STARTUP_DELAY_MS = 3000;
const EXTERNAL_DRAIN_INTERVAL_MS = 15_000;

let reconcileInterval: ReturnType<typeof setInterval> | null = null;
let externalDrainInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let stopping = false;
let externalDrainInFlight = false;

const startedAt = new Date().toISOString();
const reconcilerState: {
  lastRun?: string;
  lastCleaned?: number;
  note?: string;
} = {};
const externalDrainState: {
  lastRun?: string;
  lastDispatched?: number;
  note?: string;
} = {};

function currentStatus(note?: string) {
  const scheduler = getSchedulerStatus();
  const autoRun = getAutoRunServiceStatus();
  const uptime = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);

  return {
    status: stopping ? "stopped" as const : "running" as const,
    pid: process.pid,
    startedAt,
    uptime,
    lastCheck: scheduler.lastCheck ?? undefined,
    checkCount: scheduler.checkCount,
    lastReconcile: reconcilerState.lastRun,
    lastReconcileCleaned: reconcilerState.lastCleaned,
    autoRun: {
      status: autoRun.status,
      lastCheck: autoRun.lastCheck,
      checkCount: autoRun.checkCount,
      lastTriggered: autoRun.lastTriggered,
      lastError: autoRun.lastError,
    },
    lastExternalDrain: externalDrainState.lastRun,
    lastExternalDispatched: externalDrainState.lastDispatched,
    note: note || reconcilerState.note || externalDrainState.note,
  };
}

function persistStatus(note?: string) {
  writeBackgroundWorkerStatusFile(currentStatus(note));
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
  writeBackgroundWorkerPid(process.pid);
  persistStatus("worker booting");

  startScheduler();
  startAutoRunService();
  persistStatus("scheduler + auto-run started");

  await new Promise((resolve) => setTimeout(resolve, RECONCILE_STARTUP_DELAY_MS));
  await runReconciler("startup");
  await runExternalDrain("startup");

  reconcileInterval = setInterval(() => {
    void runReconciler("periodic");
  }, CHECK_INTERVAL_MS);

  externalDrainInterval = setInterval(() => {
    void runExternalDrain("periodic");
  }, EXTERNAL_DRAIN_INTERVAL_MS);

  heartbeatInterval = setInterval(() => {
    persistStatus();
  }, 5000);

  console.log("[worker] background worker started");
}

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;

  if (reconcileInterval) {
    clearInterval(reconcileInterval);
    reconcileInterval = null;
  }
  if (externalDrainInterval) {
    clearInterval(externalDrainInterval);
    externalDrainInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  const finalStatus = {
    ...currentStatus(`worker stopped (${signal})`),
    status: "stopped" as const,
    pid: undefined,
  };

  stopScheduler();
  stopAutoRunService();
  writeBackgroundWorkerStatusFile(finalStatus);
  clearBackgroundWorkerPid();

  setTimeout(() => process.exit(0), 0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaught exception:", err);
  persistStatus(err instanceof Error ? err.message : String(err));
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandled rejection:", err);
  persistStatus(err instanceof Error ? err.message : String(err));
});

void start().catch((err) => {
  console.error("[worker] failed to start:", err);
  persistStatus(err instanceof Error ? err.message : String(err));
  shutdown("startupFailure");
});
