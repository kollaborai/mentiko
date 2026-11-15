// Runner contract, rule 3: no dead ends.
//
// Every task lifecycle phase is either RESTING (a named owner outside the
// reducer moves it on) or WORKING (it waits for one piece of work to report).
// A WORKING phase must have an exit for "that work failed or never answered":
// the reducer must answer with an effect or move to a RESTING phase. A WORKING
// phase with no failure exit freezes the task and every task that depends on it.
//
// Live evidence this guards against: TASK-008 sat in `summarizing` from
// 2026-10-30 because its outcome-summary run was escalated by the monitor and
// the lifecycle had no summary-failure exit; its dependents never started.

import { reduceTaskLifecycle } from "../task-lifecycle-reducer";
import type {
  TaskLifecycleEvent,
  TaskLifecyclePhase,
  TaskLifecycleState,
  TaskLifecycleTransition,
} from "../task-lifecycle-types";

// Who moves a task out of each resting phase.
const RESTING_PHASE_OWNER: Partial<Record<TaskLifecyclePhase, string>> = {
  idle: "auto-run admission",
  chain_ready: "auto-run admission",
  decision_blocked: "a human decision",
  followup_blocked: "the follow-up tasks",
  closed: "nobody: terminal",
};

function state(overrides: Partial<TaskLifecycleState> = {}): TaskLifecycleState {
  return {
    phase: "summarizing",
    taskId: "TASK-008",
    currentRunId: "run-src",
    currentRunStatus: "completed",
    executionRetryCount: 0,
    retryBudget: 2,
    summarizedFingerprints: ["run-src::completed:t1"],
    gatedFingerprints: [],
    followUpTaskIds: [],
    blockedByTaskIds: [],
    ...overrides,
  };
}

function hasNextStep(transition: TaskLifecycleTransition): boolean {
  return transition.effects.length > 0 || transition.state.phase in RESTING_PHASE_OWNER;
}

function summaryFailed(exhausted: boolean): TaskLifecycleEvent {
  return {
    type: "summary.failed",
    taskId: "TASK-008",
    sourceRunId: "run-src",
    fingerprint: "completed:t1",
    reason: "monitor: no real progress after 5 nudges",
    exhausted,
  };
}

describe("rule 3: a failed outcome summary always has a next step", () => {
  test("first failure starts the summary again for the same source run", () => {
    const result = reduceTaskLifecycle(state(), summaryFailed(false));
    expect(result.state.phase).toBe("summarizing");
    expect(result.state.lastError).toBe("monitor: no real progress after 5 nudges");
    expect(result.effects).toEqual([
      { type: "start_outcome_summary", taskId: "TASK-008", sourceRunId: "run-src", fingerprint: "completed:t1" },
    ]);
  });

  test("exhausted failures hand the task to a human decision, never close it", () => {
    const result = reduceTaskLifecycle(state(), summaryFailed(true));
    expect(result.state.phase).toBe("decision_blocked");
    expect(result.state.lastError).toBe("monitor: no real progress after 5 nudges");
    expect(result.effects).toEqual([
      { type: "create_decision_gate", taskId: "TASK-008", sourceRunId: "run-src", fingerprint: "completed:t1" },
    ]);
  });

  test("a repeated exhausted failure does not create a second decision gate", () => {
    const first = reduceTaskLifecycle(state(), summaryFailed(true));
    const second = reduceTaskLifecycle(first.state, summaryFailed(true));
    expect(second.state.phase).toBe("decision_blocked");
    expect(second.effects).toEqual([]);
  });
});

describe("rule 3: every working phase has a failure exit", () => {
  // One row per WORKING phase: the event that means "the work this phase waits
  // on failed". Adding a phase to TaskLifecyclePhase without a row here, or an
  // owner in RESTING_PHASE_OWNER, fails the completeness test below.
  const FAILURE_EXIT: Partial<Record<TaskLifecyclePhase, TaskLifecycleEvent>> = {
    executing: { type: "execution.failed", taskId: "TASK-008", runId: "run-2", fingerprint: "failed:t2", reason: "agent session lost" },
    summarizing: summaryFailed(false),
  };
  // Not yet proven either way; each needs its owner traced in code before it
  // gets a row above. Tracked here so the gap is visible, not silent.
  const UNPROVEN: TaskLifecyclePhase[] = ["analyzing", "retrying", "resuming", "closing"];

  const ALL_PHASES: TaskLifecyclePhase[] = [
    "idle", "analyzing", "chain_ready", "executing", "retrying", "summarizing",
    "decision_blocked", "followup_blocked", "resuming", "closing", "closed",
  ];

  test("every phase is classified as resting, working, or unproven", () => {
    for (const phase of ALL_PHASES) {
      const classified = phase in RESTING_PHASE_OWNER || phase in FAILURE_EXIT || UNPROVEN.includes(phase);
      expect({ phase, classified }).toEqual({ phase, classified: true });
    }
  });

  test.each(Object.entries(FAILURE_EXIT))("%s: failure of its work produces a next step", (phase, event) => {
    const result = reduceTaskLifecycle(state({ phase: phase as TaskLifecyclePhase, summarizedFingerprints: [] }), event);
    expect(hasNextStep(result)).toBe(true);
  });

  test.todo("analyzing: trace who moves a task on when the recommendation or generation run dies");
  test.todo("retrying: trace who moves a task on when the retry run never starts");
  test.todo("resuming: trace who moves a task on when the resumed run never starts");
  test.todo("closing: trace who moves a task on when the close write fails");
});
