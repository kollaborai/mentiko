/**
 * W1 item 4 — a new chain un-parks the tasks that were waiting for one.
 *
 * @jest-environment node
 */
const taskList = jest.fn();
const taskUpdate = jest.fn();

jest.mock("@/lib/tasks/task-store", () => ({
  taskList: (...a: unknown[]) => taskList(...a),
  taskUpdate: (...a: unknown[]) => taskUpdate(...a),
}));

import { describe, it, expect, beforeEach } from "@jest/globals";
import { reconsiderAttentionRequiredTasks } from "@/lib/tasks/generation-attention-recovery";
import {
  FALLBACK_PARK_CATALOG_UNCHANGED,
  FALLBACK_PARK_FALLBACK_FAILED,
  GENERATION_FALLBACK_STATE_KEY,
} from "@/lib/tasks/generation-exhaustion-fallback";

function parkedTask(id: string, reason: string, metadataOverride: Record<string, unknown> = {}) {
  return {
    id,
    metadata: {
      [GENERATION_FALLBACK_STATE_KEY]: "attention_required",
      generation_attention_reason: reason,
      generation_stop_reason: "deterministic_budget_exhausted",
      generation_rejection_fingerprints: ["fp-1", "fp-2"],
      ...metadataOverride,
    },
  };
}

beforeEach(() => {
  taskList.mockReset();
  taskUpdate.mockReset();
});

describe("reconsiderAttentionRequiredTasks", () => {
  it("releases a task parked only because the catalog had nothing new", async () => {
    taskList.mockReturnValue([parkedTask("TASK-1", FALLBACK_PARK_CATALOG_UNCHANGED)]);

    const result = await reconsiderAttentionRequiredTasks("default", "default");

    expect(result.released).toEqual(["TASK-1"]);
    const written = taskUpdate.mock.calls[0][2].metadata;
    expect(written[GENERATION_FALLBACK_STATE_KEY]).toBeUndefined();
    expect(written.generation_stop_reason).toBeUndefined();
    // Reuse is the only question a new chain answers; generation stays spent.
    expect(written.generation_existing_only).toBe(true);
    expect(written.generation_rejection_fingerprints).toEqual(["fp-1", "fp-2"]);
  });

  it("leaves a task alone when a fallback already looked and found nothing", async () => {
    taskList.mockReturnValue([parkedTask("TASK-2", FALLBACK_PARK_FALLBACK_FAILED)]);

    const result = await reconsiderAttentionRequiredTasks("default", "default");

    expect(result.released).toEqual([]);
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("ignores tasks that are not parked at all", async () => {
    taskList.mockReturnValue([
      { id: "TASK-3", metadata: { auto_run: true } },
      { id: "TASK-4", metadata: { [GENERATION_FALLBACK_STATE_KEY]: "existing_only_pending" } },
    ]);

    expect((await reconsiderAttentionRequiredTasks("default", "default")).released).toEqual([]);
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("reads metadata that was stored as a JSON string", async () => {
    taskList.mockReturnValue([{
      id: "TASK-5",
      metadata: JSON.stringify(parkedTask("TASK-5", FALLBACK_PARK_CATALOG_UNCHANGED).metadata),
    }]);

    expect((await reconsiderAttentionRequiredTasks("default", "default")).released).toEqual(["TASK-5"]);
  });

  it("survives unreadable metadata instead of taking the whole sweep down", async () => {
    taskList.mockReturnValue([
      { id: "TASK-6", metadata: "{not json" },
      { id: "TASK-7", metadata: null },
      parkedTask("TASK-8", FALLBACK_PARK_CATALOG_UNCHANGED),
    ]);

    expect((await reconsiderAttentionRequiredTasks("default", "default")).released).toEqual(["TASK-8"]);
  });

  it("keeps going when one task fails to release", async () => {
    taskList.mockReturnValue([
      parkedTask("TASK-9", FALLBACK_PARK_CATALOG_UNCHANGED),
      parkedTask("TASK-10", FALLBACK_PARK_CATALOG_UNCHANGED),
    ]);
    taskUpdate.mockImplementationOnce(() => { throw new Error("row locked"); });

    expect((await reconsiderAttentionRequiredTasks("default", "default")).released).toEqual(["TASK-10"]);
  });

  it("returns empty rather than throwing when the task store is unreadable", async () => {
    taskList.mockImplementation(() => { throw new Error("db gone"); });

    expect((await reconsiderAttentionRequiredTasks("default", "default")).released).toEqual([]);
  });
});
