import { join } from "node:path";
import { pty } from "@/lib/pty/pty-client";
import {
  buildAgentBootstrapPlan,
  retargetAgentBootstrapPlan,
  type AgentBootstrapPlan,
} from "@/lib/runner-v2/agent-bootstrap-plan";
import {
  readRunnerV2AttemptState,
  transitionAgentAttempt,
  type AgentAttemptRecord,
  type AgentAttemptTerminalReason,
} from "@/lib/runner-v2/agent-attempt";
import { cleanupGitNodeWorkspaceDurably } from "@/lib/runner-v2/workspace-cleanup";
import {
  initializeGitRunWorkspaceIsolation,
  readGitNodeWorkspace,
  type GitRunWorkspaceIsolation,
} from "@/lib/runner-v2/workspace-isolation";
import { readRunJson, type RunRecord } from "@/lib/runner-v2/run-state";
import type { RunnerV2LaunchContext } from "@/lib/runner-v2/types";

const INTERRUPTED_PRE_INSTRUCTION_PHASES = new Set([
  "pty_allocated",
  "process_spawned",
  "ready_for_instructions",
]);

export interface BootstrapRecoverySession {
  name: string;
  alive: boolean;
}

export interface BootstrapRecoveryExecutor {
  remove(name: string): Promise<void>;
  list(): Promise<BootstrapRecoverySession[]>;
  spawn(
    name: string,
    cmd?: string,
    args?: string[],
    opts?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ name: string; pid: number }>;
}

export type RoutedBootstrapRecoveryResult =
  | { status: "retry"; cleanupOutcome?: "removed" | "already-removed" }
  | { status: "started"; monitor: "already-running" | "restarted" }
  | { status: "blocked"; reason: string };

function requireAgentId(context: RunnerV2LaunchContext): string {
  if (!context.agentId) throw new Error("routed bootstrap recovery requires an agent id");
  return context.agentId;
}

function basePlan(context: RunnerV2LaunchContext): AgentBootstrapPlan {
  return buildAgentBootstrapPlan({
    chainPath: context.chainPath,
    runDir: context.runDir,
    runId: context.runId,
    agentId: requireAgentId(context),
    workspacePath: context.workspacePath,
    env: context.env,
  });
}

function runWorkspace(
  context: RunnerV2LaunchContext,
  run: RunRecord,
): GitRunWorkspaceIsolation | undefined {
  const execution = run.workspaceExecution;
  if (
    !execution
    || execution.tracking !== "git"
    || execution.isolation !== "git-worktree"
  ) {
    return undefined;
  }
  return initializeGitRunWorkspaceIsolation({
    runId: context.runId,
    runDir: context.runDir,
    baseline: execution.baseline,
  });
}

function assertAttemptIdentity(
  context: RunnerV2LaunchContext,
  attempt: AgentAttemptRecord,
  plan: AgentBootstrapPlan,
): void {
  const launchJobId = context.env.MENTIKO_LAUNCH_JOB_ID;
  if (
    attempt.runId !== context.runId
    || attempt.agentId !== plan.agentId
    || !launchJobId
    || attempt.launchJobId !== launchJobId
    || attempt.leaseId !== plan.sessionName
    || (
      attempt.processEvidence?.ptySessionId
      && attempt.processEvidence.ptySessionId !== plan.sessionName
    )
  ) {
    throw new Error(`interrupted bootstrap identity mismatch: ${attempt.id}`);
  }
}

async function removeSessionAndProveAbsent(
  executor: BootstrapRecoveryExecutor,
  sessionName: string,
): Promise<void> {
  await executor.remove(sessionName);
  const remaining = await executor.list();
  if (remaining.some((session) => session.name === sessionName)) {
    throw new Error(`PTY removal could not be proven for ${sessionName}`);
  }
}

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function latestAttempt(runJsonPath: string, attemptId: string): AgentAttemptRecord {
  const attempt = readRunnerV2AttemptState(runJsonPath).attempts
    .find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error(`AgentAttempt not found during bootstrap recovery: ${attemptId}`);
  return attempt;
}

function releaseInterruptedAttempt(input: {
  runJsonPath: string;
  attemptId: string;
  reason: AgentAttemptTerminalReason;
  detail: string;
  blocked: boolean;
}): void {
  let attempt = latestAttempt(input.runJsonPath, input.attemptId);
  if (attempt.phase === "released") return;
  if (input.blocked) {
    attempt = transitionAgentAttempt({
      runJsonPath: input.runJsonPath,
      attemptId: input.attemptId,
      to: "human_action_required",
      reason: input.reason,
      detail: input.detail,
    });
  }
  transitionAgentAttempt({
    runJsonPath: input.runJsonPath,
    attemptId: attempt.id,
    to: "released",
    reason: input.blocked ? "released" : input.reason,
    detail: input.detail,
  });
}

async function ensureSubmittedAttemptMonitor(input: {
  context: RunnerV2LaunchContext;
  attempt: AgentAttemptRecord;
  executor: BootstrapRecoveryExecutor;
  run: RunRecord;
  sourcePlan: AgentBootstrapPlan;
  runJsonPath: string;
}): Promise<RoutedBootstrapRecoveryResult> {
  const isolated = runWorkspace(input.context, input.run);
  const plan = isolated
    ? retargetAgentBootstrapPlan(
      input.sourcePlan,
      readGitNodeWorkspace({
        runWorkspace: isolated,
        agentId: input.attempt.agentId,
        attemptId: input.attempt.id,
      }).workspacePath,
      input.context.env,
    )
    : input.sourcePlan;
  const sessions = await input.executor.list();
  const monitor = sessions.find((session) => session.name === plan.monitorSessionName);
  if (monitor?.alive) return { status: "started", monitor: "already-running" };
  if (monitor) {
    await removeSessionAndProveAbsent(input.executor, plan.monitorSessionName);
  }
  const spawned = await input.executor.spawn(
    plan.monitorSessionName,
    "bash",
    ["-lc", plan.monitorCommand],
    {
      cwd: plan.projectRoot,
      env: definedEnv({
        PATH: plan.runContextExports.PATH || process.env.PATH || "",
        MENTIKO_RUNNER_V2_ACTIVE: "1",
        MENTIKO_RUNNER_V2_MODE: "typed-plan",
        ...plan.runContextExports,
      }),
    },
  );
  if (spawned.name !== plan.monitorSessionName) {
    throw new Error(`monitor PTY identity mismatch for ${input.attempt.id}`);
  }
  const after = await input.executor.list();
  if (!after.some((session) => session.name === plan.monitorSessionName && session.alive)) {
    const current = latestAttempt(input.runJsonPath, input.attempt.id);
    if (current.phase !== "completed" && current.phase !== "completion_failed") {
      throw new Error(`monitor restart could not be proven for ${input.attempt.id}`);
    }
  }
  return { status: "started", monitor: "restarted" };
}

export async function recoverInterruptedRoutedBootstrap(input: {
  context: RunnerV2LaunchContext;
  attempt: AgentAttemptRecord;
  executor?: BootstrapRecoveryExecutor;
}): Promise<RoutedBootstrapRecoveryResult> {
  const executor = input.executor || pty;
  const runJsonPath = join(input.context.runDir, "run.json");
  const run = readRunJson(runJsonPath);
  const plan = basePlan(input.context);
  assertAttemptIdentity(input.context, input.attempt, plan);

  if (input.attempt.phase === "instructions_submitted") {
    return ensureSubmittedAttemptMonitor({
      context: input.context,
      attempt: input.attempt,
      executor,
      run,
      sourcePlan: plan,
      runJsonPath,
    });
  }
  if (!INTERRUPTED_PRE_INSTRUCTION_PHASES.has(input.attempt.phase)) {
    throw new Error(
      `AgentAttempt ${input.attempt.id} is not recoverable from ${input.attempt.phase}`,
    );
  }

  await removeSessionAndProveAbsent(executor, plan.monitorSessionName);
  await removeSessionAndProveAbsent(executor, plan.sessionName);

  const isolated = runWorkspace(input.context, run);
  const cleanup = isolated
    ? cleanupGitNodeWorkspaceDurably({
      runWorkspace: isolated,
      agentId: input.attempt.agentId,
      attemptId: input.attempt.id,
      mode: "pristine-startup",
    })
    : undefined;
  if (cleanup?.outcome === "preserved-changes") {
    const detail = `interrupted attempt ${input.attempt.id} changed its isolated worktree; preserved for review`;
    releaseInterruptedAttempt({
      runJsonPath,
      attemptId: input.attempt.id,
      reason: "interrupted_bootstrap_changes",
      detail,
      blocked: true,
    });
    return { status: "blocked", reason: detail };
  }
  const cleanupOutcome: "removed" | "already-removed" | undefined = cleanup?.outcome;
  if (input.attempt.instructionLedger.length > 0) {
    const detail = `instruction intent for ${input.attempt.id} was durable but physical PTY delivery was not provable`;
    releaseInterruptedAttempt({
      runJsonPath,
      attemptId: input.attempt.id,
      reason: "instruction_delivery_ambiguous",
      detail,
      blocked: true,
    });
    return { status: "blocked", reason: detail };
  }

  releaseInterruptedAttempt({
    runJsonPath,
    attemptId: input.attempt.id,
    reason: "launch_coordinator_interrupted",
    detail: `coordinator stopped before instruction delivery for ${input.attempt.id}; PTYs and worktree were reclaimed`,
    blocked: false,
  });
  return {
    status: "retry",
    ...(cleanupOutcome ? { cleanupOutcome } : {}),
  };
}
