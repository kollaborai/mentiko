import { mkdtempSync } from "fs";
import { spawn, type ChildProcess } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { stoppedBackgroundWorkerStatus } from "./background-worker-control";
import {
  captureBackgroundWorkerOwner,
  commitStoppedBackgroundWorkerState,
  isProcessAlive,
  readBackgroundWorkerOwner,
  readBackgroundWorkerStatusFile,
  registerBackgroundWorker,
  writeBackgroundWorkerStatusFile,
  type BackgroundWorkerStatePaths,
} from "./background-worker-state";

const childFixture = join(
  __dirname,
  "test-support",
  "background-worker-state-child.fixture.ts",
);
const jestBin = join(process.cwd(), "node_modules", "jest", "bin", "jest.js");

function statePaths(root: string): BackgroundWorkerStatePaths {
  return {
    pidFile: join(root, "background-worker.pid"),
    ownerFile: join(root, "background-worker.owner.json"),
    statusFile: join(root, "background-worker.json"),
    lockDir: join(root, ".background-worker-state.claim"),
  };
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

function waitForChildReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    child.once("error", reject);
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes("STATE_CHILD_READY")) resolve();
    });
  });
}

describe("background worker stopped status", () => {
  it("treats EPERM as a live worker PID", () => {
    const kill = jest.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("not permitted"), { code: "EPERM" });
    });
    try {
      expect(isProcessAlive(424242)).toBe(true);
    } finally {
      kill.mockRestore();
    }
  });

  it("keeps a successor tracked and running when it registers during stale cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "background-worker-state-race-"));
    const paths = statePaths(root);
    const ownerA = registerBackgroundWorker({ pid: 101, processIdentity: "start-a" }, paths);
    writeBackgroundWorkerStatusFile(ownerA, {
      status: "running",
      pid: 101,
      startedAt: "2026-07-15T12:00:00.000Z",
    }, paths);
    const child = spawn(process.execPath, [
      jestBin,
      "--runInBand",
      "--testMatch",
      "**/background-worker-state-child.fixture.ts",
      "--runTestsByPath",
      childFixture,
    ], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "ignore"],
      env: {
        ...process.env,
        BACKGROUND_WORKER_STATE_ROOT: root,
      },
    });
    const childExit = waitForExit(child);
    await waitForChildReady(child);

    const cleaned = commitStoppedBackgroundWorkerState(
      ownerA,
      { status: "stopped", note: "stale A" },
      paths,
      () => {
        child.stdin?.end("go\n");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      },
    );

    expect(cleaned).toBe(true);
    expect(await childExit).toBe(0);
    expect(readBackgroundWorkerOwner(paths)).toEqual({
      pid: 202,
      processIdentity: "start-b",
    });
    expect(readBackgroundWorkerStatusFile(paths)).toMatchObject({
      status: "running",
      pid: 202,
      note: "successor running",
    });
  }, 10_000);

  it("rejects a late status write from A after successor B owns the state", () => {
    const root = mkdtempSync(join(tmpdir(), "background-worker-late-status-"));
    const paths = statePaths(root);
    const ownerA = registerBackgroundWorker({ pid: 101, processIdentity: "start-a" }, paths);
    expect(writeBackgroundWorkerStatusFile(ownerA, {
      status: "running",
      pid: 101,
      note: "A running",
    }, paths)).toBe(true);
    const ownerB = registerBackgroundWorker({ pid: 202, processIdentity: "start-b" }, paths);
    expect(writeBackgroundWorkerStatusFile(ownerB, {
      status: "running",
      pid: 202,
      note: "B running",
    }, paths)).toBe(true);

    expect(writeBackgroundWorkerStatusFile(ownerA, {
      status: "stopped",
      pid: 101,
      note: "late A watchdog completion",
    }, paths)).toBe(false);
    expect(readBackgroundWorkerOwner(paths)).toEqual(ownerB);
    expect(readBackgroundWorkerStatusFile(paths)).toMatchObject({
      status: "running",
      pid: 202,
      note: "B running",
    });
  });

  it("returns false when stopped cleanup does not match the registered owner", () => {
    const root = mkdtempSync(join(tmpdir(), "background-worker-owner-mismatch-"));
    const paths = statePaths(root);
    const ownerB = registerBackgroundWorker({ pid: 202, processIdentity: "start-b" }, paths);
    writeBackgroundWorkerStatusFile(ownerB, { status: "running", pid: 202 }, paths);

    expect(commitStoppedBackgroundWorkerState(
      { pid: 101, processIdentity: "start-a" },
      { status: "stopped", pid: 101 },
      paths,
    )).toBe(false);
    expect(readBackgroundWorkerOwner(paths)).toEqual(ownerB);
    expect(readBackgroundWorkerStatusFile(paths)).toMatchObject({ status: "running", pid: 202 });
  });

  it("uses one captured identity for registration, status, and shutdown", () => {
    const root = mkdtempSync(join(tmpdir(), "background-worker-captured-owner-"));
    const paths = statePaths(root);
    const identity = jest.fn()
      .mockReturnValueOnce("start-captured")
      .mockReturnValue("start-inconsistent");
    const owner = captureBackgroundWorkerOwner(303, identity);

    expect(registerBackgroundWorker(owner, paths)).toEqual(owner);
    expect(writeBackgroundWorkerStatusFile(owner, {
      status: "running",
      pid: 303,
    }, paths)).toBe(true);
    expect(commitStoppedBackgroundWorkerState(owner, {
      status: "stopped",
      pid: undefined,
    }, paths)).toBe(true);

    expect(identity).toHaveBeenCalledTimes(1);
    expect(readBackgroundWorkerOwner(paths)).toBeUndefined();
    expect(readBackgroundWorkerStatusFile(paths)).toMatchObject({ status: "stopped" });
  });

  it("forces nested services stopped while retaining their last metrics", () => {
    const status = stoppedBackgroundWorkerStatus({
      status: "running",
      pid: 4321,
      startedAt: "2026-07-15T12:00:00.000Z",
      autoRun: {
        status: "running",
        checkCount: 7,
        lastTriggered: 2,
      },
      decisionReconciler: {
        status: "running",
        checkCount: 5,
        examined: 12,
        deadPointers: 2,
        recoveriesScheduled: 1,
        exhausted: 1,
      },
      chainWatcher: {
        status: "running",
        checkCount: 9,
        lastCheck: "2026-07-15T12:01:00.000Z",
        lastError: "last watcher warning",
      },
      watchdog: {
        status: "running",
        checkCount: 11,
        lastStalled: 1,
        transportAvailable: true,
      },
    }, "worker exited unexpectedly");

    expect(status).toMatchObject({
      status: "stopped",
      note: "worker exited unexpectedly",
      autoRun: { status: "stopped", checkCount: 7, lastTriggered: 2 },
      decisionReconciler: {
        status: "stopped",
        checkCount: 5,
        examined: 12,
        deadPointers: 2,
        recoveriesScheduled: 1,
        exhausted: 1,
      },
      chainWatcher: {
        status: "stopped",
        checkCount: 9,
        lastCheck: "2026-07-15T12:01:00.000Z",
        lastError: "last watcher warning",
      },
      watchdog: {
        status: "stopped",
        checkCount: 11,
        lastStalled: 1,
        transportAvailable: true,
      },
    });
  });
});
