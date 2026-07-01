import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  AgentAttemptTransitionError,
  createAgentAttempt,
  reconcileAgentAttempt,
  recordAgentAttemptProcess,
  submitAgentAttemptInstructions,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

function runPath() {
  const path = join(mkdtempSync(join(tmpdir(), "runner-v2-agent-attempt-")), "run.json");
  updateRunJson(path, () => createRunRecord({ chainName: "chain", goal: "goal" }));
  return path;
}

function readRun(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("runner-v2 AgentAttempt lifecycle", () => {
  it("validates whitelisted transitions and rejects invalid pairs with a typed reason", () => {
    const path = runPath();
    const attempt = createAgentAttempt({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
    });

    expect(() => transitionAgentAttempt({
      runJsonPath: path,
      attemptId: attempt.id,
      to: "instructions_submitted",
    })).toThrow(AgentAttemptTransitionError);

    try {
      transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "instructions_submitted" });
    } catch (error) {
      expect(error).toMatchObject({ reason: "invalid_transition", from: "created", to: "instructions_submitted" });
    }
  });

  it("records process evidence before instructions are submitted", () => {
    const path = runPath();
    const attempt = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "lease_acquired" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "pty_allocated" });
    recordAgentAttemptProcess({
      runJsonPath: path,
      attemptId: attempt.id,
      processPid: 123,
      ptySessionId: "workspace-writer-run-1",
      now: new Date("2026-06-30T00:00:00.000Z"),
    });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "process_spawned" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "ready_for_instructions" });
    submitAgentAttemptInstructions({
      runJsonPath: path,
      attemptId: attempt.id,
      idempotencyKey: "run-1:writer:instructions",
      instructionPath: "/tmp/instructions.md",
      pointer: "Read /tmp/instructions.md",
    });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "instructions_submitted" });

    expect(readRun(path).runnerV2.attempts[0]).toMatchObject({
      phase: "instructions_submitted",
      processEvidence: {
        processPid: 123,
        processSpawnedAt: "2026-06-30T00:00:00.000Z",
        ptySessionId: "workspace-writer-run-1",
      },
    });
  });

  it("dedupes instruction submissions by idempotency key", () => {
    const path = runPath();
    const attempt = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });

    const first = submitAgentAttemptInstructions({
      runJsonPath: path,
      attemptId: attempt.id,
      idempotencyKey: "same",
      instructionPath: "/tmp/instructions.md",
      pointer: "Read /tmp/instructions.md",
    });
    const second = submitAgentAttemptInstructions({
      runJsonPath: path,
      attemptId: attempt.id,
      idempotencyKey: "same",
      instructionPath: "/tmp/instructions.md",
      pointer: "Read /tmp/instructions.md",
    });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(readRun(path).runnerV2.attempts[0].instructionLedger).toHaveLength(1);
  });

  it("emits a typed stuck event instead of re-driving launch after reconciliation expiry", () => {
    const path = runPath();
    const attempt = createAgentAttempt({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      now: new Date("2026-06-30T00:00:00.000Z"),
    });

    const stuck = reconcileAgentAttempt({
      runJsonPath: path,
      attemptId: attempt.id,
      reconciliationWindowMs: 1_000,
      now: new Date("2026-06-30T00:00:02.000Z"),
    });

    expect(stuck).toMatchObject({
      phase: "stuck",
      terminalReason: "reconciliation_window_expired",
    });
    expect(readRun(path).runnerV2.stuckEvents[0]).toMatchObject({
      attemptId: attempt.id,
      reason: "reconciliation_window_expired",
    });
  });
});
