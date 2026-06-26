import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCompletionPipeline } from "@/lib/runner-v2/completion-pipeline";
import { readLoopState, writeLoopState } from "@/lib/runner-v2/loop-state";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

function runDir() {
  return mkdtempSync(join(tmpdir(), "runner-v2-completion-pipeline-"));
}

function seedRun(dir: string) {
  const file = join(dir, "run.json");
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(file, () => ({
    ...run,
    id: "run-123",
    status: "running",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
    sessions: ["writer-run-123"],
  }));
  return file;
}

describe("runner-v2 completion pipeline", () => {
  it("records loop visit and round after a routable completion", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);

    const result = runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
      maxRounds: 3,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: {
        action: "route",
        loopGuard: { action: "continue", visitKey: "writer:draft-ready", round: 1 },
      },
      loopStateBefore: { visited: [], round: 1 },
      loopStateAfter: { visited: ["writer:draft-ready"], round: 1 },
    });
    expect(readLoopState(dir)).toEqual({ visited: ["writer:draft-ready"], round: 1 });
  });

  it("uses persisted loop state to complete repeated agent/event visits", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);
    writeLoopState(dir, { visited: ["writer:draft-ready"], round: 1 });

    const result = runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      agent: { id: "writer", emits: "draft-ready" },
      chain: {
        agents: [
          { id: "writer", emits: "draft-ready" },
          { id: "reviewer", triggers: ["draft-ready"] },
        ],
      },
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
      maxRounds: 3,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: {
        action: "loop-complete",
        loopGuard: { visitKey: "writer:draft-ready" },
      },
      loopStateBefore: { visited: ["writer:draft-ready"], round: 1 },
    });
    expect(result.loopStateAfter).toBeUndefined();
    expect(readRunJson(runJsonPath).status).toBe("completed");
  });

  it("records the stop round when max rounds are exceeded", () => {
    const dir = runDir();
    const runJsonPath = seedRun(dir);
    writeLoopState(dir, { visited: [], round: 3 });

    const result = runCompletionPipeline({
      runDir: dir,
      runJsonPath,
      runId: "run-123",
      agent: { id: "writer", emits: "revise" },
      chain: {
        agents: [
          { id: "writer", emits: "revise" },
          { id: "writer", triggers: ["revise"] },
        ],
      },
      events: ["event: revise\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n"],
      maxRounds: 3,
      now: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      decision: {
        action: "max-rounds-stop",
        loopGuard: { visitKey: "writer:revise", round: 4 },
      },
      loopStateAfter: { visited: ["writer:revise"], round: 4 },
    });
    expect(readRunJson(runJsonPath).status).toBe("stopped");
  });
});
