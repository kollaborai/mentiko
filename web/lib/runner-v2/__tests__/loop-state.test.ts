import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loopStatePath, readLoopState, recordLoopVisit, restoreLoopMutations, shellLoopStatePath, writeLoopState, type LoopFileMutation } from "@/lib/runner-v2/loop-state";

function runDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-loop-state-"));
}

describe("runner-v2 loop state", () => {
  it("defaults to empty visits and round one", () => {
    expect(readLoopState(runDir())).toEqual({ visited: [], round: 1 });
  });

  it("writes and reads loop state atomically", () => {
    const dir = runDir();
    writeLoopState(dir, { visited: ["writer:draft-ready"], round: 2 });

    expect(existsSync(loopStatePath(dir))).toBe(true);
    expect(readFileSync(shellLoopStatePath(dir), "utf8")).toBe("writer:draft-ready\n");
    expect(readLoopState(dir)).toEqual({
      visited: ["writer:draft-ready"],
      round: 2,
    });
  });

  it("reads shell loop tracker visits as typed loop state", () => {
    const dir = runDir();
    writeFileSync(shellLoopStatePath(dir), "\nwriter:draft-ready\ninvalid\nreviewer:approved\n");

    expect(readLoopState(dir)).toEqual({
      visited: ["writer:draft-ready", "reviewer:approved"],
      round: 1,
    });
  });

  it("records visit keys without duplicating them", () => {
    const dir = runDir();

    recordLoopVisit(dir, "writer:revise", 2);
    recordLoopVisit(dir, "writer:revise", 3);

    expect(readLoopState(dir)).toEqual({
      visited: ["writer:revise"],
      round: 3,
    });
    expect(readFileSync(shellLoopStatePath(dir), "utf8")).toBe("writer:revise\n");
  });

  it("fences rollback so a writer starting at the destructive boundary wins after restore", async () => {
    const dir = runDir();
    const mutations: LoopFileMutation[] = [];
    writeLoopState(dir, { visited: ["completion:owned"], round: 2 }, (mutation) => mutations.push(mutation));

    const started = join(dir, "concurrent-writer-started");
    const jsonPath = loopStatePath(dir);
    const shellPath = shellLoopStatePath(dir);
    let child: ChildProcess | undefined;
    restoreLoopMutations(mutations, () => {
      if (child) return;
      const script = `
        const fs = require("fs");
        const jsonPath = ${JSON.stringify(jsonPath)};
        const shellPath = ${JSON.stringify(shellPath)};
        const started = ${JSON.stringify(started)};
        const lock = jsonPath + ".lock";
        fs.writeFileSync(started, "started");
        const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
        const deadline = Date.now() + 3000;
        let owner;
        while (!owner && Date.now() < deadline) {
          try {
            fs.mkdirSync(lock);
            owner = "child-" + process.pid;
            fs.writeFileSync(lock + "/owner", owner, { flag: "wx" });
            fs.writeFileSync(lock + "/pid", String(process.pid), { flag: "wx" });
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            sleep(10);
          }
        }
        if (!owner) process.exit(7);
        const jsonTmp = jsonPath + ".child." + process.pid;
        const shellTmp = shellPath + ".child." + process.pid;
        fs.writeFileSync(jsonTmp, JSON.stringify({ visited: ["concurrent:visit"], round: 7 }, null, 2));
        fs.renameSync(jsonTmp, jsonPath);
        fs.writeFileSync(shellTmp, "concurrent:visit\\n");
        fs.renameSync(shellTmp, shellPath);
        fs.unlinkSync(lock + "/pid");
        fs.unlinkSync(lock + "/owner");
        fs.rmdirSync(lock);
      `;
      child = spawn(process.execPath, ["-e", script], { stdio: "pipe" });
      const deadline = Date.now() + 2000;
      while (!existsSync(started) && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      expect(existsSync(started)).toBe(true);
    });

    expect(child).toBeDefined();
    const exitCode = await new Promise<number | null>((resolve) => child!.once("close", resolve));
    expect(exitCode).toBe(0);
    expect(readLoopState(dir)).toEqual({ visited: ["concurrent:visit"], round: 7 });
  });
});
