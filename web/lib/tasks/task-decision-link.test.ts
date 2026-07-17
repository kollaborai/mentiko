/**
 * @jest-environment node
 *
 * Unit tests for createTaskDecision (web/lib/tasks/task-decision-link.ts) — the
 * prompt/title framing gate. completion-audit hands a fully composed decision
 * prompt that must NOT be re-wrapped; other sources hand a raw user ask that
 * must be wrapped in the "Decide the implementation approach for… / Original
 * request:" framing.
 */

const createDecision = jest.fn();
const deleteDecision = jest.fn();
const getDecision = jest.fn();
const updateDecision = jest.fn();
const taskCreate = jest.fn();
const taskDelete = jest.fn();
const taskClaimMetadataKeyIfUnset = jest.fn();
const taskGet = jest.fn();
const taskList = jest.fn();
const taskUpdate = jest.fn();
const listWorkspaces = jest.fn();

jest.mock("@/lib/decisions/decision-storage", () => ({
  createDecision: (...a: unknown[]) => createDecision(...a),
  deleteDecision: (...a: unknown[]) => deleteDecision(...a),
  getDecision: (...a: unknown[]) => getDecision(...a),
  updateDecision: (...a: unknown[]) => updateDecision(...a),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskClaimMetadataKeyIfUnset: (...a: unknown[]) => taskClaimMetadataKeyIfUnset(...a),
  taskCreate: (...a: unknown[]) => taskCreate(...a),
  taskDelete: (...a: unknown[]) => taskDelete(...a),
  taskGet: (...a: unknown[]) => taskGet(...a),
  taskList: (...a: unknown[]) => taskList(...a),
  taskUpdate: (...a: unknown[]) => taskUpdate(...a),
}));

jest.mock("@/lib/workspaces/workspace-storage", () => ({
  listWorkspaces: (...a: unknown[]) => listWorkspaces(...a),
}));

import { createTaskDecision } from "./task-decision-link";

let parentMetadata: Record<string, unknown>;
let createdTasks: Map<string, Record<string, unknown>>;
let parentWorkspaceId: string | null;

beforeEach(() => {
  jest.clearAllMocks();
  parentMetadata = {};
  createdTasks = new Map();
  parentWorkspaceId = null;
  listWorkspaces.mockReturnValue([]);
  createDecision.mockReturnValue({ id: "dec-1", status: "intake" });
  getDecision.mockReturnValue(null);
  taskCreate.mockImplementation((_orgId: unknown, fields: Record<string, unknown>) => {
    const task = { id: "DEC-TASK-1", ...fields };
    createdTasks.set(task.id, task);
    return task;
  });
  taskClaimMetadataKeyIfUnset.mockImplementation(
    (_orgId: unknown, _taskId: unknown, key: string, metadata: Record<string, unknown>) => {
      if (parentMetadata[key] !== undefined) return false;
      parentMetadata = { ...parentMetadata, ...metadata };
      return true;
    },
  );
  taskGet.mockImplementation((_orgId: unknown, id: string) => {
    if (id.startsWith("TASK-") || id.startsWith("FEAT-")) {
      return { id, metadata: parentMetadata, workspace_id: parentWorkspaceId };
    }
    return createdTasks.get(id) ?? null;
  });
  taskList.mockImplementation(() => Array.from(createdTasks.values()));
  taskUpdate.mockImplementation((_orgId: unknown, id: string, fields: Record<string, unknown>) => {
    if (id.startsWith("TASK-") || id.startsWith("FEAT-")) {
      parentMetadata = fields.metadata as Record<string, unknown>;
    }
  });
  updateDecision.mockImplementation(
    (_ns: unknown, _org: unknown, _id: unknown, patch: Record<string, unknown>) => ({ id: "dec-1", ...patch }),
  );
});

describe("createTaskDecision prompt framing", () => {
  it("completion-audit: stores the composed prompt verbatim and titles from its first line", async () => {
    const composed =
      "A completed run for task FEAT-019 (Build peer review UI) needs a human decision.\n\nWHY: blockers remain.\n\nDECISION NEEDED: close or fix?";

    await createTaskDecision({
      namespaceId: "default",
      orgId: "default",
      prompt: composed,
      source: "completion-audit",
      parentTaskId: "FEAT-019",
      sourceRunId: "run-source",
      runFingerprint: "completed:f1",
    });

    // the decision record gets the prompt UNCHANGED (no Generate-Task wrapper)
    expect(createDecision).toHaveBeenCalledWith(
      "default",
      "default",
      { prompt: composed, source: "completion-audit" },
      undefined,
    );

    const taskFields = taskCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(taskFields.title).toBe(
      "A completed run for task FEAT-019 (Build peer review UI) needs a human decision.",
    );
    expect(taskFields.description).toBe(composed);
    expect(taskFields.parent_id).toBe("FEAT-019");
    expect(taskFields.metadata).toEqual(expect.objectContaining({
      decision_id: "dec-1",
      decision_source: "completion-audit",
      decision_parent_task_id: "FEAT-019",
      completion_audit_source_run_id: "run-source",
      completion_audit_run_fingerprint: "completed:f1",
    }));
  });

  it("completion-audit: carries the parent task's workspace id as the canonical decision path", async () => {
    parentWorkspaceId = "synthyo";
    listWorkspaces.mockReturnValue([{ id: "synthyo", path: "/Users/malmazan/dev/synthyo" }]);

    await createTaskDecision({
      namespaceId: "default",
      orgId: "default",
      prompt: "A completed run needs a decision.",
      source: "completion-audit",
      parentTaskId: "TASK-162",
      sourceRunId: "run-162",
      runFingerprint: "completed:162",
    });

    expect(createDecision).toHaveBeenCalledWith(
      "default",
      "default",
      expect.objectContaining({ source: "completion-audit" }),
      "/Users/malmazan/dev/synthyo",
    );
    expect(taskCreate.mock.calls[0][1]).toEqual(expect.objectContaining({
      workspace_id: "/Users/malmazan/dev/synthyo",
    }));
  });

  it("task-generate: wraps the raw ask in the decision framing", async () => {
    const raw = "Add SSO to the app";

    await createTaskDecision({
      namespaceId: "default",
      orgId: "default",
      prompt: raw,
      source: "task-generate",
    });

    const passed = (createDecision.mock.calls[0][2] as { prompt: string }).prompt;
    expect(passed).not.toBe(raw);
    expect(passed).toContain("Decide the implementation approach for:");
    expect(passed).toContain("Original request:");
    expect(passed).toContain(raw);

    const taskFields = taskCreate.mock.calls[0][1] as Record<string, unknown>;
    expect(taskFields.title).toContain("Decide the implementation approach for:");
  });

  it("replays one task-generation decision by generation job identity", async () => {
    let decision = { id: "dec-generation", status: "intake" } as Record<string, unknown>;
    createDecision.mockReturnValue(decision);
    getDecision.mockImplementation(() => createdTasks.size > 0 ? decision : null);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => {
      decision = { ...decision, ...patch };
      return decision;
    });
    taskCreate.mockImplementation((_orgId: unknown, fields: Record<string, unknown>) => {
      const task = { id: "DEC-GENERATION-1", ...fields };
      createdTasks.set(task.id, task);
      return task;
    });
    const input = {
      namespaceId: "default",
      orgId: "default",
      prompt: "Choose the storage architecture",
      source: "task-generate",
      generationJobId: "job-generation-1",
    };

    const first = await createTaskDecision(input);
    const replay = await createTaskDecision(input);

    expect(createDecision).toHaveBeenCalledTimes(1);
    expect(taskCreate).toHaveBeenCalledTimes(1);
    expect(first.task.id).toBe("DEC-GENERATION-1");
    expect(replay.task.id).toBe("DEC-GENERATION-1");
    expect(taskCreate.mock.calls[0][1].metadata).toEqual(expect.objectContaining({
      task_generation_job_id: "job-generation-1",
      task_generation_role: "decision",
    }));
  });

  it("creates one completion-audit gate for concurrent calls with the same stable fingerprint", async () => {
    let decision = { id: "dec-stable", status: "intake" } as Record<string, unknown>;
    createDecision.mockReturnValue(decision);
    taskCreate.mockImplementation((_orgId: unknown, fields: Record<string, unknown>) => {
      const task = { id: "DEC-STABLE-1", ...fields };
      createdTasks.set(task.id, task);
      return task;
    });
    getDecision.mockImplementation(() => createdTasks.size > 0 ? decision : null);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => {
      decision = { ...decision, ...patch };
      return decision;
    });

    const input = {
      namespaceId: "default",
      orgId: "default",
      prompt: "A completed run needs a decision.",
      source: "completion-audit",
      parentTaskId: "TASK-009",
      sourceRunId: "run-009",
      runFingerprint: "completed:009",
    };
    const [first, second] = await Promise.all([createTaskDecision(input), createTaskDecision(input)]);

    expect(createDecision).toHaveBeenCalledTimes(1);
    expect(taskCreate).toHaveBeenCalledTimes(1);
    expect(taskClaimMetadataKeyIfUnset.mock.results.filter((result) => result.value === true)).toHaveLength(2);
    expect(first.task.id).toBe("DEC-STABLE-1");
    expect(second.task.id).toBe("DEC-STABLE-1");
    expect(second.decision.id).toBe("dec-stable");
  });

  it("reuses the ledgered decision when task creation fails after createDecision", async () => {
    const decision = { id: "dec-repair", status: "intake" };
    createDecision.mockReturnValue(decision);
    getDecision.mockImplementation(() => parentMetadata ? decision : null);
    updateDecision.mockImplementation(async (_ns, _org, _id, patch) => ({ ...decision, ...patch }));
    taskCreate
      .mockImplementationOnce(() => { throw new Error("task row write failed"); })
      .mockImplementation((_orgId: unknown, fields: Record<string, unknown>) => {
        const task = { id: "DEC-REPAIR-1", ...fields };
        createdTasks.set(task.id, task);
        return task;
      });

    const input = {
      namespaceId: "default",
      orgId: "default",
      prompt: "A completed run needs a decision.",
      source: "completion-audit",
      parentTaskId: "TASK-010",
      sourceRunId: "run-010",
      runFingerprint: "completed:010",
    };

    await expect(createTaskDecision(input)).rejects.toThrow("task row write failed");
    const durableLedger = Object.values(parentMetadata).find((value) =>
      value && typeof value === "object" && (value as Record<string, unknown>).decisionId === "dec-repair",
    ) as Record<string, unknown> | undefined;
    expect(durableLedger).toEqual(expect.objectContaining({
      decisionId: "dec-repair",
      state: "task_create_failed",
    }));
    const repaired = await createTaskDecision(input);

    expect(createDecision).toHaveBeenCalledTimes(1);
    expect(taskCreate).toHaveBeenCalledTimes(2);
    expect(repaired).toMatchObject({
      decision: { id: "dec-repair", taskId: "DEC-REPAIR-1", parentTaskId: "TASK-010" },
      task: { id: "DEC-REPAIR-1" },
    });
    expect(deleteDecision).not.toHaveBeenCalled();
  });
});
