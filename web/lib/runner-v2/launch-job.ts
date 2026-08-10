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
  updatedAt: string;
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

export function persistRoutedLaunchJob(input: {
  runJsonPath: string;
  jobId?: string;
  occurrenceId: string;
  runId: string;
  runDir: string;
  chainPath: string;
  targetAgentIds: string[];
  environment?: Record<string, string | undefined>;
  now?: Date;
}): RoutedLaunchJob {
  const targetAgentIds = normalizeTargetIds(input.targetAgentIds);
  const expectedId = routedLaunchJobId({
    occurrenceId: input.occurrenceId,
    runId: input.runId,
    targetAgentIds,
  });
  if (input.jobId && input.jobId !== expectedId) {
    throw new Error(`routed launch job id mismatch: expected ${expectedId}`);
  }
  const at = (input.now || new Date()).toISOString();
  const candidate: RoutedLaunchJob = {
    version: 1,
    id: expectedId,
    occurrenceId: input.occurrenceId,
    runId: input.runId,
    runDir: input.runDir,
    chainPath: input.chainPath,
    targets: targetAgentIds.map((agentId) => ({ agentId })),
    environment: persistedEnvironment(input.environment || {}),
    status: "queued",
    attemptCount: 0,
    createdAt: at,
    updatedAt: at,
  };
  let persisted: RoutedLaunchJob | undefined;
  updateRunJson(input.runJsonPath, (run) => {
    if (!run) throw new Error(`run.json not found: ${input.runJsonPath}`);
    if (run.id !== input.runId) throw new Error(`routed launch job run id mismatch: ${input.runId}`);
    const jobs = launchJobMap(run);
    const existing = jobs[expectedId];
    if (existing) {
      assertSameLaunchIdentity(existing, candidate);
      persisted = existing;
      return run;
    }
    persisted = candidate;
    return withLaunchJobs(run, { ...jobs, [expectedId]: candidate });
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

function persistedEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env)
    .filter(([key, value]) => PERSISTED_ENV_KEYS.has(key) && typeof value === "string")
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
    || typeof job.updatedAt !== "string") {
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
