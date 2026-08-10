import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import config from "@/lib/config";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import {
  recoverInterruptedRoutedBootstrap,
  type RoutedBootstrapRecoveryResult,
} from "@/lib/runner-v2/bootstrap-recovery";
import { readRunnerV2AttemptState, type AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import {
  bindRoutedLaunchJobAttempt,
  blockRoutedLaunchJob,
  claimRoutedLaunchJob,
  completeRoutedLaunchJob,
  readRoutedLaunchJob,
  readRoutedLaunchJobs,
  releaseRoutedLaunchJob,
  routedLaunchJobIsReclaimable,
  routedLaunchJobLeaseOwned,
  startRoutedLaunchJobHeartbeat,
  type RoutedLaunchJob,
} from "@/lib/runner-v2/launch-job";
import { startLaunchCoordinatorHeartbeat } from "@/lib/runner-v2/launch-coordinator-state";
import { discoverScopedRunJsonPaths } from "@/lib/runner-v2/run-scope";
import { readRunJson } from "@/lib/runner-v2/run-state";
import type { RunnerV2LaunchContext, RunnerV2LaunchResult } from "@/lib/runner-v2/types";

const DEFAULT_LEASE_MS = 120_000;
const DURABLY_STARTED_ATTEMPT_PHASES = new Set([
  "instructions_submitted",
  "completed",
  "completion_failed",
  "stuck",
]);
const INTERRUPTED_PRE_INSTRUCTION_PHASES = new Set([
  "pty_allocated",
  "process_spawned",
  "ready_for_instructions",
]);
const BLOCKED_ATTEMPT_PHASES = new Set(["startup_failed", "human_action_required"]);
const BLOCKING_TERMINAL_REASONS = new Set([
  "instruction_delivery_ambiguous",
  "interrupted_bootstrap_changes",
]);
const TERMINAL_RUN_STATUSES = new Set(["blocked", "failed", "stopped", "completed", "cancelled"]);

export interface RoutedLaunchJobRunResult {
  status: "busy" | "completed" | "blocked" | "requeued";
  jobId: string;
  error?: string;
}

export interface RoutedLaunchJobRunnerDependencies {
  bootstrap?: (context: RunnerV2LaunchContext) => Promise<RunnerV2LaunchResult>;
  processEnv?: NodeJS.ProcessEnv;
  pid?: number;
  leaseMs?: number;
  recoverInterruptedBootstrap?: (input: {
    context: RunnerV2LaunchContext;
    attempt: AgentAttemptRecord;
  }) => Promise<RoutedBootstrapRecoveryResult>;
}

export async function runRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  dependencies?: RoutedLaunchJobRunnerDependencies;
}): Promise<RoutedLaunchJobRunResult> {
  const dependencies = input.dependencies || {};
  const pid = dependencies.pid || process.pid;
  const leaseMs = dependencies.leaseMs || DEFAULT_LEASE_MS;
  const claimed = claimRoutedLaunchJob({
    runJsonPath: input.runJsonPath,
    jobId: input.jobId,
    ownerId: input.ownerId,
    pid,
    leaseMs,
  });
  if (!claimed) return { status: "busy", jobId: input.jobId };

  const stopJobHeartbeat = startRoutedLaunchJobHeartbeat({
    runJsonPath: input.runJsonPath,
    jobId: input.jobId,
    ownerId: input.ownerId,
    leaseMs,
  });
  const stopHandoffHeartbeat = startLaunchCoordinatorHeartbeat({
    runJsonPath: input.runJsonPath,
    handoffId: input.jobId,
    pid,
    agentIds: claimed.targets.map((target) => target.agentId),
  });
  try {
    const chain = JSON.parse(readFileSync(claimed.chainPath, "utf8")) as { id?: string; name?: string };
    await Promise.all(claimed.targets.map((target) => runLaunchTarget({
      runJsonPath: input.runJsonPath,
      job: claimed,
      ownerId: input.ownerId,
      agentId: target.agentId,
      chain,
      dependencies,
    })));

    if (!routedLaunchJobLeaseOwned({
      runJsonPath: input.runJsonPath,
      jobId: input.jobId,
      ownerId: input.ownerId,
    })) {
      return { status: "busy", jobId: input.jobId };
    }
    const run = readRunJson(input.runJsonPath);
    const observed = claimed.targets.map((target) => ({
      target,
      attempt: latestJobAttempt(input.runJsonPath, input.jobId, target.agentId),
    }));
    const blocked = observed.filter(({ attempt }) => attempt && attemptBlocksLaunch(attempt));
    const missing = observed.filter(({ attempt }) =>
      !attempt || (!DURABLY_STARTED_ATTEMPT_PHASES.has(attempt.phase) && !attemptBlocksLaunch(attempt)));
    if (TERMINAL_RUN_STATUSES.has(run.status) || blocked.length > 0) {
      const blockedAttempt = blocked[0]?.attempt;
      const reason = typeof run.status_message === "string"
        ? run.status_message
        : typeof run.blockedReason === "string"
          ? run.blockedReason
          : blockedAttempt?.terminalDetail
            || blockedAttempt?.terminalReason
            || `routed launch job blocked for run ${run.id}`;
      blockRoutedLaunchJob({
        runJsonPath: input.runJsonPath,
        jobId: input.jobId,
        ownerId: input.ownerId,
        reason,
      });
      return { status: "blocked", jobId: input.jobId, error: reason };
    }
    if (missing.length > 0) {
      throw new Error(
        `launch targets did not reach durable startup: ${missing.map(({ target }) => target.agentId).join(",")}`,
      );
    }
    if (!completeRoutedLaunchJob({
      runJsonPath: input.runJsonPath,
      jobId: input.jobId,
      ownerId: input.ownerId,
    })) {
      return { status: "busy", jobId: input.jobId };
    }
    return { status: "completed", jobId: input.jobId };
  } catch (error) {
    const message = errorMessage(error);
    let terminal = false;
    try {
      terminal = TERMINAL_RUN_STATUSES.has(readRunJson(input.runJsonPath).status);
    } catch {
      terminal = false;
    }
    if (terminal) {
      blockRoutedLaunchJob({
        runJsonPath: input.runJsonPath,
        jobId: input.jobId,
        ownerId: input.ownerId,
        reason: message,
      });
      return { status: "blocked", jobId: input.jobId, error: message };
    }
    releaseRoutedLaunchJob({
      runJsonPath: input.runJsonPath,
      jobId: input.jobId,
      ownerId: input.ownerId,
      error: message,
    });
    return { status: "requeued", jobId: input.jobId, error: message };
  } finally {
    stopJobHeartbeat();
    stopHandoffHeartbeat();
  }
}

async function runLaunchTarget(input: {
  runJsonPath: string;
  job: RoutedLaunchJob;
  ownerId: string;
  agentId: string;
  chain: { id?: string; name?: string };
  dependencies: RoutedLaunchJobRunnerDependencies;
}): Promise<void> {
  if (!routedLaunchJobLeaseOwned({
    runJsonPath: input.runJsonPath,
    jobId: input.job.id,
    ownerId: input.ownerId,
  })) throw new Error(`routed launch job ownership lost: ${input.job.id}`);

  const env: NodeJS.ProcessEnv = {
    ...(input.dependencies.processEnv || process.env),
    ...input.job.environment,
    MENTIKO_RUN_ID: input.job.runId,
    RUN_ID: input.job.runId,
    MENTIKO_RUN_DIR: input.job.runDir,
    MENTIKO_COMPLETION_OCCURRENCE_ID: input.job.occurrenceId,
    MENTIKO_LAUNCH_JOB_ID: input.job.id,
    MENTIKO_LAUNCH_JOB_OWNER_ID: input.ownerId,
    MENTIKO_RUNNER_V2: "1",
    MENTIKO_RUNNER_V2_COMPLETION: "1",
  };
  const context: RunnerV2LaunchContext = {
    chainPath: input.job.chainPath,
    runDir: input.job.runDir,
    runId: input.job.runId,
    agentId: input.agentId,
    chainId: input.chain.id || basename(input.job.chainPath, ".json"),
    chainName: input.chain.name || input.chain.id || basename(input.job.chainPath, ".json"),
    workspacePath: env.MENTIKO_WORKSPACE_PATH,
    taskId: env.MENTIKO_TASK_ID,
    debug: env.MENTIKO_DEBUG === "1",
    logFd: 2,
    cwd: env.MENTIKO_WORKSPACE_PATH || process.cwd(),
    env,
  };
  const prior = latestJobAttempt(input.runJsonPath, input.job.id, input.agentId);
  if (prior && INTERRUPTED_PRE_INSTRUCTION_PHASES.has(prior.phase)) {
    bindRoutedLaunchJobAttempt({
      runJsonPath: input.runJsonPath,
      jobId: input.job.id,
      ownerId: input.ownerId,
      agentId: input.agentId,
      attemptId: prior.id,
    });
    const recover = input.dependencies.recoverInterruptedBootstrap
      || recoverInterruptedRoutedBootstrap;
    const recovery = await recover({ context, attempt: prior });
    if (recovery.status !== "retry") return;
  }
  if (prior?.phase === "instructions_submitted") {
    bindRoutedLaunchJobAttempt({
      runJsonPath: input.runJsonPath,
      jobId: input.job.id,
      ownerId: input.ownerId,
      agentId: input.agentId,
      attemptId: prior.id,
    });
    const recover = input.dependencies.recoverInterruptedBootstrap
      || recoverInterruptedRoutedBootstrap;
    const recovery = await recover({ context, attempt: prior });
    if (recovery.status !== "started") {
      throw new Error(`submitted launch target ${input.agentId} did not recover its monitor`);
    }
    return;
  }
  if (prior && (
    DURABLY_STARTED_ATTEMPT_PHASES.has(prior.phase)
    || attemptBlocksLaunch(prior)
  )) {
    bindRoutedLaunchJobAttempt({
      runJsonPath: input.runJsonPath,
      jobId: input.job.id,
      ownerId: input.ownerId,
      agentId: input.agentId,
      attemptId: prior.id,
    });
    return;
  }
  const bootstrap = input.dependencies.bootstrap || startRunnerV2Bootstrap;
  const result = await bootstrap(context);
  if (result.support === "unsupported") throw new Error(result.reason);
  const current = latestJobAttempt(input.runJsonPath, input.job.id, input.agentId);
  if (!current) throw new Error(`launch target ${input.agentId} did not create an owned AgentAttempt`);
  bindRoutedLaunchJobAttempt({
    runJsonPath: input.runJsonPath,
    jobId: input.job.id,
    ownerId: input.ownerId,
    agentId: input.agentId,
    attemptId: current.id,
  });
}

function attemptBlocksLaunch(attempt: AgentAttemptRecord): boolean {
  return BLOCKED_ATTEMPT_PHASES.has(attempt.phase)
    || Boolean(attempt.terminalReason && BLOCKING_TERMINAL_REASONS.has(attempt.terminalReason));
}

function latestJobAttempt(
  runJsonPath: string,
  jobId: string,
  agentId: string,
): AgentAttemptRecord | undefined {
  return [...readRunnerV2AttemptState(runJsonPath).attempts]
    .reverse()
    .find((attempt) => attempt.agentId === agentId && attempt.launchJobId === jobId);
}

const activeJobs = new Map<string, Promise<RoutedLaunchJobRunResult>>();

export function reconcileRoutedLaunchJobs(input: {
  scopeRoot?: string;
  explicitRunJsonPath?: string;
  leaseMs?: number;
  dependencies?: RoutedLaunchJobRunnerDependencies;
  onError?: (error: Error) => void;
} = {}): { examined: number; scheduled: number; active: number; errors: string[] } {
  const scopeRoot = input.scopeRoot || config.orgRoot;
  const errors: string[] = [];
  let examined = 0;
  let scheduled = 0;
  for (const runJsonPath of discoverScopedRunJsonPaths(scopeRoot, input.explicitRunJsonPath)) {
    let jobs: RoutedLaunchJob[];
    try {
      jobs = readRoutedLaunchJobs(runJsonPath);
    } catch (error) {
      errors.push(`${runJsonPath}: ${errorMessage(error)}`);
      continue;
    }
    for (const job of jobs) {
      examined += 1;
      if (!routedLaunchJobIsReclaimable(job)) continue;
      const key = `${runJsonPath}\0${job.id}`;
      if (activeJobs.has(key)) continue;
      const ownerId = `worker:${process.pid}:${randomUUID()}`;
      const promise = runRoutedLaunchJob({
        runJsonPath,
        jobId: job.id,
        ownerId,
        dependencies: {
          ...input.dependencies,
          leaseMs: input.leaseMs || input.dependencies?.leaseMs,
        },
      });
      activeJobs.set(key, promise);
      scheduled += 1;
      void promise.then((result) => {
        if (result.error) input.onError?.(new Error(result.error));
      }).catch((error) => {
        input.onError?.(error instanceof Error ? error : new Error(String(error)));
      }).finally(() => {
        activeJobs.delete(key);
      });
    }
  }
  return { examined, scheduled, active: activeJobs.size, errors };
}

export function routedLaunchJobForAcceptance(
  runJsonPath: string,
  jobId: string,
  occurrenceId: string,
  runId: string,
  targetAgentIds: string[],
): RoutedLaunchJob | undefined {
  const job = readRoutedLaunchJob(runJsonPath, jobId);
  if (!job || job.occurrenceId !== occurrenceId || job.runId !== runId) return undefined;
  const actual = job.targets.map((target) => target.agentId).sort();
  const expected = [...new Set(targetAgentIds)].sort();
  return JSON.stringify(actual) === JSON.stringify(expected) ? job : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
