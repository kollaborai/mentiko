/**
 * @jest-environment node
 *
 * Unit tests for applyCompletionAudit (web/lib/tasks/completion-audit-apply.ts).
 * All collaborators are mocked. The function under test is exercised directly.
 */

// Module-local mock functions — defined before jest.mock so factories can
// close over them. jest.mock() is hoisted by Jest's transform; the factories
// run lazily (at first require), by which point these consts are initialised.
const taskClose = jest.fn();
const taskUpdate = jest.fn();
const taskMergeMeta = jest.fn();
const taskAddComment = jest.fn();
const taskList = jest.fn();
const taskAddDep = jest.fn();
const taskRemoveDep = jest.fn();
const taskGet = jest.fn();
const createTaskDecision = jest.fn();
const createNotification = jest.fn();
const startDecisionResearch = jest.fn();
const updateDecision = jest.fn();

jest.mock("@/lib/tasks/task-store", () => ({
  taskClose: (...a: unknown[]) => taskClose(...a),
  taskUpdate: (...a: unknown[]) => taskUpdate(...a),
  taskMergeMeta: (...a: unknown[]) => taskMergeMeta(...a),
  taskAddComment: (...a: unknown[]) => taskAddComment(...a),
  taskList: (...a: unknown[]) => taskList(...a),
  taskAddDep: (...a: unknown[]) => taskAddDep(...a),
  taskRemoveDep: (...a: unknown[]) => taskRemoveDep(...a),
  taskGet: (...a: unknown[]) => taskGet(...a),
}));

jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: (...a: unknown[]) => createTaskDecision(...a),
}));

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));

jest.mock("@/lib/decisions/decision-storage", () => ({
  updateDecision: (...a: unknown[]) => updateDecision(...a),
}));

// Covers the `await import("@/lib/decisions/decision-chain-dispatch")` inside
// createDecisionSubtask — Jest intercepts dynamic imports through the same
// module registry that jest.mock() patches.
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionResearch: (...a: unknown[]) => startDecisionResearch(...a),
}));

// scan_unblocked_auto_run_tasks fires a real fetch() to localhost in prod (see
// lib/runs/auto-run-service.ts) -- mock it so tests never make a real network
// call, and so the "close" tests can assert the next-task nudge actually fired.
const triggerAutoRunScan = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/runs/auto-run-service", () => ({
  triggerAutoRunScan: (...a: unknown[]) => triggerAutoRunScan(...a),
}));

import { applyCompletionAudit, supersedeStaleCompletionAuditDecision } from "./completion-audit-apply";
import type { CompletionAudit } from "./completion-audit-schema";
import type { TaskRecord } from "./task-store-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "TASK-42",
    org_id: "default",
    workspace_id: "/repo",
    title: "Integrate GitHub OAuth",
    description: "Add GitHub OAuth to the login flow",
    status: "in_progress",
    priority: 2,
    issue_type: "task",
    owner: "user-1",
    assignee: null,
    parent_id: "EPIC-001",
    labels: [],
    metadata: {},
    acceptance_criteria: "User can log in with GitHub",
    design: null,
    notes: null,
    estimated_minutes: null,
    due_at: null,
    created_at: "2026-01-01T00:00:00Z",
    created_by: "user-1",
    updated_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

const BASE_CONTEXT = {
  request: {} as Request,
  namespaceId: "default",
  orgId: "default",
  workspacePath: "/repo",
};

function makeInput(
  task: TaskRecord,
  audit: CompletionAudit,
  metadata: Record<string, unknown> = {},
  runId = "run-abc",
) {
  return { ...BASE_CONTEXT, task, audit, runId, metadata };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  taskList.mockReturnValue([]);
  // Default: the lifecycle's close effect (taskClose, mocked above) actually
  // landed -- most "close" tests want the happy path. Tests exercising the
  // pending_close half-state override this per-test.
  taskGet.mockReturnValue(makeTask({ status: "closed" }));
  // Default: createTaskDecision returns a fake {decision, task}.
  createTaskDecision.mockResolvedValue({
    decision: { id: "decision-x1" },
    task: { id: "DEC-1" },
  });
  startDecisionResearch.mockResolvedValue(undefined);
  updateDecision.mockResolvedValue({ id: "decision-024", status: "superseded" });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyCompletionAudit", () => {
  // 1. verdict "close"
  it("close: closes the task, merges last_audit_verdict=close, does not create a decision", async () => {
    const task = makeTask();
    const audit: CompletionAudit = { verdict: "close", reason: "All acceptance criteria met." };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit),
      runFingerprint: "completed:t1",
    });

    expect(result.action).toBe("closed");

    expect(taskClose).toHaveBeenCalledTimes(1);
    expect(taskClose).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      "All acceptance criteria met.",
      "default",
    );

    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({ last_audit_verdict: "close" }),
      "default",
    );

    expect(createTaskDecision).not.toHaveBeenCalled();
    expect(startDecisionResearch).not.toHaveBeenCalled();
  });

  it("close: fires the dependents-only auto-run nudge for the completed task (surgical scan_unblocked; storm-safe via getDirectDependentAutoRunCandidates + the terminal rule, replacing the disabled full-scan nudge that caused the TASK-097 re-run storm)", async () => {
    const task = makeTask();
    const audit: CompletionAudit = { verdict: "close", reason: "All acceptance criteria met." };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit),
      runFingerprint: "completed:t1",
    });

    expect(result.action).toBe("closed");
    // dependents-only: the completed task's id is passed so the route scans only ITS
    // direct dependents, not the whole org.
    expect(triggerAutoRunScan).toHaveBeenCalledWith(expect.any(String), expect.any(String), task.id);
  });

  it("close: replaces stale running execution metadata with the audited completed source run", async () => {
    const task = makeTask();
    const audit: CompletionAudit = { verdict: "close", reason: "All acceptance criteria met." };

    await applyCompletionAudit({
      ...makeInput(task, audit, {
        last_run_id: "run-duplicate",
        last_run_status: "running",
        last_run_started: "2026-07-08T01:40:21.416Z",
      }),
      runFingerprint: "completed:t1",
    });

    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        last_audit_verdict: "close",
        last_run_id: "run-abc",
        last_run_status: "completed",
        last_run_started: undefined,
        last_run_completed: "t1",
        last_run_error: undefined,
        last_run_blocked_reason: undefined,
        last_run_agents: undefined,
      }),
      "default",
    );
  });

  it("close: repairs stale execution metadata when the same close audit is replayed", async () => {
    const task = makeTask({ status: "closed", closed_at: "2026-07-08T01:45:38.016Z" });
    const audit: CompletionAudit = { verdict: "close", reason: "All acceptance criteria met." };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit, {
        completion_audit_run_id: "run-abc",
        completion_audit_run_fingerprint: "completed:t1",
        completion_audit_apply_status: "applied",
        last_run_id: "run-duplicate",
        last_run_status: "running",
        last_run_started: "2026-07-08T01:40:21.416Z",
      }),
      runFingerprint: "completed:t1",
    });

    expect(result).toEqual({
      action: "skipped",
      detail: "audit already applied for this run; repaired execution metadata",
    });
    expect(taskClose).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        last_audit_verdict: "close",
        last_run_id: "run-abc",
        last_run_status: "completed",
        last_run_started: undefined,
        last_run_completed: "t1",
        last_run_error: undefined,
      }),
      "default",
    );
  });

  // 2. verdict "decision"
  it("decision: creates decision subtask with parentTaskId=task.id, starts research, merges decision metadata, returns decision_created", async () => {
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Unclear whether to add SSO support.",
      decision: { prompt: "Should we add SSO?", options_hint: "Yes / No / Defer" },
    };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit),
      runFingerprint: "completed:t1",
    });

    expect(result.action).toBe("decision_created");
    expect(result.decisionTaskId).toBe("DEC-1");

    expect(createTaskDecision).toHaveBeenCalledTimes(1);
    expect(createTaskDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: "TASK-42",
        sourceRunId: "run-abc",
        runFingerprint: "completed:t1",
      }),
    );

    expect(startDecisionResearch).toHaveBeenCalledTimes(1);

    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        last_run_decision_required: true,
        decision_subtask_id: "DEC-1",
        gated_run_fingerprints: ["run-abc::completed:t1"],
        lifecycle_phase: "decision_blocked",
        last_audit_verdict: "decision",
        last_run_id: "run-abc",
        last_run_status: "completed",
        last_run_completed: "t1",
        last_run_blocked_reason: undefined,
        last_run_agents: undefined,
      }),
      "default",
    );
    expect(taskAddDep).toHaveBeenCalledWith("default", "TASK-42", "DEC-1", "default", "/repo");
  });

  it("decision: skips duplicate completion-audit DEC tasks for the same parent/source run/fingerprint", async () => {
    taskList.mockReturnValue([
      makeTask({
        id: "DEC-777",
        parent_id: "TASK-42",
        issue_type: "decision",
        status: "open",
        metadata: {
          decision_source: "completion-audit",
          completion_audit_source_run_id: "run-abc",
          completion_audit_run_fingerprint: "completed:t1",
        },
      }),
    ]);
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Needs human input.",
      decision: { prompt: "Which path?" },
    };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit, {}, "run-abc"),
      runFingerprint: "completed:t1",
    });

    expect(result).toEqual({
      action: "skipped",
      detail: "completion-audit decision already exists for this run",
      decisionTaskId: "DEC-777",
    });
    expect(createTaskDecision).not.toHaveBeenCalled();
    expect(startDecisionResearch).not.toHaveBeenCalled();
  });

  it("decision: repairs stale execution provenance when the same applied audit is replayed", async () => {
    const task = makeTask({ status: "blocked" });
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Needs human input.",
      decision: { prompt: "Which path?" },
    };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit, {
        completion_audit_run_id: "run-abc",
        completion_audit_run_fingerprint: "completed:t1",
        completion_audit_apply_status: "applied",
        last_audit_verdict: "decision",
        last_run_id: "run-duplicate",
        last_run_status: "blocked",
        last_run_blocked_reason: "startup_recovery:unknown",
        last_run_agents: "inspector|cancelled",
      }),
      runFingerprint: "completed:t1",
    });

    expect(result).toEqual({
      action: "skipped",
      detail: "audit already applied for this run; repaired execution metadata",
    });
    expect(createTaskDecision).not.toHaveBeenCalled();
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        last_audit_verdict: "decision",
        last_run_id: "run-abc",
        last_run_status: "completed",
        last_run_completed: "t1",
        last_run_blocked_reason: undefined,
        last_run_agents: undefined,
        last_run_decision_required: true,
      }),
      "default",
    );
  });

  // 3. verdict "retry" under cap
  it("retry (under cap): applies task_tweaks, adds comment, bumps auto_run_retries, clears last_run_id, returns retry_scheduled", async () => {
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "retry",
      reason: "Unit tests are missing.",
      retry: {
        guidance: "Add tests for the login flow.",
        comments: ["Check coverage before closing"],
        task_tweaks: {
          title: "Integrate GitHub OAuth + tests",
          acceptance_criteria: "100% branch coverage on auth module",
        },
      },
    };
    const result = await applyCompletionAudit(makeInput(task, audit, {
      auto_run_retries: 99,
      execution_retries: 1,
    }));

    expect(result.action).toBe("retry_scheduled");

    // taskUpdate must include the tweaks
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        title: "Integrate GitHub OAuth + tests",
        acceptance_criteria: "100% branch coverage on auth module",
      }),
      "default",
    );

    // A comment from the auditor is attached
    expect(taskAddComment).toHaveBeenCalledTimes(1);
    expect(taskAddComment).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      "completion-auditor",
      expect.stringContaining("REOPENED FOR RETRY"),
      "default",
    );

    // Metadata must clear last_run_id and bump retries
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        last_run_id: undefined,
        execution_retries: 2,
        lifecycle_phase: "retrying",
        last_audit_verdict: "retry",
      }),
      "default",
    );

    expect(createTaskDecision).not.toHaveBeenCalled();
  });

  // 4. verdict "retry" at or over shared execution retry limit → escalate
  it("retry at execution retry limit (execution_retries >= 2): escalates to decision subtask instead of retrying, returns escalated_decision", async () => {
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "retry",
      reason: "Still failing after multiple attempts.",
      retry: { guidance: "Root-cause the underlying problem." },
    };
    // exactly at cap
    const result = await applyCompletionAudit({
      ...makeInput(task, audit, {
        auto_run_retries: 0,
        execution_retries: 2,
      }),
      runFingerprint: "failed:t2",
    });

    expect(result.action).toBe("escalated_decision");
    expect(result.decisionTaskId).toBe("DEC-1");

    // escalation path goes through createDecisionSubtask
    expect(createTaskDecision).toHaveBeenCalledTimes(1);
    expect(createTaskDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        runFingerprint: "failed:t2",
      }),
    );

    // must NOT have attempted a normal retry; the only status update is the
    // decision-gate block applied by createDecisionSubtask.
    expect(taskUpdate).toHaveBeenCalledWith("default", "TASK-42", { status: "blocked" }, "default");
    expect(taskAddComment).not.toHaveBeenCalled();
  });

  // 5. idempotency
  it("skips entirely when the same close audit already has canonical execution metadata", async () => {
    // Task is genuinely closed already: a re-poll of an applied close audit must
    // be a true no-op. (If it were still open, that's the half-state bug covered
    // by the next test -- we must re-close, not skip.)
    const task = makeTask({ status: "closed" });
    const audit: CompletionAudit = { verdict: "close", reason: "Done." };
    // metadata already records this run as processed
    const result = await applyCompletionAudit(
      {
        ...makeInput(task, audit, {
          completion_audit_run_id: "run-abc",
          completion_audit_run_fingerprint: "completed:t1",
          completion_audit_apply_status: "applied",
          last_run_id: "run-abc",
          last_run_status: "completed",
          last_run_completed: "t1",
        }, "run-abc"),
        runFingerprint: "completed:t1",
      },
    );

    expect(result.action).toBe("skipped");

    // absolutely nothing should have been touched
    expect(taskClose).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(taskMergeMeta).not.toHaveBeenCalled();
    expect(taskAddComment).not.toHaveBeenCalled();
    expect(createTaskDecision).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("re-closes when a prior close was applied but the task got reopened (half-state)", async () => {
    // The TASK-095 bug: completion_audit_apply_status="applied" for a close
    // verdict, but a later reopen (reconcile / run-status flap) clobbered the
    // close so the task is open again. The apply flag lies -- re-run the close
    // instead of skipping forever.
    const task = makeTask({ status: "in_progress" });
    const audit: CompletionAudit = { verdict: "close", reason: "Done." };
    const result = await applyCompletionAudit({
      ...makeInput(task, audit, {
        completion_audit_run_id: "run-abc",
        completion_audit_run_fingerprint: "completed:t1",
        completion_audit_apply_status: "applied",
        last_run_id: "run-abc",
        last_run_status: "completed",
        last_run_completed: "t1",
      }, "run-abc"),
      runFingerprint: "completed:t1",
    });

    expect(result.action).toBe("closed");
    expect(taskClose).toHaveBeenCalled();
    // The re-close actually landed this time (taskGet confirms "closed" per the
    // default mock) -- so the apply flag correctly flips back to "applied",
    // not stuck at pending_close forever.
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({ completion_audit_apply_status: "applied" }),
      "default",
    );
  });

  it("close: writes pending_close (not applied) when the lifecycle close verdict does not actually land", async () => {
    // If applySummaryLifecycle's close effect silently no-ops (or the task
    // flips right back via a concurrent write), taskGet-after-the-fact must
    // catch it: marking "applied" here is the TASK-095 lie that leaves a task
    // open forever, because the idempotency guard then skips every future audit.
    taskGet.mockReturnValue(makeTask({ status: "in_progress" }));
    const task = makeTask();
    const audit: CompletionAudit = { verdict: "close", reason: "All acceptance criteria met." };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit),
      runFingerprint: "completed:t1",
    });

    expect(result.action).toBe("closed");
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        last_audit_verdict: "close",
        completion_audit_apply_status: "pending_close",
      }),
      "default",
    );
  });

  // 6. research failure is non-fatal
  it("decision: returns decision_created even when startDecisionResearch throws", async () => {
    startDecisionResearch.mockRejectedValue(new Error("chain service unavailable"));

    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Needs human input before proceeding.",
      decision: { prompt: "What is the next step?" },
    };

    const result = await applyCompletionAudit(makeInput(task, audit));

    // decision subtask was still created
    expect(result.action).toBe("decision_created");
    expect(result.decisionTaskId).toBe("DEC-1");
    expect(createTaskDecision).toHaveBeenCalledTimes(1);

    // metadata merge still happened
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({ decision_subtask_id: "DEC-1" }),
      "default",
    );
  });

  // 7. regression: FEAT-014 stayed "closed" even after the auditor flagged
  // decision_required and spawned a decision subtask, because this path never
  // touched task.status. A "decision" verdict means the outcome is NOT
  // settled, so a closed task must be reopened.
  it("decision: reopens a closed task to 'blocked' before creating the decision subtask", async () => {
    const task = makeTask({ status: "closed" });
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Chain produced a specification, not working code.",
      decision: { prompt: "Proceed to implementation or refine the spec?" },
    };

    const result = await applyCompletionAudit(makeInput(task, audit));

    expect(result.action).toBe("decision_created");
    expect(taskUpdate).toHaveBeenCalledWith("default", "TASK-42", { status: "blocked" }, "default");
  });

  it("decision: blocks the original task when it is still in progress", async () => {
    const task = makeTask({ status: "in_progress" });
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Needs human input.",
      decision: { prompt: "Which way?" },
    };

    await applyCompletionAudit(makeInput(task, audit));

    expect(taskUpdate).toHaveBeenCalledWith("default", "TASK-42", { status: "blocked" }, "default");
  });

  it("decision: persists parent lifecycle metadata before dependency and research side effects", async () => {
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Needs human input.",
      decision: { prompt: "Which way?" },
    };

    await applyCompletionAudit({
      ...makeInput(task, audit),
      runFingerprint: "completed:t1",
    });

    const lifecycleMergeOrder = taskMergeMeta.mock.calls.findIndex((call) => {
      const meta = call[2] as Record<string, unknown>;
      return meta.lifecycle_phase === "decision_blocked" && meta.decision_subtask_id === "DEC-1";
    });
    expect(lifecycleMergeOrder).toBeGreaterThanOrEqual(0);

    const mergeCallOrder = taskMergeMeta.mock.invocationCallOrder[lifecycleMergeOrder];
    expect(mergeCallOrder).toBeLessThan(taskAddDep.mock.invocationCallOrder[0]);
    expect(mergeCallOrder).toBeLessThan(taskUpdate.mock.invocationCallOrder[0]);
    expect(mergeCallOrder).toBeLessThan(startDecisionResearch.mock.invocationCallOrder[0]);
  });

  it("does not skip when only an audit claim exists for the same run", async () => {
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Needs human input.",
      decision: { prompt: "Which path should we take?" },
    };

    const result = await applyCompletionAudit(
      {
        ...makeInput(task, audit, {
          completion_audit_claimed_run_id: "run-abc",
          completion_audit_claimed_run_fingerprint: "completed:t1",
        }, "run-abc"),
        runFingerprint: "completed:t1",
      },
    );

    expect(result.action).toBe("decision_created");
    expect(createTaskDecision).toHaveBeenCalledTimes(1);
  });

  it("close: closes stale completion-audit decision subtasks as superseded", async () => {
    taskList.mockReturnValue([
      makeTask({
        id: "DEC-024",
        parent_id: "TASK-42",
        issue_type: "decision",
        status: "open",
        metadata: { decision_source: "completion-audit", decision_id: "decision-024" },
      }),
      makeTask({
        id: "DEC-other",
        parent_id: "TASK-99",
        issue_type: "decision",
        status: "open",
        metadata: { decision_source: "completion-audit" },
      }),
    ]);
    const task = makeTask();
    const audit: CompletionAudit = { verdict: "close", reason: "Later run produced files." };

    const result = await applyCompletionAudit({
      ...makeInput(task, audit),
      runFingerprint: "completed:t2",
    });

    expect(result.action).toBe("closed");
    expect(taskClose).toHaveBeenCalledWith(
      "default",
      "DEC-024",
      "Superseded by later completion audit evidence.",
      "default",
    );
    expect(taskClose).not.toHaveBeenCalledWith(
      "default",
      "DEC-other",
      expect.anything(),
      "default",
    );
    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "decision-024",
      { status: "superseded" },
      "/repo",
    );
    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        lifecycle_phase: "closing",
        superseded_decision_subtask_ids: ["DEC-024"],
        completion_audit_run_fingerprint: "completed:t2",
      }),
      "default",
    );
  });

  it("supersedes a stale decision gate without leaving the parent blocked", async () => {
    const parent = makeTask({
      id: "BUG-002",
      status: "blocked",
      metadata: {
        lifecycle_phase: "retrying",
        last_run_status: "retry_requested",
        last_run_decision_required: false,
        decision_subtask_id: "DEC-001",
        gated_run_fingerprints: ["run-old::running:no-terminal-time"],
      },
    });
    const decision = makeTask({
      id: "DEC-001",
      parent_id: "BUG-002",
      issue_type: "decision",
      metadata: {
        decision_source: "completion-audit",
        decision_id: "decision-001",
      },
    });

    await supersedeStaleCompletionAuditDecision({
      namespaceId: "default",
      orgId: "default",
      parentTask: parent,
      decisionTask: decision,
      reason: "source fingerprint changed",
      workspacePath: "/repo",
    });

    expect(taskClose).toHaveBeenCalledWith("default", "DEC-001", "source fingerprint changed", "default");
    expect(taskRemoveDep).toHaveBeenCalledWith("default", "BUG-002", "DEC-001", "default");
    expect(taskUpdate).toHaveBeenCalledWith(
      "default",
      "BUG-002",
      {
        status: "open",
        metadata: expect.objectContaining({
          lifecycle_phase: "retrying",
          last_run_decision_required: false,
          gated_run_fingerprints: [],
          completion_audit_apply_status: "superseded",
          task_outcome_summary_status: "superseded",
          last_audit_verdict: "superseded",
          superseded_decision_subtask_ids: ["DEC-001"],
        }),
      },
      "default",
    );
    const parentUpdate = taskUpdate.mock.calls.find((call) => call[1] === "BUG-002")?.[2];
    expect(parentUpdate.metadata.decision_subtask_id).toBeUndefined();
    expect(updateDecision).toHaveBeenCalledWith(
      "default",
      "default",
      "decision-001",
      { status: "superseded" },
      "/repo",
    );
  });
});
