import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { runRunnerV2CompletionEntrypoint } from "@/lib/runner-v2/completion-entrypoint";
import {
  createAgentAttempt,
  readRunnerV2AttemptState,
  transitionAgentAttempt,
} from "@/lib/runner-v2/agent-attempt";
import { createRunRecord, readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";

jest.mock("child_process", () => ({
  ...jest.requireActual("child_process"),
  spawnSync: jest.fn(),
}));

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function advanceToInstructions(runJsonPath: string, attemptId: string) {
  for (const phase of [
    "queued",
    "lease_acquired",
    "pty_allocated",
    "process_spawned",
    "ready_for_instructions",
    "instructions_submitted",
  ] as const) {
    transitionAgentAttempt({ runJsonPath, attemptId, to: phase });
  }
}

describe("runner-v2 generation import failure cleanup", () => {
  it("fails the run and closes its PTYs instead of restoring a live-looking run", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-generation-import-failure-"));
    const runDir = join(root, "runs", "run-123");
    const artifactsDir = join(runDir, "artifacts");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "task-generation",
      name: "Task Generation",
      agents: [{ id: "task-generator", name: "Task Generator" }],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Task Generation", goal: "generate task" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      metadata: { generationJobId: "job-123", generationKind: "task" },
      agents: [{
        id: "task-generator",
        name: "Task Generator",
        session: "task-generator-run-123",
        status: "running",
      }],
      sessions: ["task-generator-run-123"],
    }));
    writeJson(join(artifactsDir, "generation-result.json"), {
      route: "task",
      task: { title: "Generated task" },
    });

    (spawnSync as jest.Mock).mockImplementation((_command: string, args: string[]) => {
      if (args[0] === "generation" && args[1] === "import") {
        return { status: 1, stdout: "", stderr: "generated task title is required" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });

    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "task-generator-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      now: new Date("2026-07-15T12:00:00.000Z"),
    })).toThrow("generation import failed for job job-123: generated task title is required");

    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "failed",
      status_message: "generation import failed for job job-123: generated task title is required",
      completed: "2026-07-15T12:00:00.000Z",
      agents: [{
        id: "task-generator",
        status: "complete",
        completed: "2026-07-15T12:00:00.000Z",
      }],
    });
    expect(readRunnerV2AttemptState(runJsonPath).attempts.at(-1)).toMatchObject({
      agentId: "task-generator",
      phase: "completed",
      terminalReason: "completed_from_generation_artifact",
    });
    expect(spawnSync).toHaveBeenCalledWith(
      expect.stringContaining("/bin/p"),
      ["remove", "monitor-task-generator-run-123"],
      expect.any(Object),
    );
    expect(spawnSync).toHaveBeenCalledWith(
      expect.stringContaining("/bin/p"),
      ["remove", "task-generator-run-123"],
      expect.any(Object),
    );
  });

  it("terminalizes the exact import attempt without mutating a retry created during import", () => {
    const root = mkdtempSync(join(tmpdir(), "runner-v2-generation-import-race-"));
    const runDir = join(root, "runs", "run-123");
    const artifactsDir = join(runDir, "artifacts");
    const eventsDir = join(root, "events");
    const stateDir = join(root, "state");
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(eventsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });

    const chainPath = join(root, "chain.json");
    writeJson(chainPath, {
      id: "task-generation",
      name: "Task Generation",
      agents: [{ id: "task-generator", name: "Task Generator" }],
    });

    const runJsonPath = join(runDir, "run.json");
    const run = createRunRecord({ chainName: "Task Generation", goal: "generate task" });
    updateRunJson(runJsonPath, () => ({
      ...run,
      id: "run-123",
      status: "running",
      metadata: { generationJobId: "job-123", generationKind: "task" },
      agents: [{
        id: "task-generator",
        name: "Task Generator",
        session: "task-generator-run-123",
        status: "running",
      }],
      sessions: ["task-generator-run-123"],
    }));
    const exact = createAgentAttempt({
      runJsonPath,
      runId: "run-123",
      agentId: "task-generator",
      attemptId: "run-123:task-generator:1",
      leaseId: "task-generator-run-123",
    });
    advanceToInstructions(runJsonPath, exact.id);
    writeJson(join(artifactsDir, "generation-result.json"), {
      route: "task",
      task: { title: "Generated task" },
    });

    const retryId = "run-123:task-generator:2";
    (spawnSync as jest.Mock).mockImplementation((_command: string, args: string[]) => {
      if (args[0] === "generation" && args[1] === "import") {
        const retry = createAgentAttempt({
          runJsonPath,
          runId: "run-123",
          agentId: "task-generator",
          attemptId: retryId,
          leaseId: "task-generator-retry-run-123",
        });
        advanceToInstructions(runJsonPath, retry.id);
        return { status: 1, stdout: "", stderr: "generated task title is required" };
      }
      return { status: 1, stdout: "", stderr: "" };
    });

    expect(() => runRunnerV2CompletionEntrypoint({
      sessionName: "task-generator-run-123",
      chainPath,
      env: {
        MENTIKO_RUN_ID: "run-123",
        MENTIKO_AGENT_ATTEMPT_ID: exact.id,
        MENTIKO_RUN_DIR: runDir,
        EVENTS_DIR: eventsDir,
        STATE_DIR: stateDir,
        NAMESPACE_ID: "default",
        ORG_ID: "default",
      },
      now: new Date("2026-08-09T21:00:00.000Z"),
    })).toThrow("generation import failed for job job-123: generated task title is required");

    expect(readRunJson(runJsonPath)).toMatchObject({
      status: "running",
      agents: [{ id: "task-generator", status: "running" }],
    });
    const attempts = readRunnerV2AttemptState(runJsonPath).attempts;
    expect(attempts.find((attempt) => attempt.id === exact.id)).toMatchObject({
      phase: "completed",
      terminalReason: "completed_from_generation_artifact",
    });
    expect(attempts.find((attempt) => attempt.id === retryId)).toMatchObject({
      phase: "instructions_submitted",
    });
  });
});
