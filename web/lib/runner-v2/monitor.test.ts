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
  contextExhausted: false,
};

function scriptedIO(ticks: ScriptedTick[], initial?: Partial<MonitorState>) {
  const calls = {
    nudges: [] as string[],
    complete: 0,
    died: 0,
    stalled: [] as Array<{ kind: string; count: number }>,
    contextExhausted: 0,
  };
  let state: MonitorState = { prevHash: "", staleCount: 0, nudgeCount: 0, nudgeEchoGrace: 0, contextExhaustedStreak: 0, ...initial };
  let idx = -1; // -1 during the pre-loop session-wait check; advances on each sleep

  const io: MonitorDriverIO = {
    hasSession: async () => (idx < 0 ? true : Boolean(ticks[idx]?.alive)),
    observe: async () => ({ ...NO_OBS, ...(ticks[idx]?.obs ?? {}) }),
    sendNudge: async (_s, message) => { calls.nudges.push(message); },
    onComplete: async () => { calls.complete++; },
    recheckCompletion: async () => false,
    onDied: async () => { calls.died++; return "terminal" as const; },
    onStalled: async (_s, kind, count) => { calls.stalled.push({ kind, count }); return "terminal" as const; },
    onContextExhausted: async () => { calls.contextExhausted++; return "terminal" as const; },
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

  it("completion evidence beats session-gone classification", async () => {
    const { io, calls } = scriptedIO([{ alive: false }]);
    io.recheckCompletion = async () => true;

    const res = await runChainMonitor("s", io, {}, 0);

    expect(res.reason).toBe("complete");
    expect(calls.complete).toBe(1);
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

  it("ISSUE-008: a context-exhausted agent is torn down after the debounce, not nudged forever", async () => {
    const { io, calls } = scriptedIO([
      { alive: true, obs: { captureHash: "err", contextExhausted: true } }, // streak 1 — below threshold
      { alive: true, obs: { captureHash: "err", contextExhausted: true } }, // streak 2 — terminal
    ]);
    const res = await runChainMonitor("s", io, {}, 0);
    expect(res.reason).toBe("context-exhausted");
    expect(calls.contextExhausted).toBe(1);
    expect(calls.nudges).toHaveLength(0); // never burned the nudge budget on a corpse
    expect(calls.stalled).toHaveLength(0);
    expect(calls.complete).toBe(0);
  });

  it("ISSUE-008: a one-off context error the agent recovers from is NOT terminal", async () => {
    const { io, calls } = scriptedIO([
      { alive: true, obs: { captureHash: "err", contextExhausted: true } },  // streak 1
      { alive: true, obs: { captureHash: "h2" } },                            // recovered -> streak resets
      { alive: true, obs: { captureHash: "h3", latched: true } },             // completes normally
    ]);
    const res = await runChainMonitor("s", io, {}, 0);
    expect(res.reason).toBe("complete");
    expect(calls.contextExhausted).toBe(0);
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

  it("completion evidence arriving after observation wins the terminal stall race", async () => {
    const { io, calls } = scriptedIO(
      Array.from({ length: 5 }, () => ({ alive: true, obs: { captureHash: "same" } })),
      { prevHash: "same" },
    );
    io.recheckCompletion = async () => true;

    const res = await runChainMonitor("s", io, {}, 0);

    expect(res.reason).toBe("complete");
    expect(calls.complete).toBe(1);
    expect(calls.stalled).toHaveLength(0);
    expect(calls.contextExhausted).toBe(0);
  });

  it("a second evidence probe inside terminalization beats the remaining recheck race", async () => {
    const { io, calls } = scriptedIO(
      Array.from({ length: 5 }, () => ({ alive: true, obs: { captureHash: "same" } })),
      { prevHash: "same" },
    );
    io.recheckCompletion = async () => false;
    io.onStalled = async () => "complete";

    const res = await runChainMonitor("s", io, {}, 0);

    expect(res.reason).toBe("complete");
    expect(calls.stalled).toHaveLength(0);
  });
});
