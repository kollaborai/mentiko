/** @jest-environment node */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentBootstrapPlan } from "@/lib/runner-v2/agent-bootstrap-plan";
import {
  createAgentAttempt,
  readRunnerV2AttemptState,
  recordAgentAttemptProcess,
  submitAgentAttemptInstructions,
  transitionAgentAttempt,
  type AgentAttemptPhase,
} from "@/lib/runner-v2/agent-attempt";
import {
  recoverInterruptedRoutedBootstrap,
  type BootstrapRecoveryExecutor,
  type BootstrapRecoverySession,
} from "@/lib/runner-v2/bootstrap-recovery";
import { createRunRecord, updateRunJson } from "@/lib/runner-v2/run-state";
import { ensureRunWorkspaceBaseline } from "@/lib/runner-v2/workspace-evidence";
import {
  allocateGitNodeWorkspace,
  initializeGitRunWorkspaceIsolation,
} from "@/lib/runner-v2/workspace-isolation";
import type { RunnerV2LaunchContext } from "@/lib/runner-v2/types";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fakeExecutor(
  initial: BootstrapRecoverySession[],
  options: { removalSticks?: boolean } = {},
): BootstrapRecoveryExecutor & {
  remove: jest.Mock;
  spawn: jest.Mock;
  list: jest.Mock;
} {
  const sessions = new Map(initial.map((session) => [session.name, { ...session }]));
  const removalSticks = options.removalSticks !== false;
  return {
    remove: jest.fn(async (name: string) => {
      if (removalSticks) sessions.delete(name);
    }),
    list: jest.fn(async () => [...sessions.values()]),
    spawn: jest.fn(async (name: string) => {
      sessions.set(name, { name, alive: true });
      return { name, pid: 444 };
    }),
  };
}

function fixture(targetPhase: Extract<AgentAttemptPhase,
  "pty_allocated" | "process_spawned" | "ready_for_instructions" | "instructions_submitted"
>) {
  const workspace = mkdtempSync(join(tmpdir(), "mentiko-bootstrap-recovery-repo-"));
  const runDir = mkdtempSync(join(tmpdir(), "mentiko-bootstrap-recovery-run-"));
  const runJsonPath = join(runDir, "run.json");
  const chainPath = join(runDir, "chain.json");
  git(workspace, "init", "-q");
  git(workspace, "config", "user.name", "Bootstrap Recovery Test");
  git(workspace, "config", "user.email", "bootstrap-recovery@example.com");
  writeFileSync(join(workspace, "source.ts"), "export const source = 'base';\n");
  git(workspace, "add", ".");
  git(workspace, "commit", "-qm", "initial");
  writeFileSync(chainPath, JSON.stringify({
    id: "recovery-chain",
    name: "Recovery Chain",
    agents: [{ id: "writer", name: "Writer", emits: "done" }],
  }));
  updateRunJson(runJsonPath, () => ({
    ...createRunRecord({
      runId: "run-bootstrap-recovery",
      chainName: "Recovery Chain",
      goal: "recover launch",
    }),
    status: "running",
  }));
  const execution = ensureRunWorkspaceBaseline({
    runJsonPath,
    runDir,
    runId: "run-bootstrap-recovery",
    workspacePath: workspace,
    now: new Date("2026-08-09T20:00:00.000Z"),
  });
  if (execution.tracking !== "git") throw new Error("test workspace must be Git-backed");
  const runWorkspace = initializeGitRunWorkspaceIsolation({
    runId: "run-bootstrap-recovery",
    runDir,
    baseline: execution.baseline,
  });
  const context: RunnerV2LaunchContext = {
    chainPath,
    runDir,
    runId: "run-bootstrap-recovery",
    agentId: "writer",
    chainId: "recovery-chain",
    chainName: "Recovery Chain",
    workspacePath: workspace,
    cwd: workspace,
    logFd: 2,
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH || "",
      RUNS_DIR: runDir,
      STATE_DIR: join(runDir, "state"),
      EVENTS_DIR: join(runDir, "events"),
      AGENT_PROFILES_DIR: join(runDir, "profiles"),
      MENTIKO_WORKSPACE_PATH: workspace,
      MENTIKO_LAUNCH_JOB_ID: "launch-job-1",
      MENTIKO_LAUNCH_JOB_OWNER_ID: "recovery-owner",
      MENTIKO_COMPLETION_OCCURRENCE_ID: "occurrence-1",
    },
  };
  mkdirSync(context.env.STATE_DIR!, { recursive: true });
  mkdirSync(context.env.EVENTS_DIR!, { recursive: true });
  const plan = buildAgentBootstrapPlan({
    chainPath,
    runDir,
    runId: context.runId,
    agentId: "writer",
    workspacePath: workspace,
    env: context.env,
  });
  const attempt = createAgentAttempt({
    runJsonPath,
    runId: context.runId,
    agentId: "writer",
    leaseId: plan.sessionName,
    launchJobId: "launch-job-1",
    launchOccurrenceId: "occurrence-1",
  });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "queued" });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "lease_acquired" });
  const node = allocateGitNodeWorkspace({
    runWorkspace,
    agentId: "writer",
    attemptId: attempt.id,
  });
  transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "pty_allocated" });
  recordAgentAttemptProcess({
    runJsonPath,
    attemptId: attempt.id,
    processPid: 333,
    ptySessionId: plan.sessionName,
  });
  if (targetPhase !== "pty_allocated") {
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "process_spawned" });
  }
  if (targetPhase === "ready_for_instructions" || targetPhase === "instructions_submitted") {
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "ready_for_instructions" });
  }
  if (targetPhase === "instructions_submitted") {
    submitAgentAttemptInstructions({
      runJsonPath,
      attemptId: attempt.id,
      idempotencyKey: "instructions-1",
      instructionPath: plan.instructionPath,
      pointer: plan.instructionPointer,
    });
    transitionAgentAttempt({ runJsonPath, attemptId: attempt.id, to: "instructions_submitted" });
  }
  return { workspace, runDir, runJsonPath, context, plan, attempt, node };
}

function currentAttempt(runJsonPath: string, attemptId: string) {
  return readRunnerV2AttemptState(runJsonPath).attempts
    .find((attempt) => attempt.id === attemptId)!;
}

describe("interrupted routed bootstrap recovery", () => {
  it.each(["pty_allocated", "process_spawned", "ready_for_instructions"] as const)(
    "reclaims %s PTYs and pristine worktree before allowing one retry",
    async (phase) => {
      const paths = fixture(phase);
      const executor = fakeExecutor([
        { name: paths.plan.sessionName, alive: true },
        { name: paths.plan.monitorSessionName, alive: true },
      ]);

      await expect(recoverInterruptedRoutedBootstrap({
        context: paths.context,
        attempt: currentAttempt(paths.runJsonPath, paths.attempt.id),
        executor,
      })).resolves.toEqual({ status: "retry", cleanupOutcome: "removed" });
      expect(executor.remove).toHaveBeenCalledWith(paths.plan.monitorSessionName);
      expect(executor.remove).toHaveBeenCalledWith(paths.plan.sessionName);
      expect(existsSync(paths.node.worktreeRoot)).toBe(false);
      expect(currentAttempt(paths.runJsonPath, paths.attempt.id)).toMatchObject({
        phase: "released",
        terminalReason: "launch_coordinator_interrupted",
        capacitySlotReleasedAt: expect.any(String),
      });
    },
  );

  it("blocks instead of guessing when durable instruction intent has ambiguous PTY delivery", async () => {
    const paths = fixture("ready_for_instructions");
    submitAgentAttemptInstructions({
      runJsonPath: paths.runJsonPath,
      attemptId: paths.attempt.id,
      idempotencyKey: "ambiguous-instructions",
      instructionPath: paths.plan.instructionPath,
      pointer: paths.plan.instructionPointer,
    });
    const executor = fakeExecutor([{ name: paths.plan.sessionName, alive: true }]);

    const result = await recoverInterruptedRoutedBootstrap({
      context: paths.context,
      attempt: currentAttempt(paths.runJsonPath, paths.attempt.id),
      executor,
    });
    expect(result).toMatchObject({ status: "blocked" });
    expect(existsSync(paths.node.worktreeRoot)).toBe(false);
    expect(currentAttempt(paths.runJsonPath, paths.attempt.id)).toMatchObject({
      phase: "released",
      terminalReason: "instruction_delivery_ambiguous",
      capacitySlotReleasedAt: expect.any(String),
    });
  });

  it("preserves and blocks an interrupted worktree that already contains changes", async () => {
    const paths = fixture("process_spawned");
    writeFileSync(join(paths.node.workspacePath, "source.ts"), "export const source = 'partial';\n");
    const executor = fakeExecutor([{ name: paths.plan.sessionName, alive: true }]);

    const result = await recoverInterruptedRoutedBootstrap({
      context: paths.context,
      attempt: currentAttempt(paths.runJsonPath, paths.attempt.id),
      executor,
    });
    expect(result).toMatchObject({ status: "blocked" });
    expect(existsSync(paths.node.worktreeRoot)).toBe(true);
    expect(currentAttempt(paths.runJsonPath, paths.attempt.id)).toMatchObject({
      phase: "released",
      terminalReason: "interrupted_bootstrap_changes",
      capacitySlotReleasedAt: expect.any(String),
    });
  });

  it("restarts a missing monitor for an instruction-submitted attempt in its node worktree", async () => {
    const paths = fixture("instructions_submitted");
    const executor = fakeExecutor([{ name: paths.plan.sessionName, alive: true }]);

    await expect(recoverInterruptedRoutedBootstrap({
      context: paths.context,
      attempt: currentAttempt(paths.runJsonPath, paths.attempt.id),
      executor,
    })).resolves.toEqual({ status: "started", monitor: "restarted" });
    expect(executor.spawn).toHaveBeenCalledWith(
      paths.plan.monitorSessionName,
      "bash",
      expect.any(Array),
      expect.objectContaining({ cwd: paths.node.workspacePath }),
    );
    expect(currentAttempt(paths.runJsonPath, paths.attempt.id).phase).toBe("instructions_submitted");
  });

  it("keeps capacity and worktree ownership when PTY removal cannot be proven", async () => {
    const paths = fixture("pty_allocated");
    const executor = fakeExecutor(
      [{ name: paths.plan.sessionName, alive: true }],
      { removalSticks: false },
    );

    await expect(recoverInterruptedRoutedBootstrap({
      context: paths.context,
      attempt: currentAttempt(paths.runJsonPath, paths.attempt.id),
      executor,
    })).rejects.toThrow(/PTY removal could not be proven/);
    expect(existsSync(paths.node.worktreeRoot)).toBe(true);
    const attempt = currentAttempt(paths.runJsonPath, paths.attempt.id);
    expect(attempt.phase).toBe("pty_allocated");
    expect(attempt.capacitySlotReleasedAt).toBeUndefined();
  });
});
