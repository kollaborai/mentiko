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
const createTaskDecision = jest.fn();
const createNotification = jest.fn();
const startDecisionResearch = jest.fn();

jest.mock("@/lib/tasks/task-store", () => ({
  taskClose: (...a: unknown[]) => taskClose(...a),
  taskUpdate: (...a: unknown[]) => taskUpdate(...a),
  taskMergeMeta: (...a: unknown[]) => taskMergeMeta(...a),
  taskAddComment: (...a: unknown[]) => taskAddComment(...a),
}));

jest.mock("@/lib/tasks/task-decision-link", () => ({
  createTaskDecision: (...a: unknown[]) => createTaskDecision(...a),
}));

jest.mock("@/lib/notifications/notification-server", () => ({
  createNotification: (...a: unknown[]) => createNotification(...a),
}));

// Covers the `await import("@/lib/decisions/decision-chain-dispatch")` inside
// createDecisionSubtask — Jest intercepts dynamic imports through the same
// module registry that jest.mock() patches.
jest.mock("@/lib/decisions/decision-chain-dispatch", () => ({
  startDecisionResearch: (...a: unknown[]) => startDecisionResearch(...a),
}));

import { applyCompletionAudit } from "./completion-audit-apply";
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
  // Default: createTaskDecision returns a fake {decision, task}.
  createTaskDecision.mockResolvedValue({
    decision: { id: "decision-x1" },
    task: { id: "DEC-1" },
  });
  startDecisionResearch.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyCompletionAudit", () => {
  // 1. verdict "close"
  it("close: closes the task, merges last_audit_verdict=close, does not create a decision", async () => {
    const task = makeTask();
    const audit: CompletionAudit = { verdict: "close", reason: "All acceptance criteria met." };

    const result = await applyCompletionAudit(makeInput(task, audit));

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

  // 2. verdict "decision"
  it("decision: creates decision subtask with parentTaskId=task.id, starts research, merges decision metadata, returns decision_created", async () => {
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Unclear whether to add SSO support.",
      decision: { prompt: "Should we add SSO?", options_hint: "Yes / No / Defer" },
    };

    const result = await applyCompletionAudit(makeInput(task, audit));

    expect(result.action).toBe("decision_created");
    expect(result.decisionTaskId).toBe("DEC-1");

    expect(createTaskDecision).toHaveBeenCalledTimes(1);
    expect(createTaskDecision).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: "TASK-42" }),
    );

    expect(startDecisionResearch).toHaveBeenCalledTimes(1);

    expect(taskMergeMeta).toHaveBeenCalledWith(
      "default",
      "TASK-42",
      expect.objectContaining({
        last_run_decision_required: true,
        decision_subtask_id: "DEC-1",
        last_audit_verdict: "decision",
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
    // auto_run_retries: 1 — under RETRY_CAP (2)
    const result = await applyCompletionAudit(makeInput(task, audit, { auto_run_retries: 1 }));

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
        auto_run_retries: 2,
        last_audit_verdict: "retry",
      }),
      "default",
    );

    expect(createTaskDecision).not.toHaveBeenCalled();
  });

  // 4. verdict "retry" at or over RETRY_CAP → escalate
  it("retry at RETRY_CAP (auto_run_retries >= 2): escalates to decision subtask instead of retrying, returns escalated_decision", async () => {
    const task = makeTask();
    const audit: CompletionAudit = {
      verdict: "retry",
      reason: "Still failing after multiple attempts.",
      retry: { guidance: "Root-cause the underlying problem." },
    };
    // exactly at cap
    const result = await applyCompletionAudit(makeInput(task, audit, { auto_run_retries: 2 }));

    expect(result.action).toBe("escalated_decision");
    expect(result.decisionTaskId).toBe("DEC-1");

    // escalation path goes through createDecisionSubtask
    expect(createTaskDecision).toHaveBeenCalledTimes(1);

    // must NOT have attempted a normal retry
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(taskAddComment).not.toHaveBeenCalled();
  });

  // 5. idempotency
  it("skips entirely when completion_audit_run_id already matches the current runId", async () => {
    const task = makeTask();
    const audit: CompletionAudit = { verdict: "close", reason: "Done." };
    // metadata already records this run as processed
    const result = await applyCompletionAudit(
      makeInput(task, audit, { completion_audit_run_id: "run-abc" }, "run-abc"),
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

  it("decision: does not touch status when the task is already open", async () => {
    const task = makeTask({ status: "in_progress" });
    const audit: CompletionAudit = {
      verdict: "decision",
      reason: "Needs human input.",
      decision: { prompt: "Which way?" },
    };

    await applyCompletionAudit(makeInput(task, audit));

    expect(taskUpdate).not.toHaveBeenCalled();
  });
});
