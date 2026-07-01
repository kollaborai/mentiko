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
const updateDecision = jest.fn();
const taskCreate = jest.fn();

jest.mock("@/lib/decisions/decision-storage", () => ({
  createDecision: (...a: unknown[]) => createDecision(...a),
  updateDecision: (...a: unknown[]) => updateDecision(...a),
}));

jest.mock("@/lib/tasks/task-store", () => ({
  taskCreate: (...a: unknown[]) => taskCreate(...a),
}));

import { createTaskDecision } from "./task-decision-link";

beforeEach(() => {
  jest.clearAllMocks();
  createDecision.mockReturnValue({ id: "dec-1", status: "intake" });
  taskCreate.mockReturnValue({ id: "DEC-TASK-1" });
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
});
