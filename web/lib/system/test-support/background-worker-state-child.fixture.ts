import { join } from "path";
import {
  registerBackgroundWorker,
  writeBackgroundWorkerStatusFile,
  type BackgroundWorkerStatePaths,
} from "../background-worker-state";

const root = process.env.BACKGROUND_WORKER_STATE_ROOT || "";

const paths: BackgroundWorkerStatePaths = {
  pidFile: join(root, "background-worker.pid"),
  ownerFile: join(root, "background-worker.owner.json"),
  statusFile: join(root, "background-worker.json"),
  lockDir: join(root, ".background-worker-state.claim"),
};

describe("background worker state child fixture", () => {
  it("registers the successor after the adversarial gate opens", async () => {
    process.stdout.write("STATE_CHILD_READY\n");
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => {
        process.stdin.destroy();
        resolve();
      });
    });
    const owner = registerBackgroundWorker({ pid: 202, processIdentity: "start-b" }, paths);
    writeBackgroundWorkerStatusFile(owner, {
      status: "running",
      pid: 202,
      startedAt: "2026-07-15T12:01:00.000Z",
      note: "successor running",
    }, paths);
  }, 30_000);
});
