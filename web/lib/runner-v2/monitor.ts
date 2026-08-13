import { classifyMonitorTick, resolveMonitorConfig } from "@/lib/runner-v2/monitor-reducer";
import {
  MONITOR_DEFAULTS,
  type MonitorConfig,
  type MonitorObservation,
  type MonitorState,
} from "@/lib/runner-v2/monitor-types";

// Driver for the typed chain monitor. Owns the poll loop, the durable state
// files, and the side effects; delegates every decision to classifyMonitorTick.
// I/O is injected so the loop is deterministic in tests. Its decision behavior
// preserves the documented pre-cutover monitor invariants without reusing that shell owner.

export type MonitorExitReason =
  | "session-gone"
  | "died"
  | "complete"
  | "stalled-blocked"
  | "stalled-escalate"
  | "context-exhausted";

export interface MonitorDriverIO {
  // transport_has_session
  hasSession(session: string): Promise<boolean>;
  // everything observable about a live session this tick: local process death,
  // md5 of the last 20 captured lines, whether a declared completion event is on
  // disk, and the sticky event/marker/core-generation-artifact latch.
  observe(session: string): Promise<Omit<MonitorObservation, "sessionAlive">>;
  // type a nudge into the session (send-keys + CR)
  sendNudge(session: string, message: string): Promise<void>;
  // launch the completion handler (typed completion bridge) in a separate pty
  onComplete(session: string): Promise<void>;
  // One authoritative, side-effect-free completion probe. The driver calls it
  // immediately before every terminal non-success mutation to close the race
  // between the last observation and failure/blocking classification.
  recheckCompletion(session: string): Promise<boolean>;
  // dead != succeeded: monitor-agent-died (event-first) — completes only if a real
  // event exists, else records failure; never fabricates success.
  onDied(session: string): Promise<"complete" | "terminal">;
  // stale != complete: monitor-agent-stalled — surfaces BLOCKED, never emits success.
  onStalled(session: string, kind: "blocked" | "escalate", count: number): Promise<"complete" | "terminal">;
  // context-window-limit wedge (debounced) — FAILS the run with a clear reason AND
  // tears down the unresumable session (a context-full agent is pure dead weight).
  onContextExhausted(session: string): Promise<"complete" | "terminal">;
  sleep(seconds: number): Promise<void>;
  loadState(session: string): MonitorState;
  saveState(session: string, state: MonitorState): void;
  clearState(session: string): void;
  log?(message: string): void;
}

export interface MonitorRunResult {
  reason: MonitorExitReason;
  ticks: number;
  finalState: MonitorState;
}

const SESSION_WAIT_RETRIES = 10; // shell :958 — 10 x 3s = 30s

const NO_OBSERVATION: Omit<MonitorObservation, "sessionAlive"> = {
  processGone: false,
  captureHash: "",
  completionEventPresent: false,
  latched: false,
  contextExhausted: false,
};

export async function runChainMonitor(
  session: string,
  io: MonitorDriverIO,
  configOverrides: Partial<MonitorConfig> = {},
  checkIntervalSec: number = MONITOR_DEFAULTS.checkIntervalSec,
): Promise<MonitorRunResult> {
  const config = resolveMonitorConfig(configOverrides);
  const log = io.log ?? (() => {});

  // wait for the session to appear (race with agent launch), shell :954-964
  let retries = 0;
  while (!(await io.hasSession(session))) {
    if (++retries >= SESSION_WAIT_RETRIES) {
      if (await io.recheckCompletion(session)) {
        await io.onComplete(session);
        io.clearState(session);
        return { reason: "complete", ticks: 0, finalState: io.loadState(session) };
      }
      log(`monitor: session '${session}' not found after ${SESSION_WAIT_RETRIES * 3}s`);
      if (await io.onDied(session) === "complete") {
        io.clearState(session);
        return { reason: "complete", ticks: 0, finalState: io.loadState(session) };
      }
      io.clearState(session);
      return { reason: "died", ticks: 0, finalState: io.loadState(session) };
    }
    await io.sleep(3);
  }

  let state = io.loadState(session);
  let ticks = 0;

  while (true) {
    await io.sleep(checkIntervalSec);
    ticks++;

    const sessionAlive = await io.hasSession(session);
    const partial = sessionAlive ? await io.observe(session) : NO_OBSERVATION;
    const observation: MonitorObservation = { sessionAlive, ...partial };

    const tick = classifyMonitorTick(state, observation, config);
    state = tick.state;
    io.saveState(session, state);

    switch (tick.action.type) {
      case "session-gone":
        if (await io.recheckCompletion(session)) {
          await io.onComplete(session);
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        if (await io.onDied(session) === "complete") {
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        io.clearState(session);
        return { reason: "died", ticks, finalState: state };
      case "died":
        if (await io.recheckCompletion(session)) {
          await io.onComplete(session);
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        if (await io.onDied(session) === "complete") {
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        io.clearState(session);
        return { reason: "died", ticks, finalState: state };
      case "complete":
        await io.onComplete(session);
        io.clearState(session);
        return { reason: "complete", ticks, finalState: state };
      case "stalled-blocked":
        if (await io.recheckCompletion(session)) {
          await io.onComplete(session);
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        if (await io.onStalled(session, "blocked", state.staleCount) === "complete") {
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        io.clearState(session);
        return { reason: "stalled-blocked", ticks, finalState: state };
      case "stalled-escalate":
        if (await io.recheckCompletion(session)) {
          await io.onComplete(session);
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        if (await io.onStalled(session, "escalate", state.nudgeCount) === "complete") {
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        io.clearState(session);
        return { reason: "stalled-escalate", ticks, finalState: state };
      case "context-exhausted":
        if (await io.recheckCompletion(session)) {
          await io.onComplete(session);
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        if (await io.onContextExhausted(session) === "complete") {
          io.clearState(session);
          return { reason: "complete", ticks, finalState: state };
        }
        io.clearState(session);
        return { reason: "context-exhausted", ticks, finalState: state };
      case "nudge-finish":
      case "nudge-stale":
        await io.sendNudge(session, tick.action.message);
        break;
      case "active":
      case "wait-threshold":
      case "wait-budget":
        break;
    }
  }
}
