import { classifyMonitorTick, resolveMonitorConfig } from "@/lib/runner-v2/monitor-reducer";
import {
  MONITOR_DEFAULTS,
  type MonitorConfig,
  type MonitorObservation,
  type MonitorState,
} from "@/lib/runner-v2/monitor-types";

// Driver for the typed chain monitor. Owns the poll loop, the durable state
// files, and the side effects; delegates every decision to classifyMonitorTick.
// I/O is injected so the loop is deterministic in tests. Mirrors the control flow
// of lib/agent-functions.sh monitor-chain-agent (:954-1234).

export type MonitorExitReason =
  | "session-gone"
  | "died"
  | "complete"
  | "stalled-blocked"
  | "stalled-escalate";

export interface MonitorDriverIO {
  // transport_has_session
  hasSession(session: string): Promise<boolean>;
  // everything observable about a live session this tick: local process death,
  // md5 of the last 20 captured lines, whether a declared completion event is on
  // disk, and the sticky AGENT_COMPLETE/event latch.
  observe(session: string): Promise<Omit<MonitorObservation, "sessionAlive">>;
  // type a nudge into the session (send-keys + CR)
  sendNudge(session: string, message: string): Promise<void>;
  // launch the completion handler (typed completion bridge) in a separate pty
  onComplete(session: string): Promise<void>;
  // dead != succeeded: monitor-agent-died (event-first) — completes only if a real
  // event exists, else records failure; never fabricates success.
  onDied(session: string): Promise<void>;
  // stale != complete: monitor-agent-stalled — surfaces BLOCKED, never emits success.
  onStalled(session: string, kind: "blocked" | "escalate", count: number): Promise<void>;
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
      log(`monitor: session '${session}' not found after ${SESSION_WAIT_RETRIES * 3}s`);
      return { reason: "session-gone", ticks: 0, finalState: io.loadState(session) };
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
        io.clearState(session);
        return { reason: "session-gone", ticks, finalState: state };
      case "died":
        await io.onDied(session);
        io.clearState(session);
        return { reason: "died", ticks, finalState: state };
      case "complete":
        await io.onComplete(session);
        io.clearState(session);
        return { reason: "complete", ticks, finalState: state };
      case "stalled-blocked":
        await io.onStalled(session, "blocked", state.staleCount);
        io.clearState(session);
        return { reason: "stalled-blocked", ticks, finalState: state };
      case "stalled-escalate":
        await io.onStalled(session, "escalate", state.nudgeCount);
        io.clearState(session);
        return { reason: "stalled-escalate", ticks, finalState: state };
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
