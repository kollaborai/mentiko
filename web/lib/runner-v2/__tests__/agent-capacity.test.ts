/** @jest-environment node */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentAttempt,
  readRunnerV2AttemptState,
  releaseAgentCapacitySlot,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import { admitQueuedAgentAttempt } from "@/lib/runner-v2/agent-capacity";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";

function seedRun(root: string, runId: string): string {
  const runDir = join(root, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const runJsonPath = join(runDir, "run.json");
  updateRunJson(runJsonPath, () => ({
    ...createRunRecord({ runId, chainName: "capacity", goal: "queue" }),
    status: "running",
  }));
  return runJsonPath;
}

function queueAttempt(runJsonPath: string, runId: string, agentId: string, offset: number) {
  const attempt = createAgentAttempt({
    runJsonPath,
    runId,
    agentId,
    now: new Date(1_786_234_000_000 + offset),
  });
  return transitionAgentAttempt({
    runJsonPath,
    attemptId: attempt.id,
    to: "queued",
    now: new Date(1_786_234_000_000 + offset),
  });
}

describe("typed agent capacity queue", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "mentiko-agent-capacity-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("admits at most the cap across a 30-node fan-out and advances FIFO", () => {
    const runJsonPath = seedRun(root, "run-thirty");
    const attempts = Array.from({ length: 30 }, (_, index) =>
      queueAttempt(runJsonPath, "run-thirty", `agent-${index + 1}`, index));

    const decisions = attempts.map((attempt) => admitQueuedAgentAttempt({
      runJsonPath,
      runId: "run-thirty",
      attemptId: attempt.id,
      cap: 3,
    }));

    expect(decisions.filter((decision) => decision.status === "admitted")).toHaveLength(3);
    expect(decisions.slice(3).every((decision) => decision.status === "queued")).toBe(true);
    const persisted = readRunnerV2AttemptState(runJsonPath).attempts;
    expect(persisted.filter((attempt) => attempt.capacitySlotAcquiredAt && !attempt.capacitySlotReleasedAt)).toHaveLength(3);
    expect(persisted.filter((attempt) => attempt.phase === "queued")).toHaveLength(27);

    releaseAgentCapacitySlot({ runJsonPath, attemptId: attempts[0].id });
    expect(admitQueuedAgentAttempt({
      runJsonPath,
      runId: "run-thirty",
      attemptId: attempts[3].id,
      cap: 3,
    })).toMatchObject({ status: "admitted", active: 3, cap: 3 });
    expect(readRunnerV2AttemptState(runJsonPath).attempts.find(
      (attempt) => attempt.id === attempts[3].id,
    )).toMatchObject({ phase: "lease_acquired" });
  });

  it("keeps FIFO order across runs under the shared host lock", () => {
    const firstPath = seedRun(root, "run-first");
    const secondPath = seedRun(root, "run-second");
    const first = queueAttempt(firstPath, "run-first", "first", 0);
    const second = queueAttempt(secondPath, "run-second", "second", 1);

    expect(admitQueuedAgentAttempt({
      runJsonPath: secondPath,
      runId: "run-second",
      attemptId: second.id,
      cap: 1,
    })).toMatchObject({ status: "queued", position: 2 });
    expect(admitQueuedAgentAttempt({
      runJsonPath: firstPath,
      runId: "run-first",
      attemptId: first.id,
      cap: 1,
    })).toMatchObject({ status: "admitted" });
  });

  it("does not let a queued attempt from a terminal run block launchable work", () => {
    const stalePath = seedRun(root, "run-stale-terminal");
    const stale = queueAttempt(stalePath, "run-stale-terminal", "stale", 0);
    updateRunJson(stalePath, (run) => ({ ...run!, status: "failed" }));
    const currentPath = seedRun(root, "run-current");
    const current = queueAttempt(currentPath, "run-current", "current", 1);

    expect(admitQueuedAgentAttempt({
      runJsonPath: currentPath,
      runId: "run-current",
      attemptId: current.id,
      cap: 1,
    })).toMatchObject({ status: "admitted", active: 1, cap: 1 });
    expect(readRunnerV2AttemptState(stalePath).attempts.find(
      (attempt) => attempt.id === stale.id,
    )).toMatchObject({ phase: "queued" });
  });

  it("keeps a terminal run's acquired slot counted until cleanup releases it", () => {
    const terminalPath = seedRun(root, "run-terminal-held");
    const held = queueAttempt(terminalPath, "run-terminal-held", "held", 0);
    expect(admitQueuedAgentAttempt({
      runJsonPath: terminalPath,
      runId: "run-terminal-held",
      attemptId: held.id,
      cap: 1,
    })).toMatchObject({ status: "admitted" });
    updateRunJson(terminalPath, (run) => ({ ...run!, status: "stopped" }));

    const currentPath = seedRun(root, "run-after-terminal");
    const current = queueAttempt(currentPath, "run-after-terminal", "current", 1);
    expect(admitQueuedAgentAttempt({
      runJsonPath: currentPath,
      runId: "run-after-terminal",
      attemptId: current.id,
      cap: 1,
    })).toMatchObject({ status: "queued", active: 1, position: 1 });

    releaseAgentCapacitySlot({ runJsonPath: terminalPath, attemptId: held.id });
    expect(admitQueuedAgentAttempt({
      runJsonPath: currentPath,
      runId: "run-after-terminal",
      attemptId: current.id,
      cap: 1,
    })).toMatchObject({ status: "admitted", active: 1, cap: 1 });
  });

  it("fails closed when any run record in the capacity domain is corrupt", () => {
    const runJsonPath = seedRun(root, "run-good");
    const attempt = queueAttempt(runJsonPath, "run-good", "agent", 0);
    const corruptDir = join(root, "runs", "run-corrupt");
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, "run.json"), "{not-json\n");

    expect(admitQueuedAgentAttempt({
      runJsonPath,
      runId: "run-good",
      attemptId: attempt.id,
      cap: 1,
    })).toMatchObject({ status: "invalid" });
    expect(readRunnerV2AttemptState(runJsonPath).attempts[0].phase).toBe("queued");
  });

  it("rejects a negative cap instead of silently treating it as unlimited", () => {
    const runJsonPath = seedRun(root, "run-negative-cap");
    const attempt = queueAttempt(runJsonPath, "run-negative-cap", "agent", 0);

    expect(admitQueuedAgentAttempt({
      runJsonPath,
      runId: "run-negative-cap",
      attemptId: attempt.id,
      cap: -1,
    })).toMatchObject({ status: "invalid" });
    expect(readRunnerV2AttemptState(runJsonPath).attempts[0].phase).toBe("queued");
  });

});
