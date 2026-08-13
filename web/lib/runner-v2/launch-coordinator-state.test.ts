/** @jest-environment node */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pendingHandoffs } from "@/lib/runner-v2/handoff-liveness";
import {
  clearLaunchCoordinator,
  heartbeatLaunchCoordinator,
  registerLaunchCoordinator,
} from "@/lib/runner-v2/launch-coordinator-state";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

function fixture(): string {
  const runJsonPath = join(mkdtempSync(join(tmpdir(), "launch-coordinator-state-")), "run.json");
  updateRunJson(runJsonPath, () => createRunRecord({
    runId: "run-coordinator",
    chainName: "coordinator",
    goal: "queue agents",
  }));
  return runJsonPath;
}

describe("launch coordinator liveness state", () => {
  it("registers one deduplicated handoff, heartbeats it, and clears it", () => {
    const runJsonPath = fixture();
    registerLaunchCoordinator({
      runJsonPath,
      pid: 4321,
      agentIds: ["editor", "designer", "editor"],
      now: new Date("2026-08-09T20:00:00.000Z"),
    });
    expect(pendingHandoffs(readRunJson(runJsonPath))).toEqual([{
      pid: 4321,
      targetAgentIds: ["designer", "editor"],
      startedAt: "2026-08-09T20:00:00.000Z",
      heartbeatAt: "2026-08-09T20:00:00.000Z",
    }]);

    expect(heartbeatLaunchCoordinator({
      runJsonPath,
      pid: 4321,
      now: new Date("2026-08-09T20:01:00.000Z"),
    })).toBe(true);
    expect(pendingHandoffs(readRunJson(runJsonPath))[0].heartbeatAt)
      .toBe("2026-08-09T20:01:00.000Z");

    clearLaunchCoordinator({ runJsonPath, pid: 4321 });
    expect(pendingHandoffs(readRunJson(runJsonPath))).toEqual([]);
  });
});
