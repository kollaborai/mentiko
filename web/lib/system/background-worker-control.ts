import {
  BackgroundWorkerStatus,
  commitStoppedBackgroundWorkerState,
  isProcessAlive,
  readBackgroundWorkerOwner,
  readBackgroundWorkerStatusFile,
} from "./background-worker-state";
import { claimProcessMatchesIdentity } from "@/lib/runner-v2/file-claim";

export function stoppedBackgroundWorkerStatus(
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
    lastExternalDrain: statusFile?.lastExternalDrain,
    lastExternalDispatched: statusFile?.lastExternalDispatched,
    autoRun: statusFile?.autoRun
      ? { ...statusFile.autoRun, status: "stopped" }
      : undefined,
    chainWatcher: statusFile?.chainWatcher
      ? { ...statusFile.chainWatcher, status: "stopped" }
      : undefined,
    watchdog: statusFile?.watchdog
      ? { ...statusFile.watchdog, status: "stopped" }
      : undefined,
    note: note || statusFile?.note,
  };
}

function cleanupStaleState(
  owner: { pid: number; processIdentity?: string },
  statusFile: BackgroundWorkerStatus | null,
  note?: string,
): boolean {
  return commitStoppedBackgroundWorkerState(
    owner,
    stoppedBackgroundWorkerStatus(statusFile, note),
  );
}

export function getBackgroundWorkerStatus(): BackgroundWorkerStatus {
  const owner = readBackgroundWorkerOwner();
  const pid = owner?.pid;
  const statusFile = readBackgroundWorkerStatusFile();

  const ownerAlive = pid
    ? claimProcessMatchesIdentity(pid, owner?.processIdentity, isProcessAlive)
    : false;

  if (pid && ownerAlive) {
    const startedAt = statusFile?.startedAt;
    const uptime = startedAt
      ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      : undefined;

    return {
      ...statusFile,
      status: "running",
      pid,
      uptime,
    };
  }

  if (pid && !ownerAlive) {
    cleanupStaleState(owner, statusFile, "worker exited unexpectedly");
    return getBackgroundWorkerStatus();
  }

  return stoppedBackgroundWorkerStatus(statusFile);
}
