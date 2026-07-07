import { runChainMonitor, type MonitorDriverIO } from "@/lib/runner-v2/monitor";
import { type MonitorObservation, type MonitorState } from "@/lib/runner-v2/monitor-types";

interface ScriptedTick {
  alive: boolean;
  obs?: Partial<Omit<MonitorObservation, "sessionAlive">>;
}

const NO_OBS: Omit<MonitorObservation, "sessionAlive"> = {
  processGone: false,
  captureHash: "",
  completionEventPresent: false,
  latched: false,
};

function scriptedIO(ticks: ScriptedTick[], initial?: Partial<MonitorState>) {
  const calls = {
    nudges: [] as string[],
    complete: 0,
    died: 0,
    stalled: [] as Array<{ kind: string; count: number }>,
  };
  let state: MonitorState = { prevHash: "", staleCount: 0, nudgeCount: 0, nudgeEchoGrace: 0, ...initial };
  let idx = -1; // -1 during the pre-loop session-wait check; advances on each sleep

  const io: MonitorDriverIO = {
    hasSession: async () => (idx < 0 ? true : Boolean(ticks[idx]?.alive)),
    observe: async () => ({ ...NO_OBS, ...(ticks[idx]?.obs ?? {}) }),
    sendNudge: async (_s, message) => { calls.nudges.push(message); },
    onComplete: async () => { calls.complete++; },
    onDied: async () => { calls.died++; },
    onStalled: async (_s, kind, count) => { calls.stalled.push({ kind, count }); },
    sleep: async () => { idx++; },
    loadState: () => state,
    saveState: (_s, st) => { state = st; },
    clearState: () => {},
    log: () => {},
  };
  return { io, calls };
}

describe("runChainMonitor — driver", () => {
  it("launches completion when the agent latches", async () => {
    const { io, calls } = scriptedIO([
      { alive: true, obs: { captureHash: "h1" } },
      { alive: true, obs: { captureHash: "h1", latched: true } },
    ]);
    const res = await runChainMonitor("s", io, {}, 0);
    expect(res.reason).toBe("complete");
    expect(calls.complete).toBe(1);
    expect(calls.died).toBe(0);
  });

  it("stops cleanly when the session disappears", async () => {
    const { io } = scriptedIO([{ alive: false }]);
    const res = await runChainMonitor("s", io, {}, 0);
    expect(res.reason).toBe("session-gone");
  });

  it("TASK-093: an agent that produces output for many cycles then latches completes — never died/stalled", async () => {
    const { io, calls } = scriptedIO([
      { alive: true, obs: { captureHash: "h1" } },
      { alive: true, obs: { captureHash: "h2" } },
      { alive: true, obs: { captureHash: "h3" } },
      { alive: true, obs: { captureHash: "h4" } },
      { alive: true, obs: { captureHash: "h5" } },
      { alive: true, obs: { captureHash: "h6", latched: true } },
    ]);
    const res = await runChainMonitor("s", io, {}, 0);
    expect(res.reason).toBe("complete");
    expect(calls.died).toBe(0);
    expect(calls.stalled).toHaveLength(0);
  });

  it("escalates a genuinely idle agent to BLOCKED (stale != complete), never completing it", async () => {
    // hash stable every tick (prevHash primed to match), no latch, no event.
    const { io, calls } = scriptedIO(
      Array.from({ length: 5 }, () => ({ alive: true, obs: { captureHash: "same" } })),
      { prevHash: "same" },
    );
    const res = await runChainMonitor("s", io, {}, 0);
    expect(res.reason).toBe("stalled-blocked");
    expect(calls.complete).toBe(0);
    expect(calls.stalled[0].kind).toBe("blocked");
    expect(calls.nudges.length).toBeGreaterThan(0); // nudged before escalating
  });
});
