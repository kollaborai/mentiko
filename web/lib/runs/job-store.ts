import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import config, { nsPath } from "@/lib/config";
import { isPayloadCompatibleWithKind, jobTypeToGenerationKind } from "@/lib/generation/payload-contract";

/**
 * Resolve the jobs directory for a given namespace.
 * Falls back to default namespace if none provided.
 */
function getJobsDir(namespaceId?: string): string {
  const nsId = namespaceId || config.namespaceId;
  return nsPath(nsId, "jobs");
}

export type JobType = "recommend" | "generate" | "link" | "task" | "agent" | "artifact" | "decision_research" | "decision_steering" | "decision_retrospective" | "decision_guided_questions" | "decision_guided_options" | "decision_guided_plan" | "preference_synthesis" | "agent_edit" | "webhook_inbound" | "webhook_outbound" | "event_trigger" | "template_test" | "link_summary" | "task_run_summary";
export type JobStatus = "pending" | "running" | "complete" | "failed";

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  taskId?: string;
  decisionId?: string;  // for decision research/retrospective jobs
  runId?: string;
  chainId?: string;
  createdBy?: string;   // user id of creator
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// stale detection: generation chains can run up to 8min; leave room for import.
const STALE_MS = 10 * 60 * 1000;
const FAILED_RUN_STATUSES = new Set(["blocked", "cancelled", "failed", "stopped"]);
const COMPLETED_RUN_STATUSES = new Set(["complete", "completed"]);

function getJobPath(id: string, namespaceId?: string): string {
  return join(getJobsDir(namespaceId), `${id}.json`);
}

function getTmpPath(id: string, namespaceId?: string): string {
  return join(getJobsDir(namespaceId), `${id}.tmp`);
}

function readCompletedRunResult(
  runId: string,
  namespaceId?: string,
  kind = "",
): Record<string, unknown> | undefined {
  const nsId = namespaceId || config.namespaceId;
  const artifactsDir = nsPath(nsId, "runs", runId, "artifacts");
  const generationResultPath = join(artifactsDir, "generation-result.json");
  if (!existsSync(generationResultPath)) return undefined;

  try {
    const output = readFileSync(generationResultPath, "utf-8");
    const parsed = JSON.parse(output);
    // Gate the hydrated artifact through the SAME contract the CLI import path
    // uses (isPayloadCompatibleWithKind), so an unrelated/incompatible JSON
    // artifact can no longer hydrate a completed generation/recommend job
    // in-process as a lone { output } envelope. kind === "" (non-generation
    // jobs) is ungated — the default branch returns true.
    if (!isPayloadCompatibleWithKind(parsed, kind)) return undefined;
    return { output };
  } catch {
    return undefined;
  }
}

function isGenerationArtifactJob(job: Job): boolean {
  return job.type === "generate" || job.type === "recommend";
}

function syncRunningJobFromGenerationArtifact(job: Job, namespaceId?: string): boolean {
  if (job.status !== "running" || !job.runId || !isGenerationArtifactJob(job)) return false;

  const result = readCompletedRunResult(job.runId, namespaceId, jobTypeToGenerationKind(job.type));
  if (!result) return false;

  job.status = "complete";
  job.result = job.result || result;
  delete job.error;
  job.completedAt = new Date().toISOString();
  return true;
}

function syncRunningJobFromRun(job: Job, namespaceId?: string): boolean {
  if (job.status !== "running" || !job.runId) return false;

  const nsId = namespaceId || config.namespaceId;
  const runPath = join(nsPath(nsId, "runs", job.runId), "run.json");
  if (!existsSync(runPath)) return false;

  try {
    const run = JSON.parse(readFileSync(runPath, "utf-8")) as { status?: string; status_message?: string; error?: string };
    if (!run.status) return false;

    if (COMPLETED_RUN_STATUSES.has(run.status)) {
      job.status = "complete";
      job.result = job.result || readCompletedRunResult(job.runId, namespaceId, jobTypeToGenerationKind(job.type));
      job.completedAt = new Date().toISOString();
      return true;
    }

    if (!FAILED_RUN_STATUSES.has(run.status)) return false;

    job.status = "failed";
    job.error = run.error || run.status_message || `Run ${job.runId} ${run.status}`;
    job.completedAt = new Date().toISOString();
    return true;
  } catch {
    return false;
  }
}

function syncJobStatus(job: Job, namespaceId?: string): boolean {
  if (syncRunningJobFromGenerationArtifact(job, namespaceId)) {
    return true;
  }

  if (syncRunningJobFromRun(job, namespaceId)) {
    return true;
  }

  if (job.status === "running" && job.startedAt) {
    const started = new Date(job.startedAt).getTime();
    if (Date.now() - started > STALE_MS) {
      job.status = "failed";
      job.error = "Job timed out (stale)";
      job.completedAt = new Date().toISOString();
      return true;
    }
  }

  return false;
}

// atomic write: write to .tmp then rename (rename is atomic on POSIX)
function writeJobAtomic(id: string, data: Job, namespaceId?: string): void {
  const tmpPath = getTmpPath(id, namespaceId);
  const finalPath = getJobPath(id, namespaceId);
  // ensure directory exists
  mkdirSync(getJobsDir(namespaceId), { recursive: true });

  writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmpPath, finalPath);
}

export function createJob(
  type: JobType,
  input: Record<string, unknown>,
  taskId?: string,
  decisionId?: string,
  createdBy?: string,
  namespaceId?: string
): Job {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const job: Job = {
    id,
    type,
    status: "pending",
    taskId,
    decisionId,
    createdBy,
    input,
    createdAt: new Date().toISOString(),
  };

  writeJobAtomic(id, job, namespaceId);
  return job;
}

export function getJob(id: string, namespaceId?: string): Job | null {
  const path = getJobPath(id, namespaceId);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, "utf-8");
    const job = JSON.parse(content) as Job;

    if (syncJobStatus(job, namespaceId)) {
      writeJobAtomic(id, job, namespaceId);
    }

    return job;
  } catch {
    return null;
  }
}

export function updateJob(id: string, updates: Partial<Job>, namespaceId?: string): void {
  const existing = getJob(id, namespaceId);
  if (!existing) {
    throw new Error(`Job ${id} not found`);
  }

  const updated: Job = { ...existing, ...updates };
  writeJobAtomic(id, updated, namespaceId);
}

export interface ListOptions {
  taskId?: string;
  status?: JobStatus;
  since?: string; // iso date
}

export function listJobs(opts: ListOptions = {}, namespaceId?: string): Job[] {
  const jobsDir = getJobsDir(namespaceId);
  if (!existsSync(jobsDir)) {
    return [];
  }

  const files = readdirSync(jobsDir).filter(f => f.endsWith(".json"));
  const jobs: Job[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(jobsDir, file), "utf-8");
      const job = JSON.parse(content) as Job;
      if (syncJobStatus(job, namespaceId)) {
        writeJobAtomic(job.id, job, namespaceId);
      }
      jobs.push(job);
    } catch {
      // skip corrupt files
    }
  }

  // sort by createdAt desc
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // filters
  let filtered = jobs;
  if (opts.taskId) {
    filtered = filtered.filter(j => j.taskId === opts.taskId);
  }
  if (opts.status) {
    filtered = filtered.filter(j => j.status === opts.status);
  }
  if (opts.since) {
    const since = new Date(opts.since).getTime();
    filtered = filtered.filter(j => new Date(j.createdAt).getTime() >= since);
  }

  return filtered;
}

export function deleteJob(id: string, namespaceId?: string): boolean {
  const path = getJobPath(id, namespaceId);
  if (!existsSync(path)) {
    return false;
  }
  try {
    unlinkSync(path);
    // also clean up .tmp if it exists
    const tmpPath = getTmpPath(id, namespaceId);
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
    return true;
  } catch {
    return false;
  }
}

export function cleanupOldJobs(maxAgeMs: number, namespaceId?: string): number {
  const jobsDir = getJobsDir(namespaceId);
  if (!existsSync(jobsDir)) {
    return 0;
  }

  const cutoff = Date.now() - maxAgeMs;
  const files = readdirSync(jobsDir).filter(f => f.endsWith(".json"));
  let cleaned = 0;

  for (const file of files) {
    try {
      const content = readFileSync(join(jobsDir, file), "utf-8");
      const job = JSON.parse(content) as Job;
      const created = new Date(job.createdAt).getTime();

      if (created < cutoff) {
        unlinkSync(join(jobsDir, file));
        cleaned++;
      }
    } catch {
      // delete corrupt files too
      try {
        unlinkSync(join(jobsDir, file));
        cleaned++;
      } catch {}
    }
  }

  return cleaned;
}
