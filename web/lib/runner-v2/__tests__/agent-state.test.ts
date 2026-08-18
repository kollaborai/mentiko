import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRunnerAgentState,
  findRunnerAgentStateBySession,
  incrementRunnerAgentRetry,
  parseRunnerAgentState,
  readRunnerAgentState,
  readRunnerAgentStateDirectory,
  runnerAgentStateKey,
  runnerAgentStatePath,
  transitionRunnerAgentState,
} from "../agent-state";

describe("runner agent state", () => {
  it("uses one normalized TypeScript-owned key for every caller", () => {
    expect(runnerAgentStateKey("decision-research", "run-123-ab")).toBe("decision_research_run_123_ab");
  });

  it("creates and atomically transitions a typed record without losing retry metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-state-"));
    const path = runnerAgentStatePath(root, "writer", "run-1");
    createRunnerAgentState(path, {
      agent_id: "writer",
      session: "workspace-writer-run-1",
      retry_max: "2",
      emits: "writer-complete",
    });
    incrementRunnerAgentRetry(path);
    const blocked = transitionRunnerAgentState(path, "blocked", "waiting for login", "2026-07-15T00:00:00.000Z");

    expect(blocked).toMatchObject({ status: "blocked", retry_attempt: "1", blocked_reason: "waiting for login" });
    expect(readRunnerAgentState(path)).toMatchObject({ status: "blocked", emits: "writer-complete" });
    expect(readFileSync(path, "utf8")).toContain("retry_attempt: 1");
  });

  it("rejects malformed and duplicate records instead of inventing a state", () => {
    expect(() => parseRunnerAgentState("status: running\nsession: one\nagent_id: writer\nstatus: failed\n"))
      .toThrow("Duplicate");
    expect(() => parseRunnerAgentState("status: running\nsession: one\n"))
      .toThrow("requires 'agent_id'");
  });

  it("omits symbolic-link and corrupt entries from a state directory", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-state-dir-"));
    const outside = mkdtempSync(join(tmpdir(), "mentiko-agent-state-outside-"));
    const path = runnerAgentStatePath(root, "writer", "run-1");
    createRunnerAgentState(path, { agent_id: "writer", session: "writer-run-1" });
    symlinkSync(outside, join(root, "escape.state"));

    expect(readRunnerAgentStateDirectory(root, "run-1")).toEqual({
      writer: expect.objectContaining({ status: "running" }),
    });
  });

  it("finds a state by session through the typed owner", () => {
    const root = mkdtempSync(join(tmpdir(), "mentiko-agent-state-session-"));
    const path = runnerAgentStatePath(root, "writer", "run-1");
    createRunnerAgentState(path, { agent_id: "writer", session: "workspace-writer-run-1" });

    expect(findRunnerAgentStateBySession(root, "workspace-writer-run-1")).toEqual({
      path,
      state: expect.objectContaining({ agent_id: "writer", status: "running" }),
    });
  });
});
