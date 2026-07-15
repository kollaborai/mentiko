import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRunRecordFile } from "@/lib/runs/run-record";
import { createRunRecord, readRunJson } from "@/lib/runner-v2/run-state";
import { admitChain, canAdmitAgent, waitForAgentAdmission } from "@/lib/runner-v2/concurrency-admission";

const root = join("/tmp", `mentiko-concurrency-admission-${process.pid}`);
const runs = join(root, "runs");

function writeRun(id: string, status: "pending" | "running") {
  const run = createRunRecord({ runId: id, chainName: "chain", goal: "goal", now: new Date("2026-01-01T00:00:00.000Z") });
  run.status = status;
  createRunRecordFile(runs, run);
}

beforeEach(() => mkdirSync(runs, { recursive: true }));
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("typed concurrency admission", () => {
  it("serializes count-and-promote under the typed claim", () => {
    writeRun("run-holder", "running");
    writeRun("run-candidate", "pending");
    expect(admitChain({ runsDir: runs, runId: "run-candidate", cap: 1, queued: false })).toBe("queued");
    expect(readRunJson(join(runs, "run-candidate", "run.json"))).toMatchObject({ status: "pending", status_message: "queued: waiting for a chain slot (1 active, limit 1)" });
    expect(canAdmitAgent({ runsDir: runs, active: 0, cap: 1 })).toBe(true);
    expect(canAdmitAgent({ runsDir: runs, active: 1, cap: 1 })).toBe(false);
  });

  it("blocks admission if another run record is corrupt", () => {
    writeRun("run-candidate", "pending");
    mkdirSync(join(runs, "run-bad"), { recursive: true });
    writeFileSync(join(runs, "run-bad", "run.json"), "invalid");
    expect(admitChain({ runsDir: runs, runId: "run-candidate", cap: 1, queued: false })).toBe("invalid");
    expect(readRunJson(join(runs, "run-candidate", "run.json"))).toMatchObject({ status: "blocked" });
  });

  it("owns PTY observation filtering and bounded agent admission polling", () => {
    let clock = 0; const sleeps: number[] = [];
    expect(waitForAgentAdmission({ runsDir: runs, cap: 1, maxWaitSecs: 2, pollSecs: 1, pollMaxSecs: 1, ptyCmd: "ignored", now: () => clock, sleep: (ms) => { sleeps.push(ms); clock += ms; }, list: () => "mentiko-x pid=1 1x1 alive cmd\nmonitor-x pid=2 1x1 alive cmd\ndead pid=3 1x1 exited(1) cmd" })).toBe("admitted");
    expect(sleeps).toEqual([]);
    expect(waitForAgentAdmission({ runsDir: runs, cap: 1, maxWaitSecs: 1, pollSecs: 1, pollMaxSecs: 1, ptyCmd: "ignored", now: () => clock, sleep: (ms) => { clock += ms; }, list: () => "agent pid=1 1x1 alive cmd" })).toBe("timeout");
  });
});
