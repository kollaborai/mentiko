import { spawnSync } from "node:child_process";
import {
  processSessionIsQuiescent,
  waitForProcessSessionQuiescence,
} from "@/lib/runner-v2/process-session";

jest.mock("node:child_process", () => ({
  ...jest.requireActual("node:child_process"),
  spawnSync: jest.fn(),
}));

describe("runner-v2 process session liveness", () => {
  const mockedSpawnSync = spawnSync as jest.Mock;

  beforeEach(() => mockedSpawnSync.mockReset());

  it("keeps capacity held while any non-zombie process remains in the PTY session", () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "  4100 Ss\n  4100 Sl+\n  9999 Z\n",
      stderr: "",
    });

    expect(processSessionIsQuiescent(4100)).toBe(false);
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "ps",
      ["-eo", "sess=,stat="],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("treats zero-RSS zombie members as quiescent and fails closed on probe errors", () => {
    mockedSpawnSync.mockReturnValueOnce({ status: 0, stdout: "  4100 Z\n", stderr: "" });
    expect(processSessionIsQuiescent(4100)).toBe(true);

    mockedSpawnSync.mockReturnValueOnce({ status: 1, stdout: "", stderr: "ps failed" });
    expect(processSessionIsQuiescent(4100)).toBe(false);
    expect(processSessionIsQuiescent(0)).toBe(false);
  });

  it("waits through shutdown and times out without releasing early", () => {
    let clock = 0;
    const sleep = jest.fn((milliseconds: number) => { clock += milliseconds; });
    const shuttingDown = [false, false, true];
    expect(waitForProcessSessionQuiescence({
      sessionId: 4100,
      timeoutMs: 500,
      pollMs: 50,
      probe: () => shuttingDown.shift() ?? true,
      now: () => clock,
      sleep,
    })).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);

    clock = 0;
    expect(waitForProcessSessionQuiescence({
      sessionId: 4100,
      timeoutMs: 100,
      pollMs: 50,
      probe: () => false,
      now: () => clock,
      sleep: (milliseconds) => { clock += milliseconds; },
    })).toBe(false);
    expect(clock).toBe(100);
  });
});
