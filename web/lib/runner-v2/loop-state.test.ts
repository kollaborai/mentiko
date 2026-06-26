import { existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loopStatePath, readLoopState, recordLoopVisit, writeLoopState } from "@/lib/runner-v2/loop-state";

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
    expect(readLoopState(dir)).toEqual({
      visited: ["writer:draft-ready"],
      round: 2,
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
  });
});
