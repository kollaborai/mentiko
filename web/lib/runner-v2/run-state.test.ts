import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  addRunSession,
  createRunRecord,
  readRunJson,
  updateRunAgent,
  updateRunJson,
  updateRunStatus,
} from "./run-state";

describe("runner-v2 run-state", () => {
  function runPath() {
    return join(mkdtempSync(join(tmpdir(), "runner-v2-run-state-")), "run.json");
  }

  it("creates cli-compatible pending run records", () => {
    const run = createRunRecord({
      chainName: "audit chain",
      goal: "audit idle watcher",
      parentRunId: "run-parent",
      taskId: "task-1",
      workspacePath: "/tmp/work",
    });

    expect(run.id).toMatch(/^run-\d{13}-[a-f0-9]{8}$/);
    expect(run.status).toBe("pending");
    expect(run.chain).toBe("audit chain");
    expect(run.goal).toBe("audit idle watcher");
    expect(run.parent_run_id).toBe("run-parent");
    expect(run.workspacePath).toBe("/tmp/work");
    expect(run.taskId).toBe("task-1");
    expect(run.sessions).toEqual([]);
    expect(run.agents).toEqual([]);
  });

  it("re-reads and writes run.json through the existing lock helper", () => {
    const file = runPath();
    const run = createRunRecord({ chainName: "chain", goal: "goal" });
    updateRunJson(file, () => run);

    updateRunJson(file, (current) => {
      expect(current).toBeDefined();
      return {
        ...current!,
        status: "running",
        extra: "kept",
      };
    });

    expect(readRunJson(file)).toMatchObject({
      id: run.id,
      status: "running",
      extra: "kept",
    });
    expect(readFileSync(file, "utf-8")).toContain('"status": "running"');
  });

  it("marks terminal run status with completed once and keeps existing completion time", () => {
    const file = runPath();
    const run = createRunRecord({ chainName: "chain", goal: "goal" });
    updateRunJson(file, () => ({ ...run, completed: "2026-06-25T00:00:00Z" }));

    const updated = updateRunStatus(file, "failed", "agent missing declared event");

    expect(updated.status).toBe("failed");
    expect(updated.status_message).toBe("agent missing declared event");
    expect(updated.completed).toBe("2026-06-25T00:00:00Z");
  });

  it("replaces a failed completion timestamp once during successful recovery, then keeps it stable", () => {
    const file = runPath();
    const run = createRunRecord({ chainName: "chain", goal: "goal" });
    updateRunJson(file, () => ({
      ...run,
      status: "failed",
      status_message: "stale monitor failure",
      completed: "2026-06-25T00:00:00Z",
    }));

    const recoveredAt = new Date("2026-07-11T20:00:00.000Z");
    const replayedAt = new Date("2026-07-11T21:00:00.000Z");
    const recovered = updateRunStatus(file, "completed", undefined, recoveredAt);
    const replayed = updateRunStatus(file, "completed", undefined, replayedAt);

    expect(recovered.completed).toBe(recoveredAt.toISOString());
    expect(recovered.status_message).toBeUndefined();
    expect(replayed.completed).toBe(recoveredAt.toISOString());
  });

  it("promotes a launched agent via addRunSession and dedupes sessions", () => {
    const file = runPath();
    const run = createRunRecord({ chainName: "chain", goal: "goal" });
    updateRunJson(file, () => run);

    addRunSession(file, "session-a", "agent-a", "Agent A");
    const updated = addRunSession(file, "session-a", "agent-a", "Agent A");

    expect(updated.status).toBe("running");
    expect(updated.completed).toBeUndefined();
    expect(updated.sessions).toEqual(["session-a"]);
    expect(updated.agents).toHaveLength(1);
    expect(updated.agents[0]).toMatchObject({
      id: "agent-a",
      name: "Agent A",
      session: "session-a",
      status: "running",
    });
  });

  it("clears a stale failure message when live agent work resumes", () => {
    const file = runPath();
    const run = createRunRecord({ runId: "run-resume", chainName: "chain", goal: "goal" });
    updateRunJson(file, () => ({
      ...run,
      status: "blocked",
      status_message: "chain-runner crashed before completion routing",
      completed: "2026-07-15T00:00:00.000Z",
    }));

    const resumed = addRunSession(file, "writer-run-resume", "writer", "Writer");

    expect(resumed).toMatchObject({
      status: "running",
      completed: undefined,
      agents: [{ id: "writer", status: "running", session: "writer-run-resume" }],
    });
    expect(resumed.status_message).toBeUndefined();
  });

  it("uses complete for agent success and sets completed only for terminal agent states", () => {
    const file = runPath();
    const run = createRunRecord({ chainName: "chain", goal: "goal" });
    updateRunJson(file, () => ({
      ...run,
      agents: [{ id: "agent-a", name: "Agent A", session: "session-a", status: "running" }],
    }));

    const updated = updateRunAgent(file, "agent-a", "complete");

    expect(updated.agents[0].status).toBe("complete");
    expect(updated.agents[0].completed).toBeDefined();
    expect(updated.status).toBe("pending");
  });
});
