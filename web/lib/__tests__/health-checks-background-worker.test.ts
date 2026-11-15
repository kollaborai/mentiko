// issue #136: /api/health must show when the background worker is down.
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { checkBackgroundWorker } from "../system/health-checks";
import type { BackgroundWorkerStatePaths } from "../system/background-worker-state";

jest.setTimeout(30_000);

function tmpPaths(): BackgroundWorkerStatePaths {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-health-"));
  return {
    pidFile: path.join(dir, "background-worker.pid"),
    ownerFile: path.join(dir, "background-worker.owner.json"),
    statusFile: path.join(dir, "background-worker.json"),
    lockDir: path.join(dir, ".background-worker-state.claim"),
  };
}

function writeOwner(paths: BackgroundWorkerStatePaths, pid: number) {
  fs.writeFileSync(paths.ownerFile, JSON.stringify({ pid }));
}

function writeStatus(paths: BackgroundWorkerStatePaths, status: "running" | "stopped") {
  fs.writeFileSync(paths.statusFile, JSON.stringify({ status, pid: process.pid }));
}

describe("checkBackgroundWorker (issue #136)", () => {
  const dirs: string[] = [];

  function freshPaths(): BackgroundWorkerStatePaths {
    const paths = tmpPaths();
    dirs.push(path.dirname(paths.ownerFile));
    return paths;
  }

  afterAll(() => {
    for (const dir of dirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });

  it("reports fail when the registered worker pid is not running", async () => {
    const paths = freshPaths();
    // spawn a real child that exits immediately — a pid that is definitively dead
    const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
    expect(dead.status).toBe(0);
    // the child is gone; claim a pid that cannot be alive by spawning nothing further:
    // use the just-exited child's pid via spawnSync's returned pid
    const deadPid = dead.pid!;
    writeOwner(paths, deadPid);
    writeStatus(paths, "running");

    const result = await checkBackgroundWorker(paths);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("not running");
  });

  it("reports pass when the worker pid is alive and its heartbeat is fresh", async () => {
    const paths = freshPaths();
    writeOwner(paths, process.pid); // the jest process itself is alive
    writeStatus(paths, "running");

    const result = await checkBackgroundWorker(paths);
    expect(result.status).toBe("pass");
    expect(result.message).toContain(String(process.pid));
  });

  it("reports warn when the heartbeat file is stale", async () => {
    const paths = freshPaths();
    writeOwner(paths, process.pid);
    writeStatus(paths, "running");
    const stale = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(paths.statusFile, stale, stale);

    const result = await checkBackgroundWorker(paths);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("stale");
  });

  it("reports warn, not silence, when no worker is registered", async () => {
    const paths = freshPaths();
    writeStatus(paths, "stopped");

    const result = await checkBackgroundWorker(paths);
    expect(result.status).toBe("warn");
    expect(result.message).toContain("background worker");
  });
});
