import {
  BackgroundWorkerStatus,
  clearBackgroundWorkerPid,
  isProcessAlive,
  readBackgroundWorkerPid,
  readBackgroundWorkerStatusFile,
  writeBackgroundWorkerStatusFile,
} from "./background-worker-state";

const STOP_TIMEOUT_MS = 5000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stoppedStatus(
  statusFile: BackgroundWorkerStatus | null,
  note?: string
): BackgroundWorkerStatus {
  return {
    status: "stopped",
    startedAt: statusFile?.startedAt,
    lastCheck: statusFile?.lastCheck,
    checkCount: statusFile?.checkCount,
    lastReconcile: statusFile?.lastReconcile,
    lastReconcileCleaned: statusFile?.lastReconcileCleaned,
    note: note || statusFile?.note,
  };
}

function cleanupStaleState(note?: string) {
  const statusFile = readBackgroundWorkerStatusFile();
  clearBackgroundWorkerPid();
  writeBackgroundWorkerStatusFile(stoppedStatus(statusFile, note));
}

export function getBackgroundWorkerStatus(): BackgroundWorkerStatus {
  const pid = readBackgroundWorkerPid();
  const statusFile = readBackgroundWorkerStatusFile();

  if (pid && isProcessAlive(pid)) {
    const startedAt = statusFile?.startedAt;
    const uptime = startedAt
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : undefined;

    return {
      status: "running",
      ...statusFile,
      pid,
      uptime,
    };
  }

  if (pid && !isProcessAlive(pid)) {
    cleanupStaleState("worker exited unexpectedly");
    return getBackgroundWorkerStatus();
  }

  return stoppedStatus(statusFile);
}

/**
 * Returns current worker status. The worker is managed by process-manager
 * (processes.dev.json / processes.json) -- not spawned from here.
 */
export function checkBackgroundWorker(): BackgroundWorkerStatus {
  return getBackgroundWorkerStatus();
}

export async function stopBackgroundWorker(): Promise<BackgroundWorkerStatus> {
  const pid = readBackgroundWorkerPid();
  if (!pid) {
    cleanupStaleState("worker not running");
    return getBackgroundWorkerStatus();
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    cleanupStaleState("worker not running");
    return getBackgroundWorkerStatus();
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < STOP_TIMEOUT_MS) {
    await sleep(250);
    if (!isProcessAlive(pid)) {
      cleanupStaleState("worker stopped");
      return getBackgroundWorkerStatus();
    }
  }

  throw new Error("background worker did not stop cleanly");
}
