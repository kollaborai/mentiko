import { classifyMonitorTick, resolveMonitorConfig } from "@/lib/runner-v2/monitor-reducer";
import { MONITOR_NUDGES, type MonitorObservation, type MonitorState } from "@/lib/runner-v2/monitor-types";

function obs(overrides: Partial<MonitorObservation> = {}): MonitorObservation {
  return {
    sessionAlive: true,
    processGone: false,
    captureHash: "hash-A",
    completionEventPresent: false,
    latched: false,
    ...overrides,
  };
}

function state(overrides: Partial<MonitorState> = {}): MonitorState {
  return { prevHash: "hash-A", staleCount: 0, nudgeCount: 0, nudgeEchoGrace: 0, ...overrides };
}

describe("classifyMonitorTick — chain monitor parity", () => {
  it("stops when the session is gone", () => {
    const r = classifyMonitorTick(state(), obs({ sessionAlive: false }), resolveMonitorConfig());
    expect(r.action.type).toBe("session-gone");
  });

  it("declares death only for a local workspace whose process is gone", () => {
    const local = classifyMonitorTick(state(), obs({ processGone: true }), resolveMonitorConfig({ workspaceType: "local" }));
    expect(local.action.type).toBe("died");
  });

  it("skips the local process-death check for remote (ssh/docker) workspaces", () => {
    const remote = classifyMonitorTick(state(), obs({ processGone: true }), resolveMonitorConfig({ workspaceType: "ssh" }));
    expect(remote.action.type).not.toBe("died");
  });

  it("completes on the sticky latch even while the screen is still changing", () => {
    const r = classifyMonitorTick(state(), obs({ captureHash: "hash-B", latched: true }), resolveMonitorConfig());
    expect(r.action.type).toBe("complete");
  });

  // --- the TASK-093 invariant ---
  it("liveness wins: an alive, producing agent with no latch and no event is active, never failed", () => {
    const r = classifyMonitorTick(
      state({ prevHash: "old" }),
      obs({ captureHash: "new", latched: false, completionEventPresent: false, processGone: false }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("active");
    expect(["died", "complete", "stalled-blocked", "stalled-escalate"]).not.toContain(r.action.type);
  });

  it("real activity resets stale and refills the durable nudge budget", () => {
    const r = classifyMonitorTick(
      state({ staleCount: 4, nudgeCount: 2 }),
      obs({ captureHash: "hash-B" }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("active");
    expect(r.state.staleCount).toBe(0);
    expect(r.state.nudgeCount).toBe(0);
    expect(r.state.prevHash).toBe("hash-B");
  });

  it("does NOT refill the budget while inside the nudge-echo grace window", () => {
    const r = classifyMonitorTick(
      state({ nudgeCount: 3, nudgeEchoGrace: 3 }),
      obs({ captureHash: "hash-B" }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("active");
    expect(r.state.nudgeCount).toBe(3); // echo is not progress
    expect(r.state.nudgeEchoGrace).toBe(2);
  });

  it("event present + churning below threshold waits, does not nudge", () => {
    const r = classifyMonitorTick(
      state(),
      obs({ captureHash: "hash-B", completionEventPresent: true }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("wait-threshold");
    expect(r.state.staleCount).toBe(1);
  });

  it("event present + churning at threshold nudges to finish WITHOUT charging the budget", () => {
    const r = classifyMonitorTick(
      state({ staleCount: 2, nudgeCount: 1 }),
      obs({ captureHash: "hash-B", completionEventPresent: true }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("nudge-finish");
    expect(r.state.nudgeCount).toBe(1); // event-present nudge never charges the durable budget
  });

  it("event present + churning past max awaits the latch instead of nudging", () => {
    const r = classifyMonitorTick(
      state({ staleCount: 4 }),
      obs({ captureHash: "hash-B", completionEventPresent: true }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("wait-budget");
  });

  it("stale is not complete: an idle agent past max stale is BLOCKED, never completed", () => {
    const r = classifyMonitorTick(state({ staleCount: 4 }), obs({ captureHash: "hash-A" }), resolveMonitorConfig());
    expect(r.action.type).toBe("stalled-blocked");
    expect(r.action.type).not.toBe("complete");
  });

  it("idle below the advisor threshold waits quietly", () => {
    const r = classifyMonitorTick(state(), obs({ captureHash: "hash-A" }), resolveMonitorConfig());
    expect(r.action.type).toBe("wait-threshold");
    expect(r.state.staleCount).toBe(1);
  });

  it("idle with the durable nudge budget spent escalates instead of nudging forever", () => {
    const r = classifyMonitorTick(
      state({ staleCount: 2, nudgeCount: 5 }),
      obs({ captureHash: "hash-A" }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("stalled-escalate");
  });

  it("idle at threshold nudges, charging the durable budget and arming echo grace", () => {
    const r = classifyMonitorTick(
      state({ staleCount: 2, nudgeCount: 1 }),
      obs({ captureHash: "hash-A" }),
      resolveMonitorConfig(),
    );
    expect(r.action.type).toBe("nudge-stale");
    expect(r.state.nudgeCount).toBe(2); // charged
    expect(r.state.nudgeEchoGrace).toBe(3); // armed
    if (r.action.type === "nudge-stale") expect(r.action.message).toBe(MONITOR_NUDGES.staleEarly);
  });

  it("uses the later nudge copy once past four stale cycles", () => {
    const r = classifyMonitorTick(
      state({ staleCount: 4, nudgeCount: 0 }),
      obs({ captureHash: "hash-A" }),
      resolveMonitorConfig({ maxStaleCount: 10 }),
    );
    expect(r.action.type).toBe("nudge-stale");
    if (r.action.type === "nudge-stale") expect(r.action.message).toBe(MONITOR_NUDGES.staleLate);
  });
});
