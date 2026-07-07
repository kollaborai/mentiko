import { reduceTaskLifecycle } from "../task-lifecycle-reducer";
import {
  MAX_EXECUTION_RETRIES_BEFORE_SUMMARY,
  type TaskLifecycleState,
} from "../task-lifecycle-types";

// Task 1 — Step 2: the shared retry budget must stay at 2 retries (3 attempts),
// matching the current auditor RETRY_CAP=2 semantics (C1).
test("shared retry budget is 2 (3 attempts)", () => {
  expect(MAX_EXECUTION_RETRIES_BEFORE_SUMMARY).toBe(2);
});

function baseState(overrides: Partial<TaskLifecycleState> = {}): TaskLifecycleState {
  return {
    phase: "executing",
    taskId: "TASK-093",
    executionRetryCount: 0,
    retryBudget: 2,
    summarizedFingerprints: [],
    gatedFingerprints: [],
    followUpTaskIds: [],
    blockedByTaskIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Execution failure (retry-before-summary, bounded, idempotent)
// ---------------------------------------------------------------------------

test("failed execution under retry budget retries instead of summarizing", () => {
  const result = reduceTaskLifecycle(baseState({ executionRetryCount: 0 }), {
    type: "execution.failed",
    taskId: "TASK-093",
    runId: "run-1",
    fingerprint: "failed:1",
    reason: "agent failed",
  });
  expect(result.state.phase).toBe("retrying");
  expect(result.state.executionRetryCount).toBe(1);
  expect(result.effects).toEqual([
    { type: "retry_execution", taskId: "TASK-093", previousRunId: "run-1", reason: "agent failed" },
  ]);
});

test("failed execution at retry budget starts summary", () => {
  const result = reduceTaskLifecycle(baseState({ executionRetryCount: 2 }), {
    type: "execution.failed",
    taskId: "TASK-093",
    runId: "run-3",
    fingerprint: "failed:3",
    reason: "agent failed",
  });
  expect(result.state.phase).toBe("summarizing");
  expect(result.effects).toEqual([
    { type: "start_outcome_summary", taskId: "TASK-093", sourceRunId: "run-3", fingerprint: "failed:3" },
  ]);
});

test("nonRetryable failure summarizes immediately regardless of budget", () => {
  const result = reduceTaskLifecycle(baseState({ executionRetryCount: 0 }), {
    type: "execution.failed",
    taskId: "TASK-093",
    runId: "run-1",
    fingerprint: "failed:1",
    reason: "bad chain",
    nonRetryable: true,
  });
  expect(result.effects[0].type).toBe("start_outcome_summary");
  expect(result.state.phase).toBe("summarizing");
});

test("duplicate execution.failed for same fingerprint is idempotent (no effects)", () => {
  const s = baseState({ executionRetryCount: 1, summarizedFingerprints: ["failed:1"] });
  const r = reduceTaskLifecycle(s, {
    type: "execution.failed",
    taskId: "TASK-093",
    runId: "run-1",
    fingerprint: "failed:1",
    reason: "agent failed",
  });
  expect(r.effects).toEqual([]);
  expect(r.state.executionRetryCount).toBe(1); // not double-incremented
});

test("fail -> start -> fail -> start -> fail reaches summary on the 3rd attempt", () => {
  // Same execution series: retry starts must not reset the counter.
  let state = baseState({ phase: "executing", executionRetryCount: 0 });

  let r = reduceTaskLifecycle(state, {
    type: "execution.failed", taskId: "TASK-093", runId: "run-1", fingerprint: "failed:1", reason: "e",
  });
  expect(r.state.phase).toBe("retrying");
  expect(r.state.executionRetryCount).toBe(1);
  state = r.state;

  r = reduceTaskLifecycle(state, { type: "execution.started", taskId: "TASK-093", runId: "run-2", chainId: "c" });
  expect(r.state.executionRetryCount).toBe(1); // preserved on retry start
  state = r.state;

  r = reduceTaskLifecycle(state, {
    type: "execution.failed", taskId: "TASK-093", runId: "run-2", fingerprint: "failed:2", reason: "e",
  });
  expect(r.state.phase).toBe("retrying");
  expect(r.state.executionRetryCount).toBe(2);
  state = r.state;

  r = reduceTaskLifecycle(state, { type: "execution.started", taskId: "TASK-093", runId: "run-3", chainId: "c" });
  expect(r.state.executionRetryCount).toBe(2);
  state = r.state;

  r = reduceTaskLifecycle(state, {
    type: "execution.failed", taskId: "TASK-093", runId: "run-3", fingerprint: "failed:3", reason: "e",
  });
  expect(r.state.phase).toBe("summarizing");
  expect(r.effects).toEqual([
    { type: "start_outcome_summary", taskId: "TASK-093", sourceRunId: "run-3", fingerprint: "failed:3" },
  ]);
});

// ---------------------------------------------------------------------------
// Execution success
// ---------------------------------------------------------------------------

test("execution.completed starts outcome summary with authoritative source run + fingerprint", () => {
  const r = reduceTaskLifecycle(baseState({ currentRunId: "run-OLD" }), {
    type: "execution.completed", taskId: "TASK-093", runId: "run-NEW", fingerprint: "ok:new",
  });
  expect(r.state.phase).toBe("summarizing");
  expect(r.state.summarizedFingerprints).toContain("ok:new");
  expect(r.effects).toEqual([
    { type: "start_outcome_summary", taskId: "TASK-093", sourceRunId: "run-NEW", fingerprint: "ok:new" },
  ]);
});

test("duplicate execution.completed for same fingerprint does not re-summarize", () => {
  const s = baseState({ phase: "summarizing", summarizedFingerprints: ["ok:1"] });
  const r = reduceTaskLifecycle(s, {
    type: "execution.completed", taskId: "TASK-093", runId: "run-1", fingerprint: "ok:1",
  });
  expect(r.effects).toEqual([]); // C4: idempotent
});

// ---------------------------------------------------------------------------
// Execution started (series semantics + concurrency guard)
// ---------------------------------------------------------------------------

test("execution.started for same-series retry preserves the execution retry counter", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "resuming", executionRetryCount: 2 }), {
    type: "execution.started", taskId: "TASK-093", runId: "run-9", chainId: "c",
  });
  expect(r.state.phase).toBe("executing");
  expect(r.state.executionRetryCount).toBe(2); // retry/resume starts must not erase budget
  expect(r.state.currentRunId).toBe("run-9");
  expect(r.state.currentRunStatus).toBe("running");
});

test("execution.started for a new series (from chain_ready) resets the counter", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "chain_ready", executionRetryCount: 2 }), {
    type: "execution.started", taskId: "TASK-093", runId: "run-1", chainId: "c",
  });
  expect(r.state.phase).toBe("executing");
  expect(r.state.executionRetryCount).toBe(0); // genuinely new execution series
});

test("execution.started is a no-op when a run is already running (concurrency guard C7)", () => {
  const s = baseState({ phase: "executing", currentRunId: "run-1", currentRunStatus: "running" });
  const r = reduceTaskLifecycle(s, {
    type: "execution.started", taskId: "TASK-093", runId: "run-2", chainId: "c",
  });
  expect(r.effects).toEqual([]);
  expect(r.state.currentRunId).toBe("run-1"); // second admission ignored
});

// ---------------------------------------------------------------------------
// Summary verdicts
// ---------------------------------------------------------------------------

test("summary verdict=close closes and scans unblocked tasks", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "summarizing" }), {
    type: "summary.completed", taskId: "TASK-093", summaryRunId: "sum-1", sourceRunId: "run-1", verdict: "close",
  });
  expect(r.state.phase).toBe("closing");
  expect(r.effects).toEqual([
    { type: "close_task", taskId: "TASK-093" },
    { type: "scan_unblocked_auto_run_tasks" },
  ]);
});

test("summary verdict=retry increments the counter (bounded loop)", () => {
  const s = baseState({ phase: "summarizing", executionRetryCount: 0 });
  const r = reduceTaskLifecycle(s, {
    type: "summary.completed", taskId: "TASK-093", summaryRunId: "sum-1", sourceRunId: "run-1", verdict: "retry",
  });
  expect(r.state.executionRetryCount).toBe(1); // C2: must increment, else infinite
  expect(r.effects[0].type).toBe("retry_execution");
  expect(r.state.phase).toBe("retrying");
});

test("summary verdict=retry at budget creates a decision gate instead of looping", () => {
  const s = baseState({ phase: "summarizing", executionRetryCount: 2 });
  const r = reduceTaskLifecycle(s, {
    type: "summary.completed", taskId: "TASK-093", summaryRunId: "sum-1", sourceRunId: "run-9", verdict: "retry",
  });
  expect(r.state.phase).toBe("decision_blocked");
  expect(r.effects[0].type).toBe("create_decision_gate");
  expect(r.state.gatedFingerprints).toContain("run-9"); // gate recorded in same transition
});

test("summary verdict=decision creates a decision gate and records the gate fingerprint", () => {
  const s = baseState({ phase: "summarizing" });
  const r = reduceTaskLifecycle(s, {
    type: "summary.completed", taskId: "TASK-093", summaryRunId: "sum-1", sourceRunId: "run-1", verdict: "decision",
  });
  expect(r.state.phase).toBe("decision_blocked");
  expect(r.effects).toEqual([
    { type: "create_decision_gate", taskId: "TASK-093", sourceRunId: "run-1", fingerprint: "" },
  ]);
  expect(r.state.gatedFingerprints).toContain("run-1");
});

test("second decision verdict for an already-gated source reuses the existing gate", () => {
  const s = baseState({ phase: "decision_blocked", gatedFingerprints: ["run-1"] });
  const r = reduceTaskLifecycle(s, {
    type: "summary.completed", taskId: "TASK-093", summaryRunId: "sum-2", sourceRunId: "run-1", verdict: "decision",
  });
  expect(r.effects).toEqual([]); // no duplicate gate
});

// ---------------------------------------------------------------------------
// Decision gate lifecycle
// ---------------------------------------------------------------------------

test("decision.created backfills the decision task id and blocks the parent", () => {
  const s = baseState({ phase: "decision_blocked", gatedFingerprints: ["run-1"] });
  const r = reduceTaskLifecycle(s, {
    type: "decision.created", taskId: "TASK-093", decisionTaskId: "DEC-1", sourceRunId: "run-1", fingerprint: "fp-1",
  });
  expect(r.state.decisionTaskId).toBe("DEC-1");
  expect(r.state.blockedByTaskIds).toContain("DEC-1");
  expect(r.effects).toEqual([{ type: "block_on_decision", taskId: "TASK-093", decisionTaskId: "DEC-1" }]);
});

test("decision.resolved with follow-ups blocks the original task on them", () => {
  const s = baseState({ phase: "decision_blocked", decisionTaskId: "DEC-1", blockedByTaskIds: ["DEC-1"] });
  const r = reduceTaskLifecycle(s, {
    type: "decision.resolved", taskId: "TASK-093", decisionTaskId: "DEC-1", followUpTaskIds: ["TASK-100", "TASK-101"],
  });
  expect(r.state.phase).toBe("followup_blocked");
  expect(r.state.followUpTaskIds).toEqual(["TASK-100", "TASK-101"]);
  expect(r.state.blockedByTaskIds).toEqual(["TASK-100", "TASK-101"]);
  expect(r.effects).toEqual([
    { type: "create_followup_dependencies", taskId: "TASK-093", followUpTaskIds: ["TASK-100", "TASK-101"] },
  ]);
});

test("decision.resolved with no follow-ups resumes the task", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "decision_blocked", decisionTaskId: "DEC-1" }), {
    type: "decision.resolved", taskId: "TASK-093", decisionTaskId: "DEC-1", followUpTaskIds: [],
  });
  expect(r.state.phase).toBe("resuming"); // C6: not stranded
  expect(r.state.decisionTaskId).toBeUndefined();
  expect(r.effects.map((e) => e.type)).toEqual(["resume_original_task", "scan_unblocked_auto_run_tasks"]);
});

test("followups.completed clears blockers and resumes the task", () => {
  const s = baseState({ phase: "followup_blocked", followUpTaskIds: ["TASK-100"], blockedByTaskIds: ["TASK-100"] });
  const r = reduceTaskLifecycle(s, {
    type: "followups.completed", taskId: "TASK-093", followUpTaskIds: ["TASK-100"],
  });
  expect(r.state.phase).toBe("resuming");
  expect(r.state.followUpTaskIds).toEqual([]);
  expect(r.state.blockedByTaskIds).toEqual([]);
  expect(r.effects.map((e) => e.type)).toEqual(["resume_original_task", "scan_unblocked_auto_run_tasks"]);
});

test("decision.deleted with a live run resumes; clears gate and pointers", () => {
  const s = baseState({
    phase: "decision_blocked",
    decisionTaskId: "DEC-1",
    gatedFingerprints: ["run-1"],
    blockedByTaskIds: ["DEC-1"],
    currentRunStatus: "running",
  });
  const r = reduceTaskLifecycle(s, { type: "decision.deleted", taskId: "TASK-093", decisionTaskId: "DEC-1" });
  expect(r.state.phase).toBe("resuming");
  expect(r.state.decisionTaskId).toBeUndefined();
  expect(r.state.blockedByTaskIds).toEqual([]);
  expect(r.effects[0]).toEqual({ type: "clear_decision_gate", taskId: "TASK-093", decisionTaskId: "DEC-1" });
});

test("decision.deleted with no live run returns to idle", () => {
  const s = baseState({ phase: "decision_blocked", decisionTaskId: "DEC-1", blockedByTaskIds: ["DEC-1"] });
  const r = reduceTaskLifecycle(s, { type: "decision.deleted", taskId: "TASK-093", decisionTaskId: "DEC-1" });
  expect(r.state.phase).toBe("idle");
  expect(r.effects.some((e) => e.type === "clear_decision_gate")).toBe(true);
});

test("decision.deleted keeps followup_blocked when follow-up blockers remain", () => {
  const s = baseState({
    phase: "followup_blocked",
    decisionTaskId: "DEC-1",
    followUpTaskIds: ["TASK-100"],
    blockedByTaskIds: ["DEC-1", "TASK-100"],
  });
  const r = reduceTaskLifecycle(s, { type: "decision.deleted", taskId: "TASK-093", decisionTaskId: "DEC-1" });
  expect(r.state.phase).toBe("followup_blocked");
  expect(r.state.blockedByTaskIds).toEqual(["TASK-100"]);
});

// ---------------------------------------------------------------------------
// Pre-execution + terminal phase tracking (no dead states, C5)
// ---------------------------------------------------------------------------

test("analysis.completed advances to chain_ready when no generation is required", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "analyzing" }), {
    type: "analysis.completed", taskId: "TASK-093", recommendationRunId: "rec-1", recommendedChainId: "chain-x", requiresGeneration: false,
  });
  expect(r.state.phase).toBe("chain_ready");
  expect(r.state.chainId).toBe("chain-x");
  expect(r.effects).toEqual([]);
});

test("analysis.completed stays analyzing when generation is required", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "analyzing" }), {
    type: "analysis.completed", taskId: "TASK-093", recommendationRunId: "rec-1", requiresGeneration: true,
  });
  expect(r.state.phase).toBe("analyzing");
});

test("chain.generated advances to chain_ready and records the chain id", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "analyzing" }), {
    type: "chain.generated", taskId: "TASK-093", chainId: "chain-gen", generationRunId: "gen-1",
  });
  expect(r.state.phase).toBe("chain_ready");
  expect(r.state.chainId).toBe("chain-gen");
});

test("task.closed marks the lifecycle closed", () => {
  const r = reduceTaskLifecycle(baseState({ phase: "closing" }), { type: "task.closed", taskId: "TASK-093" });
  expect(r.state.phase).toBe("closed");
  expect(r.effects).toEqual([]);
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

test("reducer does not mutate the input state", () => {
  const input = baseState({ executionRetryCount: 0, summarizedFingerprints: [] });
  const snapshot = JSON.stringify(input);
  reduceTaskLifecycle(input, {
    type: "execution.failed", taskId: "TASK-093", runId: "run-1", fingerprint: "failed:1", reason: "e",
  });
  expect(JSON.stringify(input)).toBe(snapshot);
});
