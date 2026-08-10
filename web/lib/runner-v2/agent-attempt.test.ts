import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  AgentAttemptTransitionError,
  adoptAgentAttemptForCompletion,
  classifyReadinessFailure,
  createAgentAttempt,
  markAgentAttemptCompletedFromEvent,
  markAgentAttemptFailedNoCompletion,
  markAgentAttemptRetriesExhausted,
  projectAgentAttemptsForStatus,
  reconcileAgentAttempt,
  recordAgentAttemptProcess,
  releaseAgentAttempt,
  resolveAgentAttemptForCompletion,
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

  it("preserves startup terminal reason when releasing the lease", () => {
    const path = runPath();
    const attempt = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "startup_failed", reason: "readiness_deadline_expired" });

    const released = releaseAgentAttempt({ runJsonPath: path, attemptId: attempt.id });

    expect(released).toMatchObject({
      phase: "released",
      terminalReason: "readiness_deadline_expired",
      releaseReason: "released",
    });
  });

  it("allocates a fresh sequence after a released bootstrap attempt", () => {
    const path = runPath();
    const first = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });
    releaseAgentAttempt({ runJsonPath: path, attemptId: first.id });

    const retry = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });

    expect(first.id).toBe("run-1:writer:1");
    expect(retry).toMatchObject({ id: "run-1:writer:2", phase: "created" });
    expect(readRun(path).runnerV2.attempts).toHaveLength(2);
  });

  it("fails a submitted attempt with a typed completion reason and preserves it on release", () => {
    const path = runPath();
    const attempt = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "lease_acquired" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "pty_allocated" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "process_spawned" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "ready_for_instructions" });
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "instructions_submitted" });

    const failed = markAgentAttemptFailedNoCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      detail: "declared completion event missing: no matching completion event",
    });

    expect(failed).toMatchObject({
      phase: "completion_failed",
      terminalReason: "no_completion_event",
      terminalDetail: "declared completion event missing: no matching completion event",
    });

    const released = releaseAgentAttempt({ runJsonPath: path, attemptId: attempt.id });
    expect(released).toMatchObject({
      phase: "released",
      terminalReason: "no_completion_event",
      releaseReason: "released",
    });
  });

  it("leaves a non-running attempt untouched when marking a completion failure", () => {
    const path = runPath();
    const attempt = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });

    // never reached instructions_submitted: retries-exhausted marker must no-op, not throw
    const stillCreated = markAgentAttemptRetriesExhausted({ runJsonPath: path, runId: "run-1", agentId: "writer" });
    expect(stillCreated?.phase).toBe("created");

    // an attempt that already failed at startup is not re-failed as a completion failure
    transitionAgentAttempt({ runJsonPath: path, attemptId: attempt.id, to: "startup_failed", reason: "readiness_deadline_expired" });
    const stillStartupFailed = markAgentAttemptFailedNoCompletion({ runJsonPath: path, runId: "run-1", agentId: "writer" });
    expect(stillStartupFailed).toMatchObject({ phase: "startup_failed", terminalReason: "readiness_deadline_expired" });
  });

  it("keeps repeated stuck reconciliation idempotent", () => {
    const path = runPath();
    const attempt = createAgentAttempt({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      now: new Date("2026-06-30T00:00:00.000Z"),
    });

    reconcileAgentAttempt({
      runJsonPath: path,
      attemptId: attempt.id,
      reconciliationWindowMs: 1_000,
      now: new Date("2026-06-30T00:00:02.000Z"),
    });
    const second = reconcileAgentAttempt({
      runJsonPath: path,
      attemptId: attempt.id,
      reconciliationWindowMs: 1_000,
      now: new Date("2026-06-30T00:00:04.000Z"),
    });

    expect(second.phase).toBe("stuck");
    expect(readRun(path).runnerV2.stuckEvents).toHaveLength(1);
  });

  it("projects status payload without instruction paths or transition details", () => {
    const path = runPath();
    const attempt = createAgentAttempt({ runJsonPath: path, runId: "run-1", agentId: "writer" });
    submitAgentAttemptInstructions({
      runJsonPath: path,
      attemptId: attempt.id,
      idempotencyKey: "same",
      instructionPath: "/tmp/private/instructions.md",
      pointer: "Read /tmp/private/instructions.md",
    });
    transitionAgentAttempt({
      runJsonPath: path,
      attemptId: attempt.id,
      to: "startup_failed",
      reason: "readiness_deadline_expired",
      detail: "CLI readiness unresolved after 90 seconds",
    });

    const projected = projectAgentAttemptsForStatus(readRun(path).runnerV2);

    expect(projected.attempts[0]).toMatchObject({
      id: attempt.id,
      agentId: "writer",
      phase: "startup_failed",
      terminalReason: "readiness_deadline_expired",
      terminalDetail: "CLI readiness unresolved after 90 seconds",
      recoveryDecisionCount: 0,
    });
    expect(JSON.stringify(projected)).not.toContain("/tmp/private");
    expect(JSON.stringify(projected)).not.toContain("instructionLedger");
    expect(JSON.stringify(projected)).not.toContain("transitions");
  });

  it("classifies auth prompts separately from generic install output", () => {
    expect(classifyReadinessFailure("Please log in to continue").phase).toBe("human_action_required");
    expect(classifyReadinessFailure("install dependencies still running").phase).toBe("startup_failed");
  });

  it("adopts a fresh attempt over a failure-terminal latest so real completion evidence can record", () => {
    const path = runPath();
    const first = adoptAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      sessionName: "writer-run-1",
      now: new Date("2026-07-04T00:00:00.000Z"),
    });
    transitionAgentAttempt({
      runJsonPath: path,
      attemptId: first.id,
      to: "completion_failed",
      reason: "retries_exhausted",
      now: new Date("2026-07-04T00:01:00.000Z"),
    });

    const second = adoptAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      sessionName: "writer-run-1",
      now: new Date("2026-07-04T00:02:00.000Z"),
    });

    expect(second.id).toBe("run-1:writer:2");
    expect(second.phase).toBe("instructions_submitted");
    expect(second.transitions[0].detail).toContain("previous attempt run-1:writer:1 ended completion_failed");

    // and a COMPLETED latest stays authoritative — no duplicate adoption
    transitionAgentAttempt({
      runJsonPath: path,
      attemptId: second.id,
      to: "completed",
      reason: "completed_from_event",
      now: new Date("2026-07-04T00:03:00.000Z"),
    });
    const third = adoptAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      now: new Date("2026-07-04T00:04:00.000Z"),
    });
    expect(third.id).toBe("run-1:writer:2");
  });

  it("resolves the exact completion attempt instead of a newer retry and fails closed without identity", () => {
    const path = runPath();
    const first = createAgentAttempt({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      leaseId: "writer-run-1",
    });
    transitionAgentAttempt({
      runJsonPath: path,
      attemptId: first.id,
      to: "startup_failed",
      reason: "readiness_deadline_expired",
    });
    const second = createAgentAttempt({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      leaseId: "writer-run-1",
    });

    expect(resolveAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      attemptId: first.id,
      sessionName: "writer-run-1",
    })?.id).toBe(first.id);
    expect(adoptAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      attemptId: first.id,
      sessionName: "writer-run-1",
    }).id).toBe(first.id);
    expect(second.id).toBe("run-1:writer:2");

    expect(() => resolveAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      sessionName: "writer-run-1",
    })).toThrow("exact MENTIKO_AGENT_ATTEMPT_ID required");
    expect(() => resolveAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      attemptId: first.id,
      sessionName: "another-session",
    })).toThrow("completion AgentAttempt session mismatch");
  });

  it("adopts a routed attempt at completion time with explicit provenance", () => {
    const path = runPath();
    const adopted = adoptAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "verifier",
      sessionName: "verifier-run-1",
      now: new Date("2026-07-04T00:00:00.000Z"),
    });

    expect(adopted).toMatchObject({
      id: "run-1:verifier:1",
      phase: "instructions_submitted",
      desiredPhase: "completed",
      observedPhase: "instructions_submitted",
      origin: "routed-completion-adoption",
      leaseId: "verifier-run-1",
      processEvidence: { ptySessionId: "verifier-run-1" },
    });
    expect(adopted.transitions).toHaveLength(1);
    expect(adopted.transitions[0]).toMatchObject({ from: "created", to: "instructions_submitted" });
    expect(adopted.transitions[0].detail).toContain("adopted at completion");

    // the adopted record completes through the normal legal edge
    const completed = markAgentAttemptCompletedFromEvent({
      runJsonPath: path,
      runId: "run-1",
      agentId: "verifier",
      detail: "matched completion event verification-complete",
    });
    expect(completed).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_declared_event",
      origin: "routed-completion-adoption",
    });
  });

  it("adoption is a no-op when any attempt already exists for the agent", () => {
    const path = runPath();
    const bootstrap = createAgentAttempt({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
    });

    const adopted = adoptAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "writer",
      sessionName: "writer-run-1",
    });

    expect(adopted.id).toBe(bootstrap.id);
    expect(adopted.origin).toBeUndefined();
    expect(readRun(path).runnerV2.attempts).toHaveLength(1);
  });

  it("adopted attempts can fail through the completion_failed edge", () => {
    const path = runPath();
    adoptAgentAttemptForCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "verifier",
    });

    const failed = markAgentAttemptFailedNoCompletion({
      runJsonPath: path,
      runId: "run-1",
      agentId: "verifier",
      detail: "declared completion event missing",
    });
    expect(failed).toMatchObject({
      phase: "completion_failed",
      terminalReason: "no_completion_event",
      origin: "routed-completion-adoption",
    });
  });
});
