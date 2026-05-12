#!/usr/bin/env node

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const {
  clearBackgroundWorkerPid,
  writeBackgroundWorkerPid,
  writeBackgroundWorkerStatusFile,
} = require("../lib/background-worker-state");
const { reconcileOrphanedRuns } = require("../lib/run-reconciler");
const {
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
} = require("../lib/scheduler-service");
const {
  getAutoRunServiceStatus,
  startAutoRunService,
  stopAutoRunService,
} = require("../lib/auto-run-service");

const CHECK_INTERVAL_MS = 60_000;
const RECONCILE_STARTUP_DELAY_MS = 3000;

let reconcileInterval = null;
let heartbeatInterval = null;
let stopping = false;

const startedAt = new Date().toISOString();
const reconcilerState = {
  lastRun: undefined,
  lastCleaned: undefined,
  note: undefined,
};

function currentStatus(note) {
  const scheduler = getSchedulerStatus();
  const autoRun = getAutoRunServiceStatus();
  const uptime = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);

  return {
    status: stopping ? "stopped" : "running",
    pid: process.pid,
    startedAt,
    uptime,
    lastCheck: scheduler.lastCheck,
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
    note: note || reconcilerState.note,
  };
}

function persistStatus(note) {
  writeBackgroundWorkerStatusFile(currentStatus(note));
}

async function runReconciler(label) {
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

async function start() {
  writeBackgroundWorkerPid(process.pid);
  persistStatus("worker booting");

  startScheduler();
  startAutoRunService();
  persistStatus("scheduler + auto-run started");

  await new Promise((resolve) => setTimeout(resolve, RECONCILE_STARTUP_DELAY_MS));
  await runReconciler("startup");

  reconcileInterval = setInterval(() => {
    void runReconciler("periodic");
  }, CHECK_INTERVAL_MS);

  heartbeatInterval = setInterval(() => {
    persistStatus();
  }, 5000);

  console.log("[worker] background worker started");
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;

  if (reconcileInterval) {
    clearInterval(reconcileInterval);
    reconcileInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  const finalStatus = {
    ...currentStatus(`worker stopped (${signal})`),
    status: "stopped",
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
