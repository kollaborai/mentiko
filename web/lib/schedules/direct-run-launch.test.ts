jest.mock("node:child_process", () => ({ spawn: jest.fn() }));

import { spawn } from "node:child_process";
import { launchDetachedDirectRun } from "@/lib/schedules/direct-run-launch";

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

describe("scheduled typed direct launch", () => {
  it("spawns the compiled direct owner with workspace argv and no shell", () => {
    const unref = jest.fn();
    mockSpawn.mockReturnValue({ unref } as never);
    const child = launchDetachedDirectRun({
      runtimePath: "/code/lib/runner-v2-direct-run.js",
      chainPath: "/data/chains/nightly/chain.json",
      workspacePath: "/work/project",
      env: { NODE_ENV: "test", MENTIKO_GLOBAL_ROOT: "/data" },
    });
    expect(spawn).toHaveBeenCalledWith(process.execPath, [
      "/code/lib/runner-v2-direct-run.js", "/data/chains/nightly/chain.json", "--workspace", "/work/project",
    ], expect.objectContaining({ detached: true, stdio: "ignore" }));
    expect(unref).toHaveBeenCalledTimes(1);
    expect(child).toBeDefined();
  });
});
