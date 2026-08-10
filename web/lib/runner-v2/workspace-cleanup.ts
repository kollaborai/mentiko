import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import config from "@/lib/config";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import { discoverScopedRunJsonPaths } from "@/lib/runner-v2/run-scope";
import { readRunJson } from "@/lib/runner-v2/run-state";
import {
  readGitRunWorkspaceIsolationFromRunDir,
  removeIntegratedGitNodeWorkspace,
  removePristineGitNodeWorkspace,
  type GitRunWorkspaceIsolation,
} from "@/lib/runner-v2/workspace-isolation";

const CLEANUP_VERSION = 1 as const;

export type GitNodeWorkspaceCleanupMode = "integrated" | "pristine-startup";
export type GitNodeWorkspaceCleanupOutcome =
  | "removed"
  | "already-removed"
  | "preserved-conflict"
  | "preserved-changes";

export interface GitNodeWorkspaceCleanupJob {
  version: typeof CLEANUP_VERSION;
  kind: "git-node-workspace-cleanup";
  id: string;
  runId: string;
  agentId: string;
  attemptId: string;
  mode: GitNodeWorkspaceCleanupMode;
  pendingPath: string;
  requestedAt: string;
}

export interface GitNodeWorkspaceCleanupReceipt extends Omit<GitNodeWorkspaceCleanupJob, "kind"> {
  kind: "git-node-workspace-cleanup-receipt";
  outcome: GitNodeWorkspaceCleanupOutcome;
  completedPath: string;
  completedAt: string;
}

type CleanupRequest = {
  runWorkspace: GitRunWorkspaceIsolation;
  agentId: string;
  attemptId: string;
  now?: Date;
  afterCleanup?: (outcome: GitNodeWorkspaceCleanupOutcome) => void;
};

type IntegratedCleanupReceipt = GitNodeWorkspaceCleanupReceipt & {
  mode: "integrated";
  outcome: "removed" | "already-removed" | "preserved-conflict";
};

type PristineCleanupReceipt = GitNodeWorkspaceCleanupReceipt & {
  mode: "pristine-startup";
  outcome: "removed" | "already-removed" | "preserved-changes";
};

function cleanupId(mode: GitNodeWorkspaceCleanupMode, attemptId: string): string {
  return createHash("sha256").update(`${mode}\0${attemptId}`).digest("hex");
}

function cleanupRoot(runWorkspace: GitRunWorkspaceIsolation): string {
  return join(runWorkspace.isolationRoot, "cleanup");
}

function pendingPath(
  runWorkspace: GitRunWorkspaceIsolation,
  mode: GitNodeWorkspaceCleanupMode,
  attemptId: string,
): string {
  return join(cleanupRoot(runWorkspace), "pending", `${cleanupId(mode, attemptId)}.json`);
}

function completedPath(runWorkspace: GitRunWorkspaceIsolation, jobId: string): string {
  return join(cleanupRoot(runWorkspace), "completed", `${jobId}.json`);
}

function readJson(path: string): unknown {
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`workspace cleanup record cannot be a symbolic link: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function writeJsonOnce<T>(path: string, value: T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) return readJson(path) as T;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try {
      linkSync(temporary, path);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return readJson(path) as T;
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function assertJob(
  value: unknown,
  runWorkspace: GitRunWorkspaceIsolation,
  path: string,
): GitNodeWorkspaceCleanupJob {
  const job = value as Partial<GitNodeWorkspaceCleanupJob>;
  const mode: GitNodeWorkspaceCleanupMode | undefined =
    job.mode === "integrated" || job.mode === "pristine-startup" ? job.mode : undefined;
  const attemptId = typeof job.attemptId === "string" && job.attemptId.length > 0
    ? job.attemptId
    : undefined;
  const expectedId = mode && attemptId
    ? cleanupId(mode, attemptId)
    : undefined;
  const expectedPendingPath = mode && attemptId
    ? pendingPath(runWorkspace, mode, attemptId)
    : undefined;
  if (
    !value
    || typeof value !== "object"
    || job.version !== CLEANUP_VERSION
    || job.kind !== "git-node-workspace-cleanup"
    || typeof job.id !== "string"
    || job.id !== expectedId
    || job.runId !== runWorkspace.runId
    || typeof job.agentId !== "string"
    || job.agentId.length === 0
    || !attemptId
    || !mode
    || job.pendingPath !== path
    || path !== expectedPendingPath
    || typeof job.requestedAt !== "string"
    || !Number.isFinite(Date.parse(job.requestedAt))
  ) {
    throw new Error(`invalid workspace cleanup job: ${path}`);
  }
  return job as GitNodeWorkspaceCleanupJob;
}

function assertReceipt(
  value: unknown,
  job: GitNodeWorkspaceCleanupJob,
  path: string,
): GitNodeWorkspaceCleanupReceipt {
  const receipt = value as Partial<GitNodeWorkspaceCleanupReceipt>;
  const outcomes = new Set<GitNodeWorkspaceCleanupOutcome>([
    "removed",
    "already-removed",
    "preserved-conflict",
    "preserved-changes",
  ]);
  if (
    !value
    || typeof value !== "object"
    || receipt.version !== job.version
    || receipt.kind !== "git-node-workspace-cleanup-receipt"
    || receipt.id !== job.id
    || receipt.runId !== job.runId
    || receipt.agentId !== job.agentId
    || receipt.attemptId !== job.attemptId
    || receipt.mode !== job.mode
    || receipt.pendingPath !== job.pendingPath
    || typeof receipt.requestedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.requestedAt))
    || receipt.completedPath !== path
    || !outcomes.has(receipt.outcome as GitNodeWorkspaceCleanupOutcome)
    || typeof receipt.completedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.completedAt))
  ) {
    throw new Error(`invalid workspace cleanup receipt: ${path}`);
  }
  return receipt as GitNodeWorkspaceCleanupReceipt;
}

function clearPending(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function executeCleanupJob(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  job: GitNodeWorkspaceCleanupJob;
  now?: Date;
  afterCleanup?: (outcome: GitNodeWorkspaceCleanupOutcome) => void;
}): GitNodeWorkspaceCleanupReceipt {
  const completed = completedPath(input.runWorkspace, input.job.id);
  const claim = join(cleanupRoot(input.runWorkspace), "claims", `${input.job.id}.claim`);
  return withExclusiveFileClaim(claim, () => {
    if (existsSync(completed)) {
      const receipt = assertReceipt(readJson(completed), input.job, completed);
      clearPending(input.job.pendingPath);
      return receipt;
    }
    const target = {
      runWorkspace: input.runWorkspace,
      agentId: input.job.agentId,
      attemptId: input.job.attemptId,
    };
    const outcome: GitNodeWorkspaceCleanupOutcome = input.job.mode === "integrated"
      ? removeIntegratedGitNodeWorkspace(target)
      : removePristineGitNodeWorkspace(target);
    input.afterCleanup?.(outcome);
    const candidate: GitNodeWorkspaceCleanupReceipt = {
      ...input.job,
      kind: "git-node-workspace-cleanup-receipt",
      outcome,
      completedPath: completed,
      completedAt: (input.now || new Date()).toISOString(),
    };
    const receipt = assertReceipt(writeJsonOnce(completed, candidate), input.job, completed);
    clearPending(input.job.pendingPath);
    return receipt;
  }, { waitTimeoutMs: 30_000 });
}

export function cleanupGitNodeWorkspaceDurably(
  input: CleanupRequest & { mode: "integrated" },
): IntegratedCleanupReceipt;
export function cleanupGitNodeWorkspaceDurably(
  input: CleanupRequest & { mode: "pristine-startup" },
): PristineCleanupReceipt;
export function cleanupGitNodeWorkspaceDurably(
  input: CleanupRequest & { mode: GitNodeWorkspaceCleanupMode },
): GitNodeWorkspaceCleanupReceipt {
  const path = pendingPath(input.runWorkspace, input.mode, input.attemptId);
  const candidate: GitNodeWorkspaceCleanupJob = {
    version: CLEANUP_VERSION,
    kind: "git-node-workspace-cleanup",
    id: cleanupId(input.mode, input.attemptId),
    runId: input.runWorkspace.runId,
    agentId: input.agentId,
    attemptId: input.attemptId,
    mode: input.mode,
    pendingPath: path,
    requestedAt: (input.now || new Date()).toISOString(),
  };
  const job = assertJob(writeJsonOnce(path, candidate), input.runWorkspace, path);
  if (job.agentId !== input.agentId) {
    throw new Error(`workspace cleanup job belongs to another agent: ${path}`);
  }
  return executeCleanupJob({
    runWorkspace: input.runWorkspace,
    job,
    now: input.now,
    afterCleanup: input.afterCleanup,
  });
}

export function reconcileGitNodeWorkspaceCleanups(input: {
  scopeRoot?: string;
  explicitRunJsonPath?: string;
} = {}): {
  examined: number;
  completed: number;
  preserved: number;
  errors: string[];
} {
  const scopeRoot = input.scopeRoot || config.orgRoot;
  const errors: string[] = [];
  let examined = 0;
  let completed = 0;
  let preserved = 0;
  for (const runJsonPath of discoverScopedRunJsonPaths(scopeRoot, input.explicitRunJsonPath)) {
    try {
      const run = readRunJson(runJsonPath);
      const runWorkspace = readGitRunWorkspaceIsolationFromRunDir({
        runDir: dirname(runJsonPath),
        runId: run.id,
      });
      if (!runWorkspace) continue;
      const pendingDir = join(cleanupRoot(runWorkspace), "pending");
      if (!existsSync(pendingDir)) continue;
      if (lstatSync(pendingDir).isSymbolicLink() || !lstatSync(pendingDir).isDirectory()) {
        throw new Error(`workspace cleanup pending path is not a directory: ${pendingDir}`);
      }
      for (const filename of readdirSync(pendingDir).filter((name) => name.endsWith(".json")).sort()) {
        const path = join(pendingDir, filename);
        examined += 1;
        try {
          const job = assertJob(readJson(path), runWorkspace, path);
          const receipt = executeCleanupJob({ runWorkspace, job });
          completed += 1;
          if (receipt.outcome === "preserved-changes" || receipt.outcome === "preserved-conflict") {
            preserved += 1;
          }
        } catch (error) {
          errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`${runJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { examined, completed, preserved, errors };
}
