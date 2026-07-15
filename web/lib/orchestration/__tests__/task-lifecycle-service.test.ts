import { hydrateLifecycleState } from "../task-lifecycle-hydrate";
import {
  applyLifecycleEvent,
  type CreateDecisionGateInput,
  type LifecycleAdapterContext,
  type LifecycleEffectDeps,
  type StartOutcomeSummaryInput,
} from "../task-lifecycle-service";

// ---------------------------------------------------------------------------
// hydrateLifecycleState (Task 3, Step 1 — the state source, C3)
// ---------------------------------------------------------------------------

describe("hydrateLifecycleState", () => {
  test("maps every persisted metadata key onto lifecycle state", () => {
    const state = hydrateLifecycleState("TASK-1", {
      execution_retries: 1,
      last_run_id: "run-5",
      last_run_status: "running",
      summarized_run_fingerprints: ["ok:1"],
      gated_run_fingerprints: ["run-3"],
      decision_subtask_id: "DEC-9",
      last_run_decision_required: true,
      followup_task_ids: ["TASK-2"],
      lifecycle_phase: "decision_blocked",
      chain_id: "chain-x",
    });
    expect(state.taskId).toBe("TASK-1");
    expect(state.executionRetryCount).toBe(1);
    expect(state.retryBudget).toBe(2);
    expect(state.currentRunId).toBe("run-5");
    expect(state.currentRunStatus).toBe("running");
    expect(state.summarizedFingerprints).toEqual(["run-5::ok:1"]);
    expect(state.gatedFingerprints).toEqual(["run-3"]);
    expect(state.decisionTaskId).toBe("DEC-9");
    expect(state.followUpTaskIds).toEqual(["TASK-2"]);
    expect(state.chainId).toBe("chain-x");
    expect(state.phase).toBe("decision_blocked"); // persisted phase wins
  });

  test("uses execution_retries only — never falls back to auto_run_retries (C1)", () => {
    const state = hydrateLifecycleState("TASK-1", { auto_run_retries: 5 });
    expect(state.executionRetryCount).toBe(0);
  });

  test("legacy single fingerprint fields hydrate into run-scoped summarizedFingerprints when last_run_id exists", () => {
    const a = hydrateLifecycleState("TASK-1", {
      last_run_id: "run-legacy",
      completion_audit_run_fingerprint: "legacy:a",
    });
    expect(a.summarizedFingerprints).toContain("run-legacy::legacy:a");
    const b = hydrateLifecycleState("TASK-1", {
      last_run_id: "run-legacy",
      task_outcome_summary_run_fingerprint: "legacy:b",
    });
    expect(b.summarizedFingerprints).toContain("run-legacy::legacy:b");
  });

  test("keeps legacy audit fingerprints scoped to their source run and drops live fingerprints", () => {
    const state = hydrateLifecycleState("TASK-1", {
      last_run_id: "run-current",
      last_run_status: "running",
      completion_audit_run_id: "run-old",
      completion_audit_run_fingerprint: "stopped:t1",
      task_outcome_summary_source_run_id: "run-old",
      task_outcome_summary_run_fingerprint: "running:no-terminal-time",
      summarized_run_fingerprints: [
        "run-current::running:no-terminal-time",
        "run-older::failed:t0",
      ],
    });

    expect(state.summarizedFingerprints).toEqual([
      "run-older::failed:t0",
      "run-old::stopped:t1",
    ]);
    expect(state.summarizedFingerprints).not.toContain("run-current::running:no-terminal-time");
  });

  test("legacy single fingerprint without a run id remains compatible but cannot suppress another run", () => {
    const state = hydrateLifecycleState("TASK-1", { completion_audit_run_fingerprint: "legacy:a" });
    expect(state.summarizedFingerprints).toContain("legacy:a");
  });

  test("an already-stuck task (open, exhausted terminal runs) hydrates to a sane phase, not default", () => {
    const state = hydrateLifecycleState("TASK-093", {
      // legacy stuck task: terminal stopped runs, budget exhausted, no lifecycle_phase persisted
      last_run_status: "stopped",
      execution_retries: 2,
    });
    expect(state.phase).not.toBe("idle");
    expect(state.phase).toBe("summarizing");
  });

  test("derives retrying for a terminal failure with budget remaining", () => {
    const state = hydrateLifecycleState("TASK-1", { last_run_status: "stopped", execution_retries: 0 });
    expect(state.phase).toBe("retrying");
  });

  test("derives executing for a live run and decision_blocked for an active gate", () => {
    expect(hydrateLifecycleState("TASK-1", { last_run_status: "running", last_run_id: "r" }).phase).toBe("executing");
    expect(
      hydrateLifecycleState("TASK-1", { last_run_decision_required: true, decision_subtask_id: "DEC-1" }).phase,
    ).toBe("decision_blocked");
  });

  test("derives followup_blocked when follow-ups are pending", () => {
    const state = hydrateLifecycleState("TASK-1", { followup_task_ids: ["TASK-2"] });
    expect(state.phase).toBe("followup_blocked");
    expect(state.blockedByTaskIds).toContain("TASK-2");
  });

  test("empty metadata hydrates to idle default", () => {
    expect(hydrateLifecycleState("TASK-1", {}).phase).toBe("idle");
  });

  test("tolerates a JSON string blob for metadata", () => {
    const state = hydrateLifecycleState("TASK-1", JSON.stringify({ execution_retries: 2, last_run_status: "stopped" }));
    expect(state.executionRetryCount).toBe(2);
    expect(state.phase).toBe("summarizing");
  });
});

// ---------------------------------------------------------------------------
// applyLifecycleEvent (Task 3, Steps 2-4 — effects via injected deps)
// ---------------------------------------------------------------------------

function makeDeps(): jest.Mocked<LifecycleEffectDeps> {
  return {
    startOutcomeSummary: jest.fn((_input: StartOutcomeSummaryInput) => Promise.resolve({ status: "started" })),
    createDecisionGate: jest.fn((_input: CreateDecisionGateInput) => Promise.resolve({})),
    blockOnDecision: jest.fn(),
    createFollowupDependencies: jest.fn(),
    resumeOriginalTask: jest.fn(),
    closeTask: jest.fn(),
    clearDecisionGate: jest.fn(),
    scanUnblockedAutoRunTasks: jest.fn(),
    retryExecution: jest.fn(),
  };
}

const context: LifecycleAdapterContext = {
  request: {} as unknown as Request,
  namespaceId: "ns1",
  orgId: "org1",
  workspaceId: "ws1",
  workspacePath: "/tmp/ws",
};

describe("applyLifecycleEvent", () => {
  test("execution.completed passes the effect's source run + fingerprint AUTHORITATIVELY", async () => {
    // Hydrated metadata points last_run_id at an OLD run; the completed event names
    // a NEW run. The audit must use the event's run, not metadata.last_run_id.
    const state = hydrateLifecycleState("TASK-1", { last_run_id: "run-OLD", last_run_status: "running" });
    const deps = makeDeps();
    const transition = await applyLifecycleEvent({
      state,
      event: { type: "execution.completed", taskId: "TASK-1", runId: "run-NEW", fingerprint: "ok:new" },
      context,
      deps,
    });
    expect(deps.startOutcomeSummary).toHaveBeenCalledTimes(1);
    const call = deps.startOutcomeSummary.mock.calls[0][0];
    expect(call.sourceRunId).toBe("run-NEW");
    expect(call.runFingerprint).toBe("ok:new");
    expect(call.sourceRunId).not.toBe("run-OLD");
    expect(call.namespaceId).toBe("ns1");
    expect(call.orgId).toBe("org1");
    expect(call.request).toBe(context.request);
    expect(transition.state.phase).toBe("summarizing");
  });

  test("summary verdict=close closes the task then scans unblocked tasks", async () => {
    const state = hydrateLifecycleState("TASK-1", { last_run_status: "completed" });
    const deps = makeDeps();
    await applyLifecycleEvent({
      state,
      event: { type: "summary.completed", taskId: "TASK-1", summaryRunId: "sum-1", sourceRunId: "run-1", fingerprint: "completed:f1", verdict: "close" },
      context,
      deps,
    });
    expect(deps.closeTask).toHaveBeenCalledWith("org1", "TASK-1", undefined, "ns1");
    expect(deps.scanUnblockedAutoRunTasks).toHaveBeenCalledWith("org1", "ws1", "ns1");
  });

  test("execution.failed under budget retries and never starts a summary", async () => {
    const state = hydrateLifecycleState("TASK-1", { execution_retries: 0, last_run_status: "running", last_run_id: "run-1" });
    const deps = makeDeps();
    await applyLifecycleEvent({
      state,
      event: { type: "execution.failed", taskId: "TASK-1", runId: "run-1", fingerprint: "failed:1", reason: "boom" },
      context,
      deps,
    });
    expect(deps.retryExecution).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1", taskId: "TASK-1", namespaceId: "ns1", previousRunId: "run-1", reason: "boom" }),
    );
    expect(deps.startOutcomeSummary).not.toHaveBeenCalled();
  });

  test("decision.resolved with no follow-ups resumes the original task", async () => {
    const state = hydrateLifecycleState("TASK-1", {
      lifecycle_phase: "decision_blocked",
      decision_subtask_id: "DEC-1",
      last_run_decision_required: true,
    });
    const deps = makeDeps();
    await applyLifecycleEvent({
      state,
      event: { type: "decision.resolved", taskId: "TASK-1", decisionTaskId: "DEC-1", followUpTaskIds: [] },
      context,
      deps,
    });
    expect(deps.resumeOriginalTask).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1", taskId: "TASK-1", namespaceId: "ns1" }),
    );
    expect(deps.scanUnblockedAutoRunTasks).toHaveBeenCalled();
  });

  test("decision.resolved with follow-ups adds one dependency per follow-up", async () => {
    const state = hydrateLifecycleState("TASK-1", {
      lifecycle_phase: "decision_blocked",
      decision_subtask_id: "DEC-1",
      last_run_decision_required: true,
    });
    const deps = makeDeps();
    await applyLifecycleEvent({
      state,
      event: { type: "decision.resolved", taskId: "TASK-1", decisionTaskId: "DEC-1", followUpTaskIds: ["TASK-2", "TASK-3"] },
      context,
      deps,
    });
    expect(deps.createFollowupDependencies).toHaveBeenCalledTimes(2);
    expect(deps.createFollowupDependencies).toHaveBeenNthCalledWith(1, "org1", "TASK-1", "TASK-2", "ns1", "ws1");
    expect(deps.createFollowupDependencies).toHaveBeenNthCalledWith(2, "org1", "TASK-1", "TASK-3", "ns1", "ws1");
  });

  test("returns the reduced transition (state + effects) to the caller", async () => {
    const state = hydrateLifecycleState("TASK-1", {});
    const deps = makeDeps();
    const t = await applyLifecycleEvent({
      state,
      event: { type: "task.closed", taskId: "TASK-1" },
      context,
      deps,
    });
    expect(t.state.phase).toBe("closed");
    expect(t.effects).toEqual([]);
  });

  test("no effects invokes no dependencies (duplicate completed is a pure no-op)", async () => {
    const state = hydrateLifecycleState("TASK-1", { last_run_id: "run-1", summarized_run_fingerprints: ["ok:1"] });
    const deps = makeDeps();
    await applyLifecycleEvent({
      state,
      event: { type: "execution.completed", taskId: "TASK-1", runId: "run-1", fingerprint: "ok:1" },
      context,
      deps,
    });
    expect(deps.startOutcomeSummary).not.toHaveBeenCalled();
  });

  test("legacy fingerprint-only state does not suppress a different completed run", async () => {
    const state = hydrateLifecycleState("TASK-1", {
      last_run_id: "run-1",
      summarized_run_fingerprints: ["completed:no-terminal-time"],
    });
    const deps = makeDeps();
    await applyLifecycleEvent({
      state,
      event: { type: "execution.completed", taskId: "TASK-1", runId: "run-2", fingerprint: "completed:no-terminal-time" },
      context,
      deps,
    });
    expect(deps.startOutcomeSummary).toHaveBeenCalledWith(
      expect.objectContaining({ sourceRunId: "run-2", runFingerprint: "completed:no-terminal-time" }),
    );
  });
});
