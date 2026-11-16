import { createHash } from "node:crypto";
import { readRunJson, updateRunJson, type RunRecord } from "@/lib/runner-v2/run-state";

export type RoutedLaunchJobStatus = "queued" | "leased" | "completed" | "blocked";

export interface RoutedLaunchJobTarget {
  agentId: string;
  attemptId?: string;
}

export interface RoutedLaunchJobLease {
  ownerId: string;
  pid?: number;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface RoutedLaunchJob {
  version: 1;
  id: string;
  occurrenceId: string;
  runId: string;
  runDir: string;
  chainPath: string;
  targets: RoutedLaunchJobTarget[];
  environment: Record<string, string>;
  status: RoutedLaunchJobStatus;
  lease?: RoutedLaunchJobLease;
  attemptCount: number;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  blockedAt?: string;
  lastError?: string;
}

const PERSISTED_ENV_KEYS = new Set([
  "AGENT_FAN_GROUP_ID",
  "AGENTS_DIR",
  "AGENT_PROFILES_DIR",
  "CHAIN_DIR",
  "CONFIG_PROFILES_DIR",
  "EVENTS_DIR",
  "MAX_CONCURRENT_AGENTS",
  "MENTIKO_AGENT_CAP_MAX_WAIT_SECS",
  "MENTIKO_AGENT_CAP_POLL_MAX_SECS",
  "MENTIKO_AGENT_CAP_POLL_SECS",
  "MENTIKO_CAP_DISABLED",
  "MENTIKO_CAP_MAX_WAIT_SECS",
  "MENTIKO_CAP_POLL_MAX_SECS",
  "MENTIKO_CAP_POLL_SECS",
  "MENTIKO_CODE_ROOT",
  "MENTIKO_DEBUG",
  "MENTIKO_GLOBAL_ROOT",
  "MENTIKO_CLI",
  "MENTIKO_MAX_ACTIVE_AGENTS",
  "MENTIKO_MAX_CONCURRENT_CHAINS",
  "MENTIKO_NAMESPACE_ROOT",
  "MENTIKO_ORG_ROOT",
  "MENTIKO_PROJECT_DIR",
  "MENTIKO_PROJECT_ID",
  "MENTIKO_PROJECT_ROOT",
  "MENTIKO_TASK_ID",
  "MENTIKO_WEB_URL",
  "MENTIKO_WORKSPACE_BASE_COMMIT",
  "MENTIKO_WORKSPACE_PATH",
  "NAMESPACE_ID",
  "ORG_ID",
  "PTY_DAEMON",
  "PTY_MANAGER_DIR",
  "RUNS_DIR",
  "STATE_DIR",
]);

export function routedLaunchJobId(input: {
  occurrenceId: string;
  runId: string;
  targetAgentIds: string[];
}): string {
  const targetAgentIds = normalizeTargetIds(input.targetAgentIds);
  if (!input.occurrenceId) throw new Error("routed launch job requires a completion occurrence id");
  if (!input.runId) throw new Error("routed launch job requires a run id");
  if (targetAgentIds.length === 0) throw new Error("routed launch job requires at least one target");
  const digest = createHash("sha256")
    .update(stableSerialize({ occurrenceId: input.occurrenceId, runId: input.runId, targetAgentIds }))
    .digest("hex")
    .slice(0, 24);
  return `routed-launch:${digest}:v1`;
}

export interface UpsertRoutedLaunchJobInput {
  occurrenceId: string;
  runId: string;
  runDir: string;
  chainPath: string;
  targetAgentIds: string[];
  environment?: Record<string, string | undefined>;
  /**
   * Env keys whose VALUES came from the secrets store (issue #142 round 3).
   * Persistence filters by provenance, not just the key allowlist: a secret
   * mapped to an allowlisted name (e.g. MENTIKO_DEBUG) must never be written
   * into the persisted job environment — whatever its env var name. The
   * launcher child re-derives the same list from the never-persisted
   * MENTIKO_LAUNCH_SECRET_ENV_KEYS marker so its idempotent re-persist
   * computes the identical job.
   */
  excludeEnvKeys?: string[];
  now?: Date;
}

/**
 * Pure form of persistRoutedLaunchJob: fold a queued routed launch job into a
 * run record without touching the filesystem. Lets a caller persist the job as
 * part of a larger atomic run.json transition (the resume route marks the run
 * running and records its launch intent in one write) instead of two writes
 * with a recoverable gap between them. Identity semantics are identical to
 * persistRoutedLaunchJob: an existing job with the same id must have the same
 * identity and is kept as-is.
 */
export function upsertRoutedLaunchJobRecord(
  run: RunRecord,
  input: UpsertRoutedLaunchJobInput,
): { run: RunRecord; job: RoutedLaunchJob } {
  const targetAgentIds = normalizeTargetIds(input.targetAgentIds);
  const expectedId = routedLaunchJobId({
    occurrenceId: input.occurrenceId,
    runId: input.runId,
    targetAgentIds,
  });
  const at = (input.now || new Date()).toISOString();
  const candidate: RoutedLaunchJob = {
    version: 1,
    id: expectedId,
    occurrenceId: input.occurrenceId,
    runId: input.runId,
    runDir: input.runDir,
    chainPath: input.chainPath,
    targets: targetAgentIds.map((agentId) => ({ agentId })),
    environment: persistedEnvironment(input.environment || {}, new Set(input.excludeEnvKeys || [])),
    status: "queued",
    attemptCount: 0,
    createdAt: at,
    updatedAt: at,
  };
  const jobs = launchJobMap(run);
  const existing = jobs[expectedId];
  if (existing) {
    assertSameLaunchIdentity(existing, candidate);
    return { run, job: existing };
  }
  return { run: withLaunchJobs(run, { ...jobs, [expectedId]: candidate }), job: candidate };
}

export function persistRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId?: string;
} & UpsertRoutedLaunchJobInput): RoutedLaunchJob {
  const expectedId = routedLaunchJobId({
    occurrenceId: input.occurrenceId,
    runId: input.runId,
    targetAgentIds: normalizeTargetIds(input.targetAgentIds),
  });
  if (input.jobId && input.jobId !== expectedId) {
    throw new Error(`routed launch job id mismatch: expected ${expectedId}`);
  }
  let persisted: RoutedLaunchJob | undefined;
  updateRunJson(input.runJsonPath, (run) => {
    if (!run) throw new Error(`run.json not found: ${input.runJsonPath}`);
    if (run.id !== input.runId) throw new Error(`routed launch job run id mismatch: ${input.runId}`);
    const result = upsertRoutedLaunchJobRecord(run, input);
    persisted = result.job;
    return result.run;
  });
  if (!persisted) throw new Error(`routed launch job was not persisted: ${expectedId}`);
  return persisted;
}

export function readRoutedLaunchJobs(runJsonPath: string): RoutedLaunchJob[] {
  return Object.values(launchJobMap(readRunJson(runJsonPath)))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

export function readRoutedLaunchJob(runJsonPath: string, jobId: string): RoutedLaunchJob | undefined {
  return launchJobMap(readRunJson(runJsonPath))[jobId];
}

export function claimRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  pid?: number;
  leaseMs: number;
  now?: Date;
}): RoutedLaunchJob | undefined {
  if (!input.ownerId) throw new Error("routed launch job claim requires an owner id");
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0) {
    throw new Error("routed launch job lease must be a positive safe integer");
  }
  const now = input.now || new Date();
  return mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status === "completed" || job.status === "blocked") return undefined;
    if (
      job.status === "leased"
      && job.lease?.ownerId !== input.ownerId
      && Date.parse(job.lease?.expiresAt || "") > now.getTime()
    ) return undefined;
    const at = now.toISOString();
    return {
      ...job,
      status: "leased",
      lease: {
        ownerId: input.ownerId,
        pid: input.pid,
        acquiredAt: job.lease?.ownerId === input.ownerId ? job.lease.acquiredAt : at,
        heartbeatAt: at,
        expiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
      },
      attemptCount: job.lease?.ownerId === input.ownerId ? job.attemptCount : job.attemptCount + 1,
      updatedAt: at,
      lastError: undefined,
    };
  });
}

export function heartbeatRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  leaseMs: number;
  now?: Date;
}): boolean {
  const now = input.now || new Date();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return undefined;
    const at = now.toISOString();
    return {
      ...job,
      lease: {
        ...job.lease,
        heartbeatAt: at,
        expiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
      },
      updatedAt: at,
    };
  }));
}

export function routedLaunchJobLeaseOwned(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  now?: Date;
}): boolean {
  const job = readRoutedLaunchJob(input.runJsonPath, input.jobId);
  const now = (input.now || new Date()).getTime();
  return job?.status === "leased"
    && job.lease?.ownerId === input.ownerId
    && Date.parse(job.lease.expiresAt) > now;
}

export function bindRoutedLaunchJobAttempt(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  agentId: string;
  attemptId: string;
  now?: Date;
}): RoutedLaunchJob {
  const at = (input.now || new Date()).toISOString();
  const updated = mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) {
      throw new Error(`routed launch job lease is not owned: ${input.jobId}`);
    }
    const targetIndex = job.targets.findIndex((target) => target.agentId === input.agentId);
    if (targetIndex < 0) throw new Error(`agent ${input.agentId} is not a target of ${input.jobId}`);
    const targets = [...job.targets];
    const target = targets[targetIndex];
    if (target.attemptId && target.attemptId !== input.attemptId) {
      // A retry after a terminal attempt is allowed; the attempt itself remains
      // immutable history and the job points at the newest authorized attempt.
      targets[targetIndex] = { ...target, attemptId: input.attemptId };
    } else {
      targets[targetIndex] = { ...target, attemptId: target.attemptId || input.attemptId };
    }
    return { ...job, targets, updatedAt: at };
  });
  if (!updated) throw new Error(`routed launch job was not updated: ${input.jobId}`);
  return updated;
}

export function releaseRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  error?: string;
  now?: Date;
}): boolean {
  const at = (input.now || new Date()).toISOString();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return undefined;
    return {
      ...job,
      status: "queued",
      lease: undefined,
      updatedAt: at,
      lastError: input.error,
    };
  }));
}

export function completeRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  now?: Date;
}): boolean {
  const at = (input.now || new Date()).toISOString();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status === "completed") return job;
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return undefined;
    return { ...job, status: "completed", lease: undefined, completedAt: at, updatedAt: at };
  }));
}

export function blockRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  reason: string;
  now?: Date;
}): boolean {
  const at = (input.now || new Date()).toISOString();
  return Boolean(mutateLaunchJob(input.runJsonPath, input.jobId, (job) => {
    if (job.status === "blocked") return job;
    if (job.status !== "leased" || job.lease?.ownerId !== input.ownerId) return undefined;
    return {
      ...job,
      status: "blocked",
      lease: undefined,
      blockedAt: at,
      updatedAt: at,
      lastError: input.reason,
    };
  }));
}

export function routedLaunchJobIsAccepted(job: RoutedLaunchJob): boolean {
  return job.status === "queued" || job.status === "leased" || job.status === "completed" || job.status === "blocked";
}

export function routedLaunchJobIsReclaimable(job: RoutedLaunchJob, now = new Date()): boolean {
  return job.status === "queued"
    || (job.status === "leased" && Date.parse(job.lease?.expiresAt || "") <= now.getTime());
}

/**
 * Liveness bound for accepted resume dispatch (issue #142 round 3): a queued
 * job nobody claims, or one that keeps requeueing on nonterminal launch
 * errors, must END instead of pinning the run in progress forever. Same order
 * as the scanner's preparing bound (10 minutes) and the reaper's handoff
 * windows; the attempt ceiling covers fast requeue loops that never age.
 */
export const RESUME_LAUNCH_DISPATCH_BOUND_MS = 10 * 60_000;
export const RESUME_LAUNCH_ATTEMPT_CEILING = 5;
export const RESUME_LAUNCH_DISPATCH_BOUND_REASON = "accepted resume launch job exceeded its dispatch bound";

export function routedLaunchJobPastDispatchBound(job: RoutedLaunchJob, now = new Date()): boolean {
  if (job.status === "completed" || job.status === "blocked") return false;
  if (job.status === "leased" && Date.parse(job.lease?.expiresAt || "") > now.getTime()) return false;
  return (now.getTime() - Date.parse(job.createdAt) >= RESUME_LAUNCH_DISPATCH_BOUND_MS)
    || job.attemptCount >= RESUME_LAUNCH_ATTEMPT_CEILING;
}

/**
 * Expire ONLY the routed launch job bound to the run's accepted resume
 * attempt (issue #142 round 4), and stop a still-active run with a
 * reaper-style reason. The binding is the `launchJobId` the acceptance write
 * records on resumeAttempt: an accepted record from an older head carries no
 * bound job id and is left entirely alone — the expiry cannot know which job
 * belongs to the attempt, and an unrelated old queued job must never end a
 * resumed run. The run is also never stopped while ANOTHER launch job of the
 * run holds an unexpired lease, or while a caller-provided live-session set
 * still names an incomplete agent's session (the worker bundle has no
 * PTY-daemon access, so only callers that know pass the set). Pure fold for
 * the caller's run.json lock (the worker's dispatch scan, the worker's
 * requeue path, and the web reaper all call it under their own lock): every
 * decision is re-derived against the record passed in, so a job that was
 * claimed or completed while this was deciding is left alone. Returns the
 * updated record, or undefined when the bound job was not past its bound or
 * the run still has live work.
 */
export function expireAcceptedResumeLaunchJobs(
  run: RunRecord,
  input: { now?: Date; liveSessionNames?: ReadonlySet<string> } = {},
): RunRecord | undefined {
  const now = input.now || new Date();
  const resumeAttempt = objectValue(run.resumeAttempt);
  if (!resumeAttempt || resumeAttempt.outcome !== "accepted") return undefined;
  const boundJobId = typeof resumeAttempt.launchJobId === "string" ? resumeAttempt.launchJobId : undefined;
  if (!boundJobId) return undefined;
  const jobs = launchJobMap(run);
  const boundJob = jobs[boundJobId];
  if (!boundJob || !routedLaunchJobPastDispatchBound(boundJob, now)) return undefined;
  const otherActiveLease = Object.entries(jobs).some(([id, job]) => (
    id !== boundJobId
    && job.status === "leased"
    && Date.parse(job.lease?.expiresAt || "") > now.getTime()
  ));
  if (otherActiveLease) return undefined;
  if (input.liveSessionNames) {
    const liveSession = (run.agents || []).some((agent) =>
      agent.status !== "complete"
      && typeof agent.session === "string"
      && agent.session.length > 0
      && input.liveSessionNames!.has(agent.session));
    if (liveSession) return undefined;
  }
  const at = now.toISOString();
  const nextJobs = {
    ...jobs,
    [boundJobId]: {
      ...boundJob,
      status: "blocked" as const,
      lease: undefined,
      blockedAt: at,
      updatedAt: at,
      lastError: RESUME_LAUNCH_DISPATCH_BOUND_REASON,
    },
  };
  let next: RunRecord = withLaunchJobs(run, nextJobs);
  if (run.status === "running" || run.status === "pending") {
    next = {
      ...next,
      status: "stopped",
      completed: next.completed || at,
      statusReason: { actor: "reaper", reason: RESUME_LAUNCH_DISPATCH_BOUND_REASON },
    };
  }
  return next;
}

/**
 * The launch job id bound to the run's ACCEPTED resume attempt, if any.
 * Dependency-light reader for the worker scan (#142 round 4): only the bound
 * job's requeue loop ends at the dispatch bound; every other job keeps its
 * ordinary worker treatment.
 */
export function readAcceptedResumeLaunchJobId(runJsonPath: string): string | undefined {
  try {
    const run = readRunJson(runJsonPath) as RunRecord;
    const resumeAttempt = objectValue(run.resumeAttempt);
    if (!resumeAttempt || resumeAttempt.outcome !== "accepted") return undefined;
    const boundJobId = typeof resumeAttempt.launchJobId === "string" ? resumeAttempt.launchJobId : undefined;
    return boundJobId || undefined;
  } catch {
    return undefined;
  }
}

export function startRoutedLaunchJobHeartbeat(input: {
  runJsonPath: string;
  jobId: string;
  ownerId: string;
  leaseMs: number;
  intervalMs?: number;
}): () => void {
  const interval = setInterval(() => {
    try {
      heartbeatRoutedLaunchJob(input);
    } catch (error) {
      console.error(`[runner-v2] routed launch job heartbeat failed: ${errorMessage(error)}`);
    }
  }, input.intervalMs || Math.max(1_000, Math.floor(input.leaseMs / 4)));
  interval.unref();
  return () => clearInterval(interval);
}

function persistedEnvironment(
  env: Record<string, string | undefined>,
  excludeEnvKeys: Set<string>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(env)
    .filter(([key, value]) => PERSISTED_ENV_KEYS.has(key) && !excludeEnvKeys.has(key) && typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right))) as Record<string, string>;
}

function normalizeTargetIds(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function launchJobMap(run: RunRecord): Record<string, RoutedLaunchJob> {
  const runnerV2 = objectValue(run.runnerV2);
  const raw = objectValue(runnerV2?.launchJobs);
  if (!raw) return {};
  const jobs: Record<string, RoutedLaunchJob> = {};
  for (const [key, value] of Object.entries(raw)) {
    const job = parseLaunchJob(value);
    if (job.id !== key) throw new Error(`corrupt routed launch job key: ${key}`);
    jobs[key] = job;
  }
  return jobs;
}

function parseLaunchJob(value: unknown): RoutedLaunchJob {
  const job = objectValue(value);
  if (!job
    || job.version !== 1
    || typeof job.id !== "string"
    || typeof job.occurrenceId !== "string"
    || typeof job.runId !== "string"
    || typeof job.runDir !== "string"
    || typeof job.chainPath !== "string"
    || !Array.isArray(job.targets)
    || !job.targets.every((target) => {
      const parsed = objectValue(target);
      return typeof parsed?.agentId === "string"
        && (parsed.attemptId === undefined || typeof parsed.attemptId === "string");
    })
    || !objectValue(job.environment)
    || !["queued", "leased", "completed", "blocked"].includes(String(job.status))
    || !Number.isSafeInteger(job.attemptCount)
    || typeof job.createdAt !== "string"
    || (job.updatedAt !== undefined && typeof job.updatedAt !== "string")) {
    throw new Error("corrupt routed launch job record");
  }
  if (job.status === "leased") {
    const lease = objectValue(job.lease);
    if (!lease
      || typeof lease.ownerId !== "string"
      || typeof lease.acquiredAt !== "string"
      || typeof lease.heartbeatAt !== "string"
      || typeof lease.expiresAt !== "string") {
      throw new Error(`corrupt routed launch job lease: ${job.id}`);
    }
  }
  return job as unknown as RoutedLaunchJob;
}

function mutateLaunchJob(
  runJsonPath: string,
  jobId: string,
  update: (job: RoutedLaunchJob) => RoutedLaunchJob | undefined,
): RoutedLaunchJob | undefined {
  let result: RoutedLaunchJob | undefined;
  updateRunJson(runJsonPath, (run) => {
    if (!run) throw new Error(`run.json not found: ${runJsonPath}`);
    const jobs = launchJobMap(run);
    const current = jobs[jobId];
    if (!current) return run;
    result = update(current);
    if (!result) return run;
    return withLaunchJobs(run, { ...jobs, [jobId]: result });
  });
  return result;
}

function withLaunchJobs(run: RunRecord, jobs: Record<string, RoutedLaunchJob>): RunRecord {
  return {
    ...run,
    runnerV2: {
      ...objectValue(run.runnerV2),
      launchJobs: jobs,
    },
  };
}

function assertSameLaunchIdentity(existing: RoutedLaunchJob, expected: RoutedLaunchJob): void {
  const existingIdentity = {
    id: existing.id,
    occurrenceId: existing.occurrenceId,
    runId: existing.runId,
    runDir: existing.runDir,
    chainPath: existing.chainPath,
    targets: existing.targets.map((target) => target.agentId).sort(),
    environment: existing.environment,
  };
  const expectedIdentity = {
    id: expected.id,
    occurrenceId: expected.occurrenceId,
    runId: expected.runId,
    runDir: expected.runDir,
    chainPath: expected.chainPath,
    targets: expected.targets.map((target) => target.agentId).sort(),
    environment: expected.environment,
  };
  if (stableSerialize(existingIdentity) !== stableSerialize(expectedIdentity)) {
    throw new Error(`conflicting routed launch job: ${expected.id}`);
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = objectValue(value);
  if (!record) return JSON.stringify(value);
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
