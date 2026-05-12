import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  collectFileTriggerEvents,
  matchesScheduleGlob,
  scanFileTriggerDirectory,
  type FileTriggerState,
} from "../schedule-file-triggers";
import type { Schedule } from "../types";

describe("schedule-file-triggers", () => {
  const schedule = {
    id: "incoming-csv",
    name: "Incoming CSV",
    chainId: "incoming-csv",
    chainName: "Incoming CSV",
    cron: "",
    timezone: "UTC",
    enabled: true,
    status: "enabled",
    retryCount: 0,
    runCount: 0,
    lastRun: null,
    nextRun: null,
    trigger: {
      type: "file",
      directory: "/drop/incoming",
      glob: "*.csv",
      events: ["created"],
      stableForMs: 5000,
    },
    target: {
      type: "raw_exec",
      executable: "python3",
      args: ["scripts/process.py", "{{file.path}}"],
    },
  } satisfies Schedule;

  it("matches basic file globs", () => {
    expect(matchesScheduleGlob("orders.csv", "*.csv")).toBe(true);
    expect(matchesScheduleGlob("orders.json", "*.csv")).toBe(false);
    expect(matchesScheduleGlob("daily/orders.csv", "**/*.csv")).toBe(true);
  });

  it("emits only stable, unprocessed file events", () => {
    const state: FileTriggerState = {};

    const first = collectFileTriggerEvents({
      schedule,
      files: [{ path: "/drop/incoming/orders.csv", mtimeMs: 1000, size: 42 }],
      state,
      nowMs: 2000,
    });
    expect(first.events).toEqual([]);

    const second = collectFileTriggerEvents({
      schedule,
      files: [{ path: "/drop/incoming/orders.csv", mtimeMs: 1000, size: 42 }],
      state: first.state,
      nowMs: 7000,
    });
    expect(second.events).toHaveLength(1);
    expect(second.events[0].payload.file?.name).toBe("orders.csv");

    const third = collectFileTriggerEvents({
      schedule,
      files: [{ path: "/drop/incoming/orders.csv", mtimeMs: 1000, size: 42 }],
      state: second.state,
      nowMs: 8000,
    });
    expect(third.events).toEqual([]);
  });

  it("caps recursive scans", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-file-trigger-"));
    try {
      const nested = join(root, "a", "b");
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, "one.csv"), "1");
      writeFileSync(join(nested, "two.csv"), "2");

      const files = scanFileTriggerDirectory(root, "**/*.csv", { maxDepth: 0, maxFiles: 10 });
      const paths = files.map((file) => file.path);
      expect(paths).toContain(join(root, "one.csv"));
      expect(paths).not.toContain(join(nested, "two.csv"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses protected root scans", () => {
    expect(scanFileTriggerDirectory("/", "**/*")).toEqual([]);
  });
});
