/** @jest-environment node */
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDebugStep, clearDebugState, loadDebugState, mutateDebugState, parseDebugState, validateDebugState, validateRawDebugState } from "@/lib/runs/debug-state-store";

describe("debug state store", () => {
  it("keeps raw-file and normalized validation separate", () => {
    expect(validateRawDebugState("").issues[0]).toMatchObject({ code: "empty-file" });
    expect(validateRawDebugState("[]").issues[0]).toMatchObject({ code: "invalid-root" });
    expect(validateRawDebugState('{"steps":[]}')).toMatchObject({ valid: true });
    expect(validateDebugState({ steps: [{ round: -1 }] }).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "steps[0].round" }),
    ]));
    expect(parseDebugState('{"steps":[]}')).toEqual({ steps: [] });
  });

  it("atomically appends steps and mutates actions through one record owner", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-debug-state-"));
    const first = appendDebugStep({ runId: "run-debug", agentId: "writer", agentName: "Writer", session: "writer-session", round: 1, status: "running", output: "\u001b[31mready\u001b[0m\nhello" }, root);
    expect(first).toMatchObject({ run_id: "run-debug", current_step: 0, steps: [{ output: "ready hello" }] });
    const second = mutateDebugState({ runId: "run-debug", action: "step" }, root);
    expect(second).toMatchObject({ status: "stepping", current_step: 1, last_action: "step" });
    const skipped = mutateDebugState({ runId: "run-debug", action: "skip", stepIndex: 0 }, root);
    expect(skipped.steps[0]).toMatchObject({ status: "skipped" });
    expect(JSON.parse(readFileSync(join(root, "run-debug.json"), "utf8"))).toEqual(skipped);
    expect(loadDebugState("run-debug", root)).toEqual(skipped);
    clearDebugState("run-debug", root);
    expect(loadDebugState("run-debug", root)).toBeNull();
  });

  it("rejects symlinked records and identity mismatches", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-debug-state-links-"));
    const target = join(root, "target.json");
    writeFileSync(target, '{"run_id":"run-debug","steps":[]}\n');
    symlinkSync(target, join(root, "run-debug.json"));
    expect(() => loadDebugState("run-debug", root)).toThrow(/regular file/i);
    expect(() => parseDebugState('{"run_id":"run-other","steps":[]}', "run-debug")).toThrow(/does not match/i);
  });
});
