import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recoverLateCompletionEvents } from "@/lib/runner-v2/completion-recovery";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { createAgentAttempt, transitionAgentAttempt, type AgentAttemptPhase } from "@/lib/runner-v2/agent-attempt";

function runPath() {
  return join(mkdtempSync(join(tmpdir(), "runner-v2-late-event-")), "run.json");
}

// Seeds a run in the falsely-terminalized state that completeAgent's exhausted
// path leaves behind: run stopped, agent failed. This is the TASK-093 shape —
// the no-event retry budget exhausted before the slow agent's valid event
// landed.
function seedFailedRun(file: string) {
  const run = createRunRecord({ chainName: "chain", goal: "goal" });
  updateRunJson(file, () => ({
    ...run,
    id: "run-123",
    status: "stopped",
    status_message: "agent writer completed without declared event; retries exhausted",
    agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "failed" }],
    sessions: ["writer-run-123"],
  }));
}

function seedFailedAttempt(file: string) {
  const attempt = createAgentAttempt({ runJsonPath: file, runId: "run-123", agentId: "writer" });
  const path: AgentAttemptPhase[] = [
    "lease_acquired",
    "pty_allocated",
    "process_spawned",
    "ready_for_instructions",
    "instructions_submitted",
  ];
  for (const to of path) {
    transitionAgentAttempt({ runJsonPath: file, attemptId: attempt.id, to });
  }
  transitionAgentAttempt({
    runJsonPath: file,
    attemptId: attempt.id,
    to: "completion_failed",
    reason: "retries_exhausted",
    detail: "declared completion event missing; retries exhausted",
  });
  return attempt;
}

function attempts(file: string) {
  return (readRunJson(file).runnerV2 as { attempts?: Array<Record<string, unknown>> } | undefined)?.attempts || [];
}

const CHAIN_WITH_DOWNSTREAM = {
  name: "Build Chain",
  agents: [
    { id: "writer", emits: "draft-ready" },
    { id: "reviewer", triggers: ["draft-ready"] },
  ],
};

const LATE_EVENT = "event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: false\n";

describe("recoverLateCompletionEvents", () => {
  it("adopts a late completion event for a completion_failed attempt, completes the agent, and routes downstream", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [LATE_EVENT],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0]).toMatchObject({
      agentId: "writer",
      route: { action: "launch", agentIds: ["reviewer"] },
    });
    expect(result.recovered[0].event).toMatchObject({ event: "draft-ready", source: "writer-run-123" });

    // run reopened, agent flipped from failed -> complete
    expect(result.run.status).toBe("running");
    expect(result.run.agents[0]).toMatchObject({ id: "writer", status: "complete" });

    // the completion_failed attempt stays in history; a fresh adopted attempt
    // records the real completion evidence (bash parity: "process gone but
    // completion event exists; completing normally")
    const list = attempts(file);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ phase: "completion_failed", terminalReason: "retries_exhausted" });
    expect(list[list.length - 1]).toMatchObject({
      agentId: "writer",
      phase: "completed",
      terminalReason: "completed_from_event",
      origin: "routed-completion-adoption",
    });
  });

  it("completes the run when the recovered agent is the terminal agent (no downstream)", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: { name: "Build Chain", agents: [{ id: "writer", emits: "draft-ready" }] },
      events: [LATE_EVENT],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.recovered[0].route.action).not.toBe("launch");
    expect(result.run.status).toBe("completed");
    expect(result.run.agents[0]).toMatchObject({ id: "writer", status: "complete" });
  });

  it("is idempotent: a second pass recovers nothing once the attempt is completed", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const first = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [LATE_EVENT],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });
    expect(first.recovered).toHaveLength(1);

    const second = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [LATE_EVENT],
      now: new Date("2026-06-25T10:06:00.000Z"),
    });
    expect(second.recovered).toHaveLength(0);
    // no third attempt created on the repeat pass
    expect(attempts(file)).toHaveLength(2);
    expect(second.run.status).toBe("running");
  });

  it("does not recover when no matching unprocessed event exists (run stays terminal)", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("stopped");
    expect(result.run.agents[0]).toMatchObject({ id: "writer", status: "failed" });
    expect(attempts(file)).toHaveLength(1);
  });

  it("does not adopt an already-processed event", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-123\nprocessed: true\n"],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("stopped");
  });

  it("does not adopt an event whose run_id does not match", () => {
    const file = runPath();
    seedFailedRun(file);
    seedFailedAttempt(file);

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: ["event: draft-ready\nsource: writer-run-123\nrun_id: run-999\nprocessed: false\n"],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("stopped");
  });

  it("recovers nothing when there are no completion_failed attempts", () => {
    const file = runPath();
    const run = createRunRecord({ chainName: "chain", goal: "goal" });
    updateRunJson(file, () => ({
      ...run,
      id: "run-123",
      status: "running",
      agents: [{ id: "writer", name: "Writer", session: "writer-run-123", status: "running" }],
      sessions: ["writer-run-123"],
    }));

    const result = recoverLateCompletionEvents({
      runJsonPath: file,
      runId: "run-123",
      chain: CHAIN_WITH_DOWNSTREAM,
      events: [LATE_EVENT],
      now: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(result.recovered).toHaveLength(0);
    expect(result.run.status).toBe("running");
    expect(attempts(file)).toHaveLength(0);
  });
});
