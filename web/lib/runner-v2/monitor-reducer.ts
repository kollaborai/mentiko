import {
  MONITOR_DEFAULTS,
  MONITOR_NUDGES,
  type MonitorAction,
  type MonitorConfig,
  type MonitorObservation,
  type MonitorState,
  type MonitorTickResult,
} from "@/lib/runner-v2/monitor-types";

/**
 * Pure decision for one monitor poll tick. Mirrors lib/agent-functions.sh
 * monitor-chain-agent (:980-1233) branch-for-branch:
 *
 *   1. session gone            -> session-gone
 *   2. local process gone      -> died           (dead != succeeded; driver runs
 *                                                  monitor-agent-died, event-first)
 *   3. latched (marker OR event, sticky) -> complete   (checked BEFORE the hash so a
 *                                                        still-repainting screen completes)
 *   4. hash changed + event present -> stale++, then wait-threshold / wait-budget /
 *                                      nudge-finish   (never charges the durable budget)
 *   5. hash changed, no event  -> active   (reset stale; refill budget only for
 *                                           progress we did not cause — echo grace)
 *   6. hash stable + stale>=max -> stalled-blocked   (stale != complete: BLOCKED,
 *                                                      never emits success)
 *   7. hash stable + below advisor threshold -> wait-threshold
 *   8. hash stable + nudge budget spent -> stalled-escalate
 *   9. hash stable otherwise   -> nudge-stale   (charges durable budget, arms echo grace)
 *
 * The md5 hash is ONLY an activity/quiescence trigger — never a completion signal.
 */
export function classifyMonitorTick(
  state: MonitorState,
  obs: MonitorObservation,
  config: MonitorConfig,
): MonitorTickResult {
  // 1. session gone (shell :983)
  if (!obs.sessionAlive) {
    return { state, action: { type: "session-gone" } };
  }

  // 2. authoritative "done" latch (sticky AGENT_COMPLETE marker OR event) wins
  //    over everything below, including process death. An agent that printed its
  //    marker / emitted its event and THEN exited finished normally; classifying
  //    that as "died" is the ordering bug this contract exists to prevent.
  //    NOTE: this deliberately supersedes the shell order (process-gone checked
  //    before the latch at :995 vs :1044), whose monitor-agent-died only re-checks
  //    the EVENT FILE and would lose a marker-only latch on death. Latch-first
  //    fixes that. Also checked before the hash so a status-line repaint after the
  //    final text cannot delay completion.
  if (obs.latched) {
    return { state, action: { type: "complete" } };
  }

  // 2.5 context-window-limit wedge: an agent whose prompt exceeds the model's context
  //     window emits the SAME API error every turn and can never generate output, so
  //     it can never print AGENT_COMPLETE — nudging it only burns the budget on a
  //     corpse (run-1783801010519 sat blocked with its pty alive for 2h+). Debounced
  //     over consecutive ticks so a one-off error the CLI auto-compacts past is never
  //     terminal. Checked AFTER the latch (a real completion always wins) and folded
  //     into state so every path below carries the current streak.
  const contextExhaustedStreak = obs.contextExhausted ? state.contextExhaustedStreak + 1 : 0;
  state = { ...state, contextExhaustedStreak };
  if (obs.contextExhausted && contextExhaustedStreak >= config.contextExhaustedMaxStreak) {
    return { state, action: { type: "context-exhausted" } };
  }

  // 3. process death is checked only for local workspaces; remote (ssh/docker)
  //    has no local pid to pgrep, so the shell skips it (:995). dead != succeeded.
  //    Reaching here means NOT latched, so death is genuine (no marker, no event);
  //    onDied still re-checks the event file as a race guard (classifyDeath).
  if (config.workspaceType === "local" && obs.processGone) {
    return { state, action: { type: "died" } };
  }

  const hashChanged = obs.captureHash !== state.prevHash;

  if (hashChanged) {
    // 4. screen changing WITH a completion event already on disk: the agent
    //    produced handoff data but has not printed AGENT_COMPLETE. Nudge toward
    //    the final marker, bounded — this branch NEVER charges the durable nudge
    //    budget (only the idle-stalled nudge does), matching the shell (:1077-1111).
    if (obs.completionEventPresent) {
      const staleCount = state.staleCount + 1;
      const next: MonitorState = { ...state, staleCount, prevHash: obs.captureHash };
      if (!shouldAskAdvisor(staleCount, config.advisorStaleThreshold)) {
        return { state: next, action: { type: "wait-threshold" } };
      }
      if (staleCount >= config.maxStaleCount) {
        return { state: next, action: { type: "wait-budget" } };
      }
      return { state: next, action: { type: "nudge-finish", message: MONITOR_NUDGES.eventExists } };
    }

    // 5. real activity: reset the per-cycle stale counter, adopt the new hash, and
    //    refill the durable nudge budget ONLY for progress we did not cause. A
    //    nudge's echo spans a few cycles; the grace window absorbs them so the echo
    //    never miscredits as progress and refills the budget (:1113-1133).
    const inEcho = state.nudgeEchoGrace > 0;
    return {
      state: {
        prevHash: obs.captureHash,
        staleCount: 0,
        nudgeEchoGrace: inEcho ? state.nudgeEchoGrace - 1 : 0,
        nudgeCount: inEcho ? state.nudgeCount : 0,
        contextExhaustedStreak,
      },
      action: { type: "active" },
    };
  }

  // hash stable -> agent is idle at the prompt. The latch was already checked
  // above; reaching here means no marker and (if event present) it is handled by
  // the changed-branch on churn, so the idle path is the no-event stall.
  const staleCount = state.staleCount + 1;

  // 6. stale ceiling: an alive-but-quiescent agent past max is BLOCKED, not
  //    success — never emit its event, never run the completion handler (:1177).
  if (staleCount >= config.maxStaleCount) {
    return { state: { ...state, staleCount }, action: { type: "stalled-blocked" } };
  }

  const next: MonitorState = { ...state, staleCount, prevHash: obs.captureHash };

  // 7. below the advisor threshold: wait quietly, do not nudge yet (:1184).
  if (!shouldAskAdvisor(staleCount, config.advisorStaleThreshold)) {
    return { state: next, action: { type: "wait-threshold" } };
  }

  // 8. durable nudge budget spent: escalate as BLOCKED instead of typing into an
  //    unresponsive session forever. The per-cycle counter can never reach maxStale
  //    from this path (each nudge echo resets it), so this file-backed ceiling is
  //    the only real stop (:1197).
  if (state.nudgeCount >= config.maxTotalNudges) {
    return { state: next, action: { type: "stalled-escalate" } };
  }

  // 9. nudge: charge the durable budget and arm the echo grace so the resulting
  //    repaint is not counted as progress (:1205-1230).
  return {
    state: { ...next, nudgeCount: state.nudgeCount + 1, nudgeEchoGrace: MONITOR_DEFAULTS.nudgeEchoGraceCycles },
    action: {
      type: "nudge-stale",
      message: staleCount <= 4 ? MONITOR_NUDGES.staleEarly : MONITOR_NUDGES.staleLate,
    },
  };
}

/**
 * monitor_should_ask_advisor: nudging only begins once the stale counter reaches
 * the advisor threshold; below it the monitor waits quietly. Shell semantics:
 * `! monitor_should_ask_advisor` -> wait, so ask == stale >= threshold.
 */
export function shouldAskAdvisor(staleCount: number, advisorStaleThreshold: number): boolean {
  return staleCount >= advisorStaleThreshold;
}

export function resolveMonitorConfig(overrides: Partial<MonitorConfig> = {}): MonitorConfig {
  return {
    maxStaleCount: overrides.maxStaleCount ?? MONITOR_DEFAULTS.maxStaleCount,
    advisorStaleThreshold: overrides.advisorStaleThreshold ?? MONITOR_DEFAULTS.advisorStaleThreshold,
    maxTotalNudges: overrides.maxTotalNudges ?? MONITOR_DEFAULTS.maxTotalNudges,
    contextExhaustedMaxStreak: overrides.contextExhaustedMaxStreak ?? MONITOR_DEFAULTS.contextExhaustedMaxStreak,
    workspaceType: overrides.workspaceType ?? "local",
  };
}

export type { MonitorAction };
