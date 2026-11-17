import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import config from "@/lib/config";
import { startRunnerV2Bootstrap } from "@/lib/runner-v2/bootstrap-executor";
import {
  recoverInterruptedRoutedBootstrap,
  type RoutedBootstrapRecoveryResult,
} from "@/lib/runner-v2/bootstrap-recovery";
import { readRunnerV2AttemptState, isTerminalAgentAttemptPhase, type AgentAttemptRecord } from "@/lib/runner-v2/agent-attempt";
import { authorizeTypedRelaunch } from "@/lib/runner-v2/error-handling";
import {
  bindRoutedLaunchJobAttempt,
  blockRoutedLaunchJob,
  claimRoutedLaunchJob,
  completeRoutedLaunchJob,
  blockPastBoundResumeLaunchJob,
  readRoutedLaunchJob,
  readRoutedLaunchJobs,
  releaseRoutedLaunchJob,
  routedLaunchJobIsReclaimable,
  routedLaunchJobLeaseOwned,
  RESUME_LAUNCH_CREDENTIALS_UNAVAILABLE_REASON,
  RESUME_LAUNCH_DISPATCH_BOUND_REASON,
  startRoutedLaunchJobHeartbeat,
  type RoutedLaunchJob,
} from "@/lib/runner-v2/launch-job";
import { startLaunchCoordinatorHeartbeat } from "@/lib/runner-v2/launch-coordinator-state";
import { discoverScopedRunJsonPaths } from "@/lib/runner-v2/run-scope";
import { readRunJson, updateRunJson } from "@/lib/runner-v2/run-state";
import { buildChildEnv } from "@/lib/runs/child-env";
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
  /**
   * Reconstruct the scoped session token and profile/secrets for an accepted
   * resume job at claim time (issue #142 round 2). When provided and the run
   * carries an accepted resumeAttempt, it MUST succeed before any PTY effect;
   * failure blocks the job visibly instead of launching unauthenticated or
   * different work. Returns only in-memory env; token/secret values are never
   * persisted. The route-spawned coordinator does not need it (it inherits the
   * canonical env), so it stays optional.
   */
  reconstructResumeEnvironment?: (job: RoutedLaunchJob) => Promise<Record<string, string>>;
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
    // Accepted resume jobs (issue #142 round 2): reconstruct the scoped
    // session identity and profile/secrets at claim time, BEFORE any PTY
    // effect. A reconstruction failure blocks the job with the typed terminal
    // code `resume_credentials_unavailable` (round 5): that blocked job is the
    // one durable signal, and the reaper alone turns it into the guarded task
    // pause and the run stop, so the scanner cannot relaunch it silently.
    // The persisted reason is secret-free by construction: only the message
    // of the helper's own typed error (identifiers only) is kept; any other
    // exception is reduced to its class name. If the block write itself
    // throws, the outer catch requeues the job and the attempt ceiling ends it.
    let resumeEnvironment: Record<string, string> | undefined;
    if (dependencies.reconstructResumeEnvironment && runHasAcceptedResume(input.runJsonPath)) {
      try {
        resumeEnvironment = await dependencies.reconstructResumeEnvironment(claimed);
      } catch (error) {
        const safeDetail = error instanceof Error && error.name === "UnresolvedResumeCredentialError"
          ? error.message
          : `unexpected ${error instanceof Error ? error.name : "error"} while rebuilding credentials`;
        const reason = `${RESUME_LAUNCH_CREDENTIALS_UNAVAILABLE_REASON} (${safeDetail})`;
        blockRoutedLaunchJob({
          runJsonPath: input.runJsonPath,
          jobId: input.jobId,
          ownerId: input.ownerId,
          reason,
          terminalCode: "resume_credentials_unavailable",
        });
        return { status: "blocked", jobId: input.jobId, error: reason };
      }
    }
    const chain = JSON.parse(readFileSync(claimed.chainPath, "utf8")) as { id?: string; name?: string };
    const targetResults = await Promise.allSettled(claimed.targets.map((target) => runLaunchTarget({
      runJsonPath: input.runJsonPath,
      job: claimed,
      ownerId: input.ownerId,
      agentId: target.agentId,
      chain,
      dependencies,
      ...(resumeEnvironment ? { resumeEnvironment } : {}),
    })));
    const rejectedTarget = targetResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (rejectedTarget) throw rejectedTarget.reason;

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
    // Liveness bound (#142 r3, round 5): a requeue loop that has aged past
    // the dispatch bound (or blown its attempt ceiling) ENDS here instead of
    // requeueing forever, and ONLY for the job bound to the run's accepted
    // resume attempt; any other job keeps its ordinary requeue. The worker
    // only blocks the job with its typed code. It never stops the run: it
    // cannot see live PTY sessions, so the run stop and the task pause belong
    // to the reaper, which keys on the blocked job. The persisted reason is
    // the fixed constant; the launch error stays in this process's result.
    if (blockPastBoundResumeLaunchJobUnderLock(input.runJsonPath, input.jobId)) {
      return {
        status: "blocked",
        jobId: input.jobId,
        error: `${RESUME_LAUNCH_DISPATCH_BOUND_REASON} (last error: ${message})`,
      };
    }
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
  resumeEnvironment?: Record<string, string>;
}): Promise<void> {
  if (!routedLaunchJobLeaseOwned({
    runJsonPath: input.runJsonPath,
    jobId: input.job.id,
    ownerId: input.ownerId,
  })) throw new Error(`routed launch job ownership lost: ${input.job.id}`);

  // A resumed launch runs on the canonical sanitized env: the job's persisted
  // subset plus the just-reconstructed scoped credentials, inheriting only the
  // allowlisted worker env (PTY daemon socket, capacity settings) — the same
  // allowlist the route used, so worker and launcher see one environment.
  const inherited = input.resumeEnvironment
    ? buildChildEnv({})
    : (input.dependencies.processEnv || process.env);
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    ...input.job.environment,
    ...(input.resumeEnvironment || {}),
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
  // A routing-driven revisit targets an agent whose previous occurrence is
  // already terminal (the 1 -> 2 -> back-to-1 loop shape). The bootstrap gate
  // admits a terminal-attempt agent only with a durable fresh-occurrence
  // authorization — the same documented mechanism the resume route and retry
  // relaunches use — so authorize one scoped to this agent and this launch job
  // before the direct bootstrap instead of failing closed on the terminal
  // attempt. Skipped when the terminal attempt already belongs to this job: a
  // replayed job id must not bootstrap a second occurrence of work it already
  // produced.
  const latestForAgent = [...readRunnerV2AttemptState(input.runJsonPath).attempts]
    .reverse()
    .find((attempt) => attempt.runId === input.job.runId && attempt.agentId === input.agentId);
  if (
    latestForAgent
    && isTerminalAgentAttemptPhase(latestForAgent.phase)
    && latestForAgent.launchJobId !== input.job.id
  ) {
    authorizeTypedRelaunch(input.runJsonPath, input.job.runId, {
      agentId: input.agentId,
      launchJobId: input.job.id,
    });
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

/**
 * Minimal, dependency-free check that the run record carries an ACCEPTED
 * resumeAttempt (the full parser lives web-side in resume-attempt.ts and must
 * not be dragged into the runner bundle). Unreadable/absent -> false: an
 * ordinary (non-resume) routed launch job takes the legacy env merge.
 */
function runHasAcceptedResume(runJsonPath: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(runJsonPath, "utf8")) as { resumeAttempt?: { outcome?: unknown } };
    return raw?.resumeAttempt?.outcome === "accepted";
  } catch {
    return false;
  }
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

/**
 * Block the run's bound accepted resume launch job under the run.json lock
 * when it is `jobId` and past its dispatch bound. Returns whether THIS job
 * ended up blocked with the dispatch-bound code. A failed write is logged,
 * never thrown: the job stays queued and the next requeue or the reaper
 * retries the same idempotent fold.
 */
function blockPastBoundResumeLaunchJobUnderLock(runJsonPath: string, jobId: string): boolean {
  let blocked = false;
  try {
    updateRunJson(runJsonPath, (run) => {
      if (!run) throw new Error(`run.json not found: ${runJsonPath}`);
      if (readBoundJobId(run) !== jobId) return run;
      const next = blockPastBoundResumeLaunchJob(run);
      if (!next) return run;
      blocked = true;
      return next;
    });
  } catch (error) {
    console.error(
      `[runner-v2] resume dispatch-bound block failed for ${runJsonPath}: ${errorMessage(error)}`,
    );
    return false;
  }
  return blocked;
}

function readBoundJobId(run: object): string | undefined {
  const attempt = (run as { resumeAttempt?: unknown }).resumeAttempt;
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) return undefined;
  const record = attempt as { outcome?: unknown; launchJobId?: unknown };
  return record.outcome === "accepted" && typeof record.launchJobId === "string" ? record.launchJobId : undefined;
}

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
      // The scan never expires a job (#142 round 5): it cannot see live PTY
      // sessions, so a reclaimable job, however old, gets its ordinary
      // dispatch and interrupted-bootstrap recovery. A never-claimed bound
      // job is ended by the reaper; a failing one by the requeue ceiling.
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
