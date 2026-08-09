import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const SNAPSHOT_VERSION = 1 as const;
const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export interface GitWorkspaceSnapshot {
  version: typeof SNAPSHOT_VERSION;
  kind: "git";
  capturedAt: string;
  sourceWorkspacePath: string;
  repositoryRoot: string;
  gitCommonDir: string;
  relativeWorkspacePath: string;
  sourceHead?: string;
  sourceBranch?: string;
  baseCommit?: string;
  snapshotCommit: string;
  snapshotTree: string;
  dirtyFromHead: boolean;
}

export interface GitWorkspaceChangeFile {
  path: string;
  status: "added" | "modified" | "deleted" | "type_changed" | "unknown";
  additions: number | null;
  deletions: number | null;
}

export interface GitWorkspaceChangeSet {
  version: typeof SNAPSHOT_VERSION;
  kind: "git";
  baselineCommit: string;
  observedCommit: string;
  relativeWorkspacePath: string;
  files: GitWorkspaceChangeFile[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
  };
  patchSha256: string;
}

export interface CaptureGitWorkspaceSnapshotInput {
  workspacePath: string;
  scratchDir: string;
  label: string;
  capturedAt?: string;
  /**
   * Seed the private index from this commit instead of the worktree's HEAD.
   * Node result capture uses the node's immutable launch commit so commits or
   * edits outside the registered workspace cannot leak into its result.
   */
  baseCommit?: string;
}

interface GitCommandOptions {
  env?: Record<string, string>;
  maxBuffer?: number;
}

export class WorkspaceSnapshotError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "WorkspaceSnapshotError";
  }
}

function runGit(
  cwd: string,
  args: string[],
  options: GitCommandOptions = {},
): string {
  try {
    return execFileSync("git", args, {
      cwd,
      env: { ...process.env, ...options.env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER,
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr || "").trim();
    throw new WorkspaceSnapshotError(
      `git ${args[0] || "command"} failed${detail ? `: ${detail}` : ""}`,
      error,
    );
  }
}

function runGitOptional(
  cwd: string,
  args: string[],
  options: GitCommandOptions = {},
): string | undefined {
  try {
    const value = runGit(cwd, args, options);
    return value || undefined;
  } catch {
    return undefined;
  }
}

function runGitBytes(cwd: string, args: string[]): Buffer {
  try {
    const value = execFileSync("git", args, {
      cwd,
      encoding: "buffer",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr;
    const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr || "").trim();
    throw new WorkspaceSnapshotError(`git diff failed${detail ? `: ${detail}` : ""}`, error);
  }
}

function requireAbsoluteDirectory(path: string, field: string): string {
  if (!isAbsolute(path)) throw new WorkspaceSnapshotError(`${field} must be absolute: ${path}`);
  const resolved = realpathSync(resolve(path));
  if (!lstatSync(resolved).isDirectory()) {
    throw new WorkspaceSnapshotError(`${field} must be a directory: ${resolved}`);
  }
  return resolved;
}

function pathWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function snapshotIdentity(label: string): Record<string, string> {
  const safeLabel = label.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "run";
  return {
    GIT_AUTHOR_NAME: "Mentiko Workspace Snapshot",
    GIT_AUTHOR_EMAIL: "workspace-snapshot@mentiko.local",
    GIT_COMMITTER_NAME: "Mentiko Workspace Snapshot",
    GIT_COMMITTER_EMAIL: "workspace-snapshot@mentiko.local",
    MENTIKO_WORKSPACE_SNAPSHOT_LABEL: safeLabel,
  };
}

/**
 * Capture the exact tracked plus non-ignored workspace state without touching
 * the user's branch, index, or working files. A private temporary Git index
 * materializes a tree; dirty state becomes an unreachable synthetic commit so
 * later comparisons have a stable two-commit boundary.
 */
export function captureGitWorkspaceSnapshot(
  input: CaptureGitWorkspaceSnapshotInput,
): GitWorkspaceSnapshot {
  const sourceWorkspacePath = requireAbsoluteDirectory(input.workspacePath, "workspacePath");
  const scratchDir = requireAbsoluteDirectory(input.scratchDir, "scratchDir");
  const repositoryRootRaw = runGit(sourceWorkspacePath, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = requireAbsoluteDirectory(repositoryRootRaw, "repository root");
  if (!pathWithin(repositoryRoot, sourceWorkspacePath)) {
    throw new WorkspaceSnapshotError(`workspace is outside repository root: ${sourceWorkspacePath}`);
  }
  const gitCommonDirRaw = runGit(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  const gitCommonDir = requireAbsoluteDirectory(
    isAbsolute(gitCommonDirRaw) ? gitCommonDirRaw : resolve(repositoryRoot, gitCommonDirRaw),
    "git common directory",
  );

  const relativeWorkspacePath = relative(repositoryRoot, sourceWorkspacePath) || ".";
  const sourceHead = runGitOptional(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  const sourceBranch = runGitOptional(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const baseCommit = input.baseCommit
    ? runGit(repositoryRoot, ["rev-parse", "--verify", `${input.baseCommit}^{commit}`])
    : sourceHead;
  const capturedAt = input.capturedAt || new Date().toISOString();
  const indexPath = join(
    scratchDir,
    `.workspace-index-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  const identity = snapshotIdentity(input.label);
  const snapshotEnv = {
    ...identity,
    GIT_INDEX_FILE: indexPath,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_AUTHOR_DATE: capturedAt,
    GIT_COMMITTER_DATE: capturedAt,
  };

  try {
    if (baseCommit) runGit(repositoryRoot, ["read-tree", baseCommit], { env: snapshotEnv });
    else runGit(repositoryRoot, ["read-tree", "--empty"], { env: snapshotEnv });
    // Preserve the selected base outside the registered workspace. Besides making nested
    // workspace evidence cheaper, this prevents sibling package changes from
    // being materialized into Mentiko's private snapshot objects.
    runGit(repositoryRoot, ["add", "-A", "--", relativeWorkspacePath], { env: snapshotEnv });
    const snapshotTree = runGit(repositoryRoot, ["write-tree"], { env: snapshotEnv });
    const sourceTree = sourceHead
      ? runGit(repositoryRoot, ["rev-parse", `${sourceHead}^{tree}`])
      : undefined;
    const baseTree = baseCommit
      ? runGit(repositoryRoot, ["rev-parse", `${baseCommit}^{tree}`])
      : undefined;
    const dirtyFromHead = !sourceHead || snapshotTree !== sourceTree;
    const dirtyFromBase = !baseCommit || snapshotTree !== baseTree;
    const snapshotCommit = baseCommit && !dirtyFromBase
      ? baseCommit
      : runGit(
        repositoryRoot,
        [
          "commit-tree",
          snapshotTree,
          ...(baseCommit ? ["-p", baseCommit] : []),
          "-m",
          `Mentiko workspace snapshot: ${identity.MENTIKO_WORKSPACE_SNAPSHOT_LABEL}`,
        ],
        { env: snapshotEnv },
      );

    return {
      version: SNAPSHOT_VERSION,
      kind: "git",
      capturedAt,
      sourceWorkspacePath,
      repositoryRoot,
      gitCommonDir,
      relativeWorkspacePath,
      ...(sourceHead ? { sourceHead } : {}),
      ...(sourceBranch ? { sourceBranch } : {}),
      ...(baseCommit ? { baseCommit } : {}),
      snapshotCommit,
      snapshotTree,
      dirtyFromHead,
    };
  } finally {
    try {
      unlinkSync(indexPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function diffArgs(
  baseline: GitWorkspaceSnapshot,
  observed: GitWorkspaceSnapshot,
  ...args: string[]
): string[] {
  return [
    "diff",
    ...args,
    baseline.snapshotCommit,
    observed.snapshotCommit,
    "--",
    baseline.relativeWorkspacePath,
  ];
}

function parseNameStatus(output: Buffer): Map<string, GitWorkspaceChangeFile["status"]> {
  const fields = output.toString("utf8").split("\0").filter((field) => field.length > 0);
  const statuses = new Map<string, GitWorkspaceChangeFile["status"]>();
  for (let index = 0; index < fields.length;) {
    let statusField = fields[index++];
    let path: string | undefined;
    const tab = statusField.indexOf("\t");
    if (tab >= 0) {
      path = statusField.slice(tab + 1);
      statusField = statusField.slice(0, tab);
    } else {
      path = fields[index++];
    }
    if (!path) throw new WorkspaceSnapshotError("invalid git name-status output");
    const status = statusField[0];
    statuses.set(path, status === "A"
      ? "added"
      : status === "M"
        ? "modified"
        : status === "D"
          ? "deleted"
          : status === "T"
            ? "type_changed"
            : "unknown");
  }
  return statuses;
}

function parseNumstat(output: Buffer): Map<string, { additions: number | null; deletions: number | null }> {
  const entries = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const record of output.toString("utf8").split("\0")) {
    if (!record) continue;
    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) throw new WorkspaceSnapshotError("invalid git numstat output");
    const additionsRaw = record.slice(0, firstTab);
    const deletionsRaw = record.slice(firstTab + 1, secondTab);
    const path = record.slice(secondTab + 1);
    if (!path) throw new WorkspaceSnapshotError("invalid git numstat path");
    entries.set(path, {
      additions: additionsRaw === "-" ? null : Number(additionsRaw),
      deletions: deletionsRaw === "-" ? null : Number(deletionsRaw),
    });
  }
  return entries;
}

/** Compare two captured states, including files that were untracked at either boundary. */
export function compareGitWorkspaceSnapshots(
  baseline: GitWorkspaceSnapshot,
  observed: GitWorkspaceSnapshot,
): GitWorkspaceChangeSet {
  const baselineRepositoryIdentity = baseline.gitCommonDir || baseline.repositoryRoot;
  const observedRepositoryIdentity = observed.gitCommonDir || observed.repositoryRoot;
  if (baselineRepositoryIdentity !== observedRepositoryIdentity) {
    throw new WorkspaceSnapshotError("workspace snapshots belong to different repositories");
  }
  if (baseline.relativeWorkspacePath !== observed.relativeWorkspacePath) {
    throw new WorkspaceSnapshotError("workspace snapshots use different repository scopes");
  }

  const nameStatus = parseNameStatus(runGitBytes(
    baseline.repositoryRoot,
    diffArgs(baseline, observed, "--name-status", "--no-renames", "-z"),
  ));
  const numstat = parseNumstat(runGitBytes(
    baseline.repositoryRoot,
    diffArgs(baseline, observed, "--numstat", "--no-renames", "-z"),
  ));
  const files = [...nameStatus.entries()]
    .map(([path, status]) => ({
      path,
      status,
      additions: numstat.get(path)?.additions ?? null,
      deletions: numstat.get(path)?.deletions ?? null,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const patch = runGitBytes(
    baseline.repositoryRoot,
    diffArgs(baseline, observed, "--binary", "--no-renames"),
  );

  return {
    version: SNAPSHOT_VERSION,
    kind: "git",
    baselineCommit: baseline.snapshotCommit,
    observedCommit: observed.snapshotCommit,
    relativeWorkspacePath: baseline.relativeWorkspacePath,
    files,
    summary: {
      filesChanged: files.length,
      additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
      binaryFiles: files.filter((file) => file.additions === null || file.deletions === null).length,
    },
    patchSha256: createHash("sha256").update(patch).digest("hex"),
  };
}

export function createWorkspaceSnapshotScratchDir(runDir: string): string {
  if (!isAbsolute(runDir)) throw new WorkspaceSnapshotError(`runDir must be absolute: ${runDir}`);
  const scratchDir = resolve(runDir, ".internal", "workspace-snapshots");
  mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
  return scratchDir;
}
