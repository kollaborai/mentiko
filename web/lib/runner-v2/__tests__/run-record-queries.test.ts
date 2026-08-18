/** @jest-environment node */

import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunRecordFile } from "@/lib/runs/run-record";
import { countRunningRuns, deleteRunsOlderThan } from "@/lib/runner-v2/run-record-queries";

describe("typed Run Record selections", () => {
  it("counts canonical running records and honors the acquiring-run exclusion", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-count-"));
    createRunRecordFile(runsDir, {
      id: "run-1", chain: "one", goal: "one", started: "2026-07-15T00:00:00Z", status: "running", agents: [],
    });
    createRunRecordFile(runsDir, {
      id: "run-2", chain: "two", goal: "two", started: "2026-07-15T00:00:00Z", status: "pending", agents: [],
    });
    expect(countRunningRuns(runsDir)).toBe(1);
    expect(countRunningRuns(runsDir, "run-1")).toBe(0);
  });

  it("fails closed on a corrupt present run record instead of freeing a slot", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-count-corrupt-"));
    mkdirSync(join(runsDir, "run-bad"));
    writeFileSync(join(runsDir, "run-bad", "run.json"), "{not-json\n");
    expect(() => countRunningRuns(runsDir)).toThrow("Invalid raw run record");
  });

  it("deletes only validated canonical records beyond the retention cutoff", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-retention-"));
    const old = createRunRecordFile(runsDir, {
      id: "run-old", chain: "old", goal: "old", started: "2026-07-01T00:00:00Z", status: "completed", agents: [],
    });
    const recent = createRunRecordFile(runsDir, {
      id: "run-recent", chain: "recent", goal: "recent", started: "2026-07-14T00:00:00Z", status: "completed", agents: [],
    });
    utimesSync(old.runDir, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));
    utimesSync(recent.runDir, new Date("2026-07-14T00:00:00Z"), new Date("2026-07-14T00:00:00Z"));

    expect(deleteRunsOlderThan(runsDir, 7, new Date("2026-07-15T00:00:00Z"))).toEqual([old.runDir]);
    expect(existsSync(old.runDir)).toBe(false);
    expect(existsSync(recent.runDir)).toBe(true);
  });

  it("fails closed before deleting a corrupt retention candidate", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "mentiko-run-retention-corrupt-"));
    const runDir = join(runsDir, "run-corrupt");
    mkdirSync(runDir);
    writeFileSync(join(runDir, "run.json"), "{not-json\n");
    utimesSync(runDir, new Date("2026-07-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));
    expect(() => deleteRunsOlderThan(runsDir, 7, new Date("2026-07-15T00:00:00Z")))
      .toThrow("Invalid raw run record");
    expect(existsSync(runDir)).toBe(true);
  });
});
