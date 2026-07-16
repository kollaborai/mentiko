import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRunRecordFile } from "@/lib/runs/run-record";
import { createRunRecord, readRunJson } from "@/lib/runner-v2/run-state";
import {
  admitChain,
  blockAgentForInvalidAdmission,
  canAdmitAgent,
  INVALID_AGENT_ADMISSION_REASON,
  waitForAgentAdmission,
} from "@/lib/runner-v2/concurrency-admission";

const root = join("/tmp", `mentiko-concurrency-admission-${process.pid}`);
const runs = join(root, "runs");

function writeRun(id: string, status: "pending" | "running") {
  const run = createRunRecord({ runId: id, chainName: "chain", goal: "goal", now: new Date("2026-01-01T00:00:00.000Z") });
  run.status = status;
  createRunRecordFile(runs, run);
}

function writeRunningAgentRun(id: string, session: string) {
  const run = createRunRecord({ runId: id, chainName: "chain", goal: "goal", now: new Date("2026-01-01T00:00:00.000Z") });
  run.status = "running";
  run.agents = [{ id: "agent", name: "Agent", status: "running", session }];
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

  it("owns the typed mutation for an invalid agent admission", () => {
    writeRunningAgentRun("run-candidate", "agent-owned");
    blockAgentForInvalidAdmission({
      runsDir: runs,
      runId: "run-candidate",
      agentId: "agent",
    });
    expect(readRunJson(join(runs, "run-candidate", "run.json"))).toMatchObject({
      status: "blocked",
      status_message: INVALID_AGENT_ADMISSION_REASON,
      blockedReason: INVALID_AGENT_ADMISSION_REASON,
      agents: [{ id: "agent", status: "blocked" }],
    });
  });

  it("times out instead of admitting when an active-agent sibling is corrupt", () => {
    let clock = 0;
    mkdirSync(join(runs, "run-corrupt"), { recursive: true });
    writeFileSync(join(runs, "run-corrupt", "run.json"), "{not-json\n");

    expect(waitForAgentAdmission({
      runsDir: runs,
      cap: 1,
      maxWaitSecs: 1,
      pollSecs: 1,
      pollMaxSecs: 1,
      ptyCmd: "ignored",
      now: () => clock,
      sleep: (ms) => { clock += ms; },
      list: () => "",
    })).toBe("invalid");
  });

  it("admits immediately with a disabled cap without scanning corrupt records or PTYs", () => {
    expect(waitForAgentAdmission({
      runsDir: join(root, "missing-runs"),
      cap: 0,
      maxWaitSecs: 1,
      pollSecs: 1,
      pollMaxSecs: 1,
      ptyCmd: "invalid-command",
      list: () => { throw new Error("PTY scan must not run when cap is disabled"); },
    })).toBe("admitted");
  });

  it("owns PTY observation filtering and bounded agent admission polling", () => {
    let clock = 0; const sleeps: number[] = [];
    expect(waitForAgentAdmission({ runsDir: runs, cap: 1, maxWaitSecs: 2, pollSecs: 1, pollMaxSecs: 1, ptyCmd: "ignored", now: () => clock, sleep: (ms) => { sleeps.push(ms); clock += ms; }, list: () => "mentiko-x pid=1 1x1 alive cmd\nmonitor-x pid=2 1x1 alive cmd\ndead pid=3 1x1 exited(1) cmd" })).toBe("admitted");
    expect(sleeps).toEqual([]);
    writeRunningAgentRun("run-worker", "agent-owned");
    expect(waitForAgentAdmission({ runsDir: runs, cap: 1, maxWaitSecs: 1, pollSecs: 1, pollMaxSecs: 1, ptyCmd: "ignored", now: () => clock, sleep: (ms) => { clock += ms; }, list: () => "agent-owned pid=1 1x1 alive cmd" })).toBe("timeout");
  });

  it("does not charge unrelated interactive PTYs against the agent cap", () => {
    writeRunningAgentRun("run-worker", "agent-owned");
    expect(waitForAgentAdmission({
      runsDir: runs, cap: 2, maxWaitSecs: 1, pollSecs: 1, pollMaxSecs: 1, ptyCmd: "ignored",
      list: () => "term-user pid=1 1x1 alive zsh\nagent-owned pid=2 1x1 alive claude\nmonitor-agent-owned pid=3 1x1 alive node",
    })).toBe("admitted");
  });

  it("charges a terminal run's persisted identity when the PTY is still alive", () => {
    const run = createRunRecord({ runId: "run-leaked", chainName: "chain", goal: "goal", now: new Date("2026-01-01T00:00:00.000Z") });
    run.status = "completed";
    run.agents = [{ id: "agent", name: "Agent", status: "complete", session: "leaked-agent" }];
    createRunRecordFile(runs, run);

    expect(waitForAgentAdmission({
      runsDir: runs,
      cap: 1,
      maxWaitSecs: 1,
      pollSecs: 1,
      pollMaxSecs: 1,
      ptyCmd: "ignored",
      list: () => "leaked-agent pid=1 1x1 alive claude",
    })).toBe("timeout");
  });

  it("charges a pending run's persisted agent identity when the PTY is still alive", () => {
    const run = createRunRecord({ runId: "run-pending-leaked", chainName: "chain", goal: "goal", now: new Date("2026-01-01T00:00:00.000Z") });
    run.status = "pending";
    run.agents = [{ id: "agent", name: "Agent", status: "pending", session: "pending-leaked-agent" }];
    createRunRecordFile(runs, run);

    expect(waitForAgentAdmission({
      runsDir: runs,
      cap: 1,
      maxWaitSecs: 1,
      pollSecs: 1,
      pollMaxSecs: 1,
      ptyCmd: "ignored",
      list: () => "pending-leaked-agent pid=1 1x1 alive claude",
    })).toBe("timeout");
  });
});
