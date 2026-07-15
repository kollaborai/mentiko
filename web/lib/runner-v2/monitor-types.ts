// Typed port of the shell chain monitor (lib/agent-functions.sh monitor-chain-agent
// :919 + helpers). Behind MENTIKO_MONITOR_V2. See
// docs/orchestration/contracts/monitor-v2.design.json.
//
// The decision logic lives here as a pure reducer so every invariant
// (stale != complete, sticky latch, durable nudge budget, echo grace,
// event-first death) is unit-testable without a live PTY. I/O (capture, send,
// completion handoff) is the driver's job (monitor.ts).

// Defaults mirror the shell monitor's env-configurable knobs.
export const MONITOR_DEFAULTS = {
  checkIntervalSec: 5, //                      arg 2 default
  maxStaleCount: 5, //     DEFAULT_MAX_STALE_COUNT / arg 5 default
  advisorStaleThreshold: 3, //  MENTIKO_ADVISOR_STALE_COUNT default
  maxTotalNudges: 5, //         MENTIKO_MONITOR_MAX_NUDGES default
  nudgeEchoGraceCycles: 3, //   cycles of self-echo to not miscredit as progress
  contextExhaustedMaxStreak: 2, // consecutive ticks a context-window-limit error must
  //                               persist before the run is failed (debounce: a one-off
  //                               error the CLI auto-compacts past must not terminate).
} as const;

// Nudge copy, verbatim from the shell fallbacks so behavior is identical.
export const MONITOR_NUDGES = {
  eventExists:
    "Your completion event exists. Finish the final terminal response and make the final non-empty line exactly AGENT_COMPLETE. Do not redo the task.",
  staleEarly:
    "continue only the current assigned task, or write your event file and output AGENT_COMPLETE on its own line.",
  staleLate:
    "write your event file and summary artifacts, then make your final non-empty terminal line exactly AGENT_COMPLETE with no text after it.",
} as const;

// Durable per-agent state — the shell keeps these in ~/.mentiko_monitor/${session}_*
// files. The typed port must persist them the same way (the driver owns the files);
// the reducer treats them as plain state so restart/idempotency is testable.
export interface MonitorState {
  // md5 of the last 20 captured lines from the prior tick (${session}_state).
  prevHash: string;
  // per-cycle stale counter (${session}_stale); reset by real activity.
  staleCount: number;
  // durable nudge budget spent (${session}_nudges); survives screen-echo resets
  // and monitor restarts — the only thing that stops nudging a 0-progress session.
  nudgeCount: number;
  // remaining cycles to treat as our own nudge echo, not progress (so an echo
  // never refills the durable budget). Shell: nudge_echo_grace.
  nudgeEchoGrace: number;
  // consecutive ticks a context-window-limit signal has been observed. A within-run
  // debounce (like nudgeEchoGrace it resets to 0 on a fresh process): the wedge is
  // persistent, so a restart rebuilds the streak in a couple of ticks.
  contextExhaustedStreak: number;
}

// Everything the driver observes about the session this tick.
export interface MonitorObservation {
  // transport_has_session
  sessionAlive: boolean;
  // local only: _monitor_agent_process_gone. Always false for ssh/docker (the
  // shell skips the local process-death check for remote workspaces).
  processGone: boolean;
  // md5 of the last 20 captured lines this tick.
  captureHash: string;
  // monitor_completion_event_file found a declared emits event for this run.
  completionEventPresent: boolean;
  // agent-completion-latched: declared event, durable AGENT_COMPLETE marker,
  // or a run/attempt-scoped compatible core-generation artifact.
  latched: boolean;
  // detectContextExhaustion: the capture shows an API-level context-window-limit
  // error this tick. Debounced in the reducer before it terminalizes the run.
  contextExhausted: boolean;
}

export interface MonitorConfig {
  maxStaleCount: number;
  advisorStaleThreshold: number;
  maxTotalNudges: number;
  contextExhaustedMaxStreak: number;
  workspaceType: string; // "local" | "ssh" | "docker" | ...
}

export type MonitorAction =
  | { type: "session-gone" } //       session vanished -> stop + clean up
  | { type: "died" } //               local process gone -> monitor-agent-died (event-first)
  | { type: "complete" } //           latched -> launch completion handler
  | { type: "active" } //             real progress -> keep watching
  | { type: "wait-threshold" } //     stale below advisor threshold -> quiet wait
  | { type: "wait-budget" } //        event present + screen churning past budget -> await latch
  | { type: "nudge-finish"; message: string } // event present -> nudge to finish (no budget charge)
  | { type: "nudge-stale"; message: string } //  idle stalled -> nudge (charges durable budget)
  | { type: "stalled-blocked" } //    stale >= max, no event -> monitor-agent-stalled BLOCKED
  | { type: "stalled-escalate" } //   durable nudge budget spent -> monitor-agent-stalled escalate
  | { type: "context-exhausted" }; // context-window-limit wedge (debounced) -> FAILED + tear down session

export interface MonitorTickResult {
  state: MonitorState;
  action: MonitorAction;
}

export function initialMonitorState(currentHash = ""): MonitorState {
  return { prevHash: currentHash, staleCount: 0, nudgeCount: 0, nudgeEchoGrace: 0, contextExhaustedStreak: 0 };
}
