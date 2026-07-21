import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRunRecordFile } from "@/lib/runs/run-record";
import { createRunRecord, readRunJson } from "@/lib/runner-v2/run-state";
import {
  admitChain,
  blockAgentForInvalidAdmission,
  canAdmitAgent,
  CONCURRENCY_CAP_BLOCKED_REASON_PREFIX,
  INVALID_AGENT_ADMISSION_REASON,
  isConcurrencyCapBlockedReason,
  waitForAgentAdmission,
  waitForChainAdmission,
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

describe("isConcurrencyCapBlockedReason", () => {
  it("matches the exact producer message from both admission paths", () => {
    // bootstrap-executor.ts's typed-plan timeout message.
    expect(isConcurrencyCapBlockedReason("concurrency cap: waited 301s for a chain slot (limit 4); blocked")).toBe(true);
    // This module's own wait-chain timeout message (shell launch path).
    expect(isConcurrencyCapBlockedReason(`${CONCURRENCY_CAP_BLOCKED_REASON_PREFIX}45s for a chain slot (limit 1); blocked`)).toBe(true);
    // Verbatim legacy tombstone text observed on disk (2026-07-20 incident) --
    // the discriminator must keep matching this even though it predates the
    // shared-constant refactor, because it reads durable status_message text,
    // not a structured field that only exists going forward.
    expect(isConcurrencyCapBlockedReason("concurrency cap: waited 301s for a chain slot (limit 4); blocked")).toBe(true);
  });

  it("does not match a genuine human_action_required block", () => {
    expect(isConcurrencyCapBlockedReason(INVALID_AGENT_ADMISSION_REASON)).toBe(false);
    expect(isConcurrencyCapBlockedReason("startup_recovery:blocked: CLI requires human authentication")).toBe(false);
    expect(isConcurrencyCapBlockedReason("runner-v2 blocked this run without a recorded reason")).toBe(false);
  });

  it("handles missing/empty reasons", () => {
    expect(isConcurrencyCapBlockedReason(undefined)).toBe(false);
    expect(isConcurrencyCapBlockedReason(null)).toBe(false);
    expect(isConcurrencyCapBlockedReason("")).toBe(false);
  });
});

describe("waitForChainAdmission FIFO fairness (FIX 5)", () => {
  function freeHolderSlot(): void {
    const holderPath = join(runs, "run-holder", "run.json");
    const holder = JSON.parse(readFileSync(holderPath, "utf8"));
    holder.status = "completed";
    holder.completed = "2026-01-01T00:05:00.000Z";
    writeFileSync(holderPath, JSON.stringify(holder, null, 2));
  }

  it("does not let a later waiter jump an earlier waiter's queue position when a slot frees", () => {
    writeRun("run-holder", "running");
    writeRun("run-old", "pending");
    writeRun("run-new", "pending");

    let sawNewJumpTheQueue = false;
    const result = waitForChainAdmission({
      runsDir: runs,
      runId: "run-old",
      cap: 1,
      maxWaitSecs: 10,
      pollSecs: 1,
      pollMaxSecs: 1,
      now: () => 0,
      sleep: () => {
        // Fires once run-old has registered its ticket and observed the cap
        // full. Simulate a second, later-arriving process: free the only
        // slot, then have run-new poll for it with a single attempt
        // (maxWaitSecs: 0). run-new's ticket is strictly younger than
        // run-old's (both registered at the same injected "now", tie-broken
        // by runId -- "run-new" > "run-old" lexicographically), so it must
        // stay queued even though the slot is free.
        freeHolderSlot();
        const newResult = waitForChainAdmission({
          runsDir: runs,
          runId: "run-new",
          cap: 1,
          maxWaitSecs: 0,
          pollSecs: 1,
          pollMaxSecs: 1,
          // Strictly later than run-old's clock (both fixed, injected) so the
          // ordering comes from real arrival time, not tie-break luck.
          now: () => 1_000,
        });
        if (newResult === "admitted") sawNewJumpTheQueue = true;
      },
    });

    expect(sawNewJumpTheQueue).toBe(false);
    // run-old's own next poll (after the nested run-new attempt returns and
    // releases run-new's ticket) finds the slot free and is the oldest live
    // ticket, so it gets admitted.
    expect(result).toBe("admitted");
    expect(readRunJson(join(runs, "run-old", "run.json"))).toMatchObject({ status: "running" });
  });

  it("prunes a stale ticket left by a crashed waiter instead of wedging the queue", () => {
    // No holder: the slot is free from the start. A ticket predating this
    // waiter's clock by more than the stale TTL simulates a waiter process
    // that registered, then crashed before ever renewing or cleaning up.
    mkdirSync(join(runs, ".cap.tickets"), { recursive: true });
    writeFileSync(
      join(runs, ".cap.tickets", "run-ghost.json"),
      JSON.stringify({ runId: "run-ghost", startedAt: -1_000_000, renewedAt: -1_000_000 }),
    );
    writeRun("run-live", "pending");

    const result = waitForChainAdmission({
      runsDir: runs,
      runId: "run-live",
      cap: 1,
      maxWaitSecs: 5,
      pollSecs: 1,
      pollMaxSecs: 1,
      now: () => 0,
    });

    expect(result).toBe("admitted");
    expect(existsSync(join(runs, ".cap.tickets", "run-ghost.json"))).toBe(false);
  });
});
