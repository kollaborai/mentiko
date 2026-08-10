import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { withExclusiveFileClaim } from "@/lib/runner-v2/file-claim";
import {
  captureGitWorkspaceSnapshot,
  compareGitWorkspaceSnapshots,
  createWorkspaceSnapshotScratchDir,
  type GitWorkspaceChangeSet,
  type GitWorkspaceSnapshot,
} from "@/lib/runner-v2/workspace-snapshot";

export const WORKSPACE_ISOLATION_VERSION = 1 as const;

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const REF_ROOT = "refs/mentiko/runs";

interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}

export interface GitRunWorkspaceIsolation {
  version: typeof WORKSPACE_ISOLATION_VERSION;
  kind: "git-worktrees";
  runId: string;
  runDir: string;
  sourceWorkspacePath: string;
  sourceRepositoryRoot: string;
  gitCommonDir: string;
  relativeWorkspacePath: string;
  baselineCommit: string;
  baselineTree: string;
  baselineRef: string;
  integrationRef: string;
  isolationRoot: string;
  worktreesRoot: string;
  statePath: string;
  createdAt: string;
}

export interface GitNodeWorkspace {
  version: typeof WORKSPACE_ISOLATION_VERSION;
  kind: "git-node-worktree";
  runId: string;
  agentId: string;
  attemptId: string;
  baseCommit: string;
  attemptRef: string;
  worktreeRoot: string;
  workspacePath: string;
  relativeWorkspacePath: string;
  recordPath: string;
  createdAt: string;
}

export interface GitNodeWorkspaceResult {
  version: typeof WORKSPACE_ISOLATION_VERSION;
  kind: "git-node-result";
  runId: string;
  agentId: string;
  attemptId: string;
  baseCommit: string;
  resultCommit: string;
  artifactPath: string;
  capturedAt: string;
  snapshot: GitWorkspaceSnapshot;
  changeSet: GitWorkspaceChangeSet;
}

export type GitNodeIntegrationStatus =
  | "integrated"
  | "already-integrated"
  | "no-changes"
  | "conflict";

export interface GitNodeIntegrationResult {
  version: typeof WORKSPACE_ISOLATION_VERSION;
  kind: "git-node-integration";
  runId: string;
  agentId: string;
  attemptId: string;
  status: GitNodeIntegrationStatus;
  baseCommit: string;
  resultCommit: string;
  previousIntegrationCommit: string;
  integrationCommit: string;
  mergeCommit?: string;
  conflictPaths: string[];
  artifactPath: string;
  integratedAt: string;
}

export type GitRunWorkspacePublicationStatus =
  | "published"
  | "already-published"
  | "no-changes"
  | "source-changed";

export interface GitRunWorkspacePublicationResult {
  version: typeof WORKSPACE_ISOLATION_VERSION;
  kind: "git-run-workspace-publication";
  runId: string;
  status: GitRunWorkspacePublicationStatus;
  baselineCommit: string;
  integrationCommit: string;
  artifactPath: string;
  publishedAt: string;
  sourceSnapshot: GitWorkspaceSnapshot;
  sourceChanges: GitWorkspaceChangeSet;
  /** Verified source state after a successful apply or crash-recovery match. */
  publishedSnapshot?: GitWorkspaceSnapshot;
}

export class WorkspaceIsolationError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "WorkspaceIsolationError";
  }
}

function runGitResult(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error) {
    throw new WorkspaceIsolationError(`git ${args[0] || "command"} could not start`, result.error);
  }
  if (result.status === null) {
    throw new WorkspaceIsolationError(`git ${args[0] || "command"} did not return an exit status`);
  }
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || ""),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr || ""),
  };
}

function runGit(cwd: string, args: string[], env: Record<string, string> = {}): string {
  const result = runGitResult(cwd, args, env);
  if (result.status !== 0) {
    const detail = result.stderr.toString("utf8").trim();
    throw new WorkspaceIsolationError(
      `git ${args[0] || "command"} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return result.stdout.toString("utf8").trim();
}

function runGitOptional(cwd: string, args: string[]): string | undefined {
  const result = runGitResult(cwd, args);
  if (result.status !== 0) return undefined;
  const value = result.stdout.toString("utf8").trim();
  return value || undefined;
}

function runGitWithInput(cwd: string, args: string[], input: Buffer): void {
  const result = spawnSync("git", args, {
    cwd,
    env: process.env,
    input,
    encoding: "buffer",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
  });
  if (result.error) {
    throw new WorkspaceIsolationError(`git ${args[0] || "command"} could not start`, result.error);
  }
  if (result.status !== 0) {
    const detail = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8").trim()
      : String(result.stderr || "").trim();
    throw new WorkspaceIsolationError(
      `git ${args[0] || "command"} failed${detail ? `: ${detail}` : ""}`,
    );
  }
}

function requireAbsoluteDirectory(path: string, field: string): string {
  if (!isAbsolute(path)) throw new WorkspaceIsolationError(`${field} must be absolute: ${path}`);
  const resolved = realpathSync(resolve(path));
  if (!lstatSync(resolved).isDirectory()) {
    throw new WorkspaceIsolationError(`${field} must be a directory: ${resolved}`);
  }
  return resolved;
}

function canonicalGitCommonDir(repositoryRoot: string): string {
  const raw = runGit(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  return requireAbsoluteDirectory(
    isAbsolute(raw) ? raw : resolve(repositoryRoot, raw),
    "git common directory",
  );
}

function digest(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function safeRefComponent(value: string): string {
  const readable = value
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 64) || "run";
  return `${readable}-${digest(value, 12)}`;
}

function safeArtifactSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 96) || "node";
}

function runRefPrefix(runId: string): string {
  return `${REF_ROOT}/${safeRefComponent(runId)}`;
}

function readRef(repositoryRoot: string, ref: string): string | undefined {
  return runGitOptional(repositoryRoot, ["show-ref", "--verify", "--hash", ref]);
}

function updateRef(
  repositoryRoot: string,
  ref: string,
  nextCommit: string,
  expectedCommit: string | undefined,
): void {
  runGit(repositoryRoot, ["update-ref", ref, nextCommit, expectedCommit || ""]);
}

function ensureRef(repositoryRoot: string, ref: string, commit: string): void {
  const current = readRef(repositoryRoot, ref);
  if (current === commit) return;
  if (current) {
    throw new WorkspaceIsolationError(`Git ref ${ref} points to ${current}, expected ${commit}`);
  }
  try {
    updateRef(repositoryRoot, ref, commit, undefined);
  } catch (error) {
    const raced = readRef(repositoryRoot, ref);
    if (raced === commit) return;
    throw error;
  }
}

function requiredRef(repositoryRoot: string, ref: string): string {
  const value = readRef(repositoryRoot, ref);
  if (!value) throw new WorkspaceIsolationError(`required Git ref is missing: ${ref}`);
  return value;
}

function readJson<T>(path: string): T {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new WorkspaceIsolationError(`workspace isolation record cannot be a symbolic link: ${path}`);
    }
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if (error instanceof WorkspaceIsolationError) throw error;
    throw new WorkspaceIsolationError(`workspace isolation record is unreadable: ${path}`, error);
  }
}

function writeJsonOnce<T>(path: string, value: T): T {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) return readJson<T>(path);
  const tempPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    try {
      linkSync(tempPath, path);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      return readJson<T>(path);
    }
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function syntheticIdentity(label: string, timestamp: string): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: "Mentiko Workspace Integration",
    GIT_AUTHOR_EMAIL: "workspace-integration@mentiko.local",
    GIT_COMMITTER_NAME: "Mentiko Workspace Integration",
    GIT_COMMITTER_EMAIL: "workspace-integration@mentiko.local",
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp,
    MENTIKO_WORKSPACE_INTEGRATION_LABEL: safeArtifactSegment(label),
  };
}

function assertRunIsolation(
  value: GitRunWorkspaceIsolation,
  expected: { runId: string; statePath: string },
): GitRunWorkspaceIsolation {
  if (
    value.version !== WORKSPACE_ISOLATION_VERSION
    || value.kind !== "git-worktrees"
    || value.runId !== expected.runId
    || value.statePath !== expected.statePath
  ) {
    throw new WorkspaceIsolationError(`run workspace isolation identity mismatch: ${expected.statePath}`);
  }
  if (canonicalGitCommonDir(value.sourceRepositoryRoot) !== value.gitCommonDir) {
    throw new WorkspaceIsolationError(`run workspace isolation repository changed: ${value.statePath}`);
  }
  if (requiredRef(value.sourceRepositoryRoot, value.baselineRef) !== value.baselineCommit) {
    throw new WorkspaceIsolationError(`run baseline ref changed: ${value.baselineRef}`);
  }
  requiredRef(value.sourceRepositoryRoot, value.integrationRef);
  return value;
}

export function initializeGitRunWorkspaceIsolation(input: {
  runId: string;
  runDir: string;
  baseline: GitWorkspaceSnapshot;
  now?: Date;
}): GitRunWorkspaceIsolation {
  const runDir = requireAbsoluteDirectory(input.runDir, "runDir");
  const sourceRepositoryRoot = requireAbsoluteDirectory(
    input.baseline.repositoryRoot,
    "source repository root",
  );
  const gitCommonDir = canonicalGitCommonDir(sourceRepositoryRoot);
  if (input.baseline.gitCommonDir && input.baseline.gitCommonDir !== gitCommonDir) {
    throw new WorkspaceIsolationError("workspace baseline belongs to a different Git common directory");
  }
  const baselineCommit = runGit(sourceRepositoryRoot, [
    "rev-parse",
    "--verify",
    `${input.baseline.snapshotCommit}^{commit}`,
  ]);
  const baselineTree = runGit(sourceRepositoryRoot, ["rev-parse", `${baselineCommit}^{tree}`]);
  if (baselineTree !== input.baseline.snapshotTree) {
    throw new WorkspaceIsolationError("workspace baseline commit and tree do not match");
  }

  const isolationRoot = join(runDir, ".internal", "workspace-isolation");
  const worktreesRoot = join(isolationRoot, "worktrees");
  const statePath = join(isolationRoot, "run-workspace.json");
  const refPrefix = runRefPrefix(input.runId);
  mkdirSync(worktreesRoot, { recursive: true, mode: 0o700 });

  return withExclusiveFileClaim(join(isolationRoot, "claims", "initialize.claim"), () => {
    if (existsSync(statePath)) {
      return assertRunIsolation(readJson<GitRunWorkspaceIsolation>(statePath), {
        runId: input.runId,
        statePath,
      });
    }

    const baselineRef = `${refPrefix}/baseline`;
    const integrationRef = `${refPrefix}/integration`;
    ensureRef(sourceRepositoryRoot, baselineRef, baselineCommit);
    ensureRef(sourceRepositoryRoot, integrationRef, baselineCommit);
    const candidate: GitRunWorkspaceIsolation = {
      version: WORKSPACE_ISOLATION_VERSION,
      kind: "git-worktrees",
      runId: input.runId,
      runDir,
      sourceWorkspacePath: input.baseline.sourceWorkspacePath,
      sourceRepositoryRoot,
      gitCommonDir,
      relativeWorkspacePath: input.baseline.relativeWorkspacePath,
      baselineCommit,
      baselineTree,
      baselineRef,
      integrationRef,
      isolationRoot,
      worktreesRoot,
      statePath,
      createdAt: (input.now || new Date()).toISOString(),
    };
    const persisted = writeJsonOnce(statePath, candidate);
    return assertRunIsolation(persisted, { runId: input.runId, statePath });
  }, { waitTimeoutMs: 5_000 });
}

function nodeRecordPath(runWorkspace: GitRunWorkspaceIsolation, attemptId: string): string {
  return join(runWorkspace.isolationRoot, "nodes", `${digest(attemptId, 32)}.json`);
}

function assertNodeWorkspaceRecord(
  runWorkspace: GitRunWorkspaceIsolation,
  node: GitNodeWorkspace,
  expected: { agentId: string; attemptId: string; recordPath: string },
): GitNodeWorkspace {
  const nodeKey = digest(expected.attemptId, 32);
  const expectedWorktreeRoot = join(runWorkspace.worktreesRoot, nodeKey);
  const expectedWorkspacePath = runWorkspace.relativeWorkspacePath === "."
    ? expectedWorktreeRoot
    : join(expectedWorktreeRoot, runWorkspace.relativeWorkspacePath);
  const expectedAttemptRef = `${runRefPrefix(runWorkspace.runId)}/attempts/${nodeKey}`;
  if (
    node.version !== WORKSPACE_ISOLATION_VERSION
    || node.kind !== "git-node-worktree"
    || node.runId !== runWorkspace.runId
    || node.agentId !== expected.agentId
    || node.attemptId !== expected.attemptId
    || node.recordPath !== expected.recordPath
    || node.relativeWorkspacePath !== runWorkspace.relativeWorkspacePath
    || node.worktreeRoot !== expectedWorktreeRoot
    || node.workspacePath !== expectedWorkspacePath
    || node.attemptRef !== expectedAttemptRef
  ) {
    throw new WorkspaceIsolationError(`node workspace identity mismatch: ${expected.recordPath}`);
  }
  const baseCommit = runGit(
    runWorkspace.sourceRepositoryRoot,
    ["rev-parse", "--verify", `${node.baseCommit}^{commit}`],
  );
  if (
    baseCommit !== node.baseCommit
    || !isAncestor(runWorkspace.sourceRepositoryRoot, runWorkspace.baselineCommit, node.baseCommit)
  ) {
    throw new WorkspaceIsolationError(`node workspace base is outside the run history: ${node.baseCommit}`);
  }
  return node;
}

function assertNodeWorkspace(
  runWorkspace: GitRunWorkspaceIsolation,
  value: GitNodeWorkspace,
  expected: { agentId: string; attemptId: string; recordPath: string },
): GitNodeWorkspace {
  const node = assertNodeWorkspaceRecord(runWorkspace, value, expected);
  if (!existsSync(node.worktreeRoot)) {
    throw new WorkspaceIsolationError(`node worktree is missing: ${node.worktreeRoot}`);
  }
  const worktreeRoot = requireAbsoluteDirectory(node.worktreeRoot, "node worktree root");
  if (worktreeRoot !== node.worktreeRoot) {
    throw new WorkspaceIsolationError(`node worktree path changed: ${node.worktreeRoot}`);
  }
  if (runGit(worktreeRoot, ["rev-parse", "--show-toplevel"]) !== node.worktreeRoot) {
    throw new WorkspaceIsolationError(`node path is not its Git worktree root: ${node.worktreeRoot}`);
  }
  if (canonicalGitCommonDir(worktreeRoot) !== runWorkspace.gitCommonDir) {
    throw new WorkspaceIsolationError(`node worktree belongs to a different repository: ${node.worktreeRoot}`);
  }
  const currentAttemptRef = requiredRef(runWorkspace.sourceRepositoryRoot, node.attemptRef);
  if (currentAttemptRef !== node.baseCommit) {
    const resultArtifact = nodeResultArtifactPath(runWorkspace, node);
    if (!existsSync(resultArtifact)) {
      throw new WorkspaceIsolationError(
        `node attempt ref changed before a durable result existed: ${currentAttemptRef}`,
      );
    }
    const result = assertNodeResult(
      runWorkspace,
      node,
      readJson<GitNodeWorkspaceResult>(resultArtifact),
      resultArtifact,
    );
    if (currentAttemptRef !== result.resultCommit) {
      throw new WorkspaceIsolationError(`node attempt ref does not match its durable result: ${node.attemptRef}`);
    }
  }
  mkdirSync(node.workspacePath, { recursive: true, mode: 0o700 });
  return node;
}

export function allocateGitNodeWorkspace(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  agentId: string;
  attemptId: string;
  /** Pin every target on the same graph edge to its routing-time commit. */
  baseCommit?: string;
  now?: Date;
}): GitNodeWorkspace {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  const recordPath = nodeRecordPath(runWorkspace, input.attemptId);
  const nodeKey = digest(input.attemptId, 32);

  return withExclusiveFileClaim(
    join(runWorkspace.isolationRoot, "claims", "nodes", `${nodeKey}.claim`),
    () => {
      if (existsSync(recordPath)) {
        const existing = assertNodeWorkspace(runWorkspace, readJson<GitNodeWorkspace>(recordPath), {
          agentId: input.agentId,
          attemptId: input.attemptId,
          recordPath,
        });
        if (input.baseCommit && existing.baseCommit !== input.baseCommit) {
          throw new WorkspaceIsolationError(
            `node workspace base differs from its routing-time commit: ${existing.baseCommit}`,
          );
        }
        return existing;
      }

      const attemptRef = `${runRefPrefix(runWorkspace.runId)}/attempts/${nodeKey}`;
      let baseCommit = readRef(runWorkspace.sourceRepositoryRoot, attemptRef);
      if (!baseCommit) {
        baseCommit = withExclusiveFileClaim(
          join(runWorkspace.isolationRoot, "claims", "integration.claim"),
          () => {
            const current = requiredRef(
              runWorkspace.sourceRepositoryRoot,
              runWorkspace.integrationRef,
            );
            const requested = input.baseCommit
              ? runGit(runWorkspace.sourceRepositoryRoot, [
                "rev-parse",
                "--verify",
                `${input.baseCommit}^{commit}`,
              ])
              : current;
            if (!isAncestor(runWorkspace.sourceRepositoryRoot, requested, current)) {
              throw new WorkspaceIsolationError(
                `requested node base is not in the run integration history: ${requested}`,
              );
            }
            ensureRef(runWorkspace.sourceRepositoryRoot, attemptRef, requested);
            return requested;
          },
          { waitTimeoutMs: 30_000 },
        );
      }
      if (input.baseCommit && baseCommit !== input.baseCommit) {
        throw new WorkspaceIsolationError(
          `node workspace base differs from its routing-time commit: ${baseCommit}`,
        );
      }

      const worktreeRoot = join(runWorkspace.worktreesRoot, nodeKey);
      if (!existsSync(worktreeRoot)) {
        runGit(runWorkspace.sourceRepositoryRoot, [
          "worktree",
          "add",
          "--detach",
          worktreeRoot,
          baseCommit,
        ]);
      } else {
        const existingRoot = requireAbsoluteDirectory(worktreeRoot, "existing node worktree");
        if (
          canonicalGitCommonDir(existingRoot) !== runWorkspace.gitCommonDir
          || runGit(existingRoot, ["rev-parse", "HEAD"]) !== baseCommit
        ) {
          throw new WorkspaceIsolationError(`unowned path blocks node worktree allocation: ${worktreeRoot}`);
        }
      }

      const workspacePath = runWorkspace.relativeWorkspacePath === "."
        ? worktreeRoot
        : join(worktreeRoot, runWorkspace.relativeWorkspacePath);
      mkdirSync(workspacePath, { recursive: true, mode: 0o700 });
      const candidate: GitNodeWorkspace = {
        version: WORKSPACE_ISOLATION_VERSION,
        kind: "git-node-worktree",
        runId: runWorkspace.runId,
        agentId: input.agentId,
        attemptId: input.attemptId,
        baseCommit,
        attemptRef,
        worktreeRoot,
        workspacePath,
        relativeWorkspacePath: runWorkspace.relativeWorkspacePath,
        recordPath,
        createdAt: (input.now || new Date()).toISOString(),
      };
      const persisted = writeJsonOnce(recordPath, candidate);
      return assertNodeWorkspace(runWorkspace, persisted, {
        agentId: input.agentId,
        attemptId: input.attemptId,
        recordPath,
      });
    },
    { waitTimeoutMs: 30_000 },
  );
}

export function readGitNodeWorkspace(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  agentId: string;
  attemptId: string;
}): GitNodeWorkspace {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  const recordPath = nodeRecordPath(runWorkspace, input.attemptId);
  if (!existsSync(recordPath)) {
    throw new WorkspaceIsolationError(`node workspace record is missing: ${recordPath}`);
  }
  return assertNodeWorkspace(runWorkspace, readJson<GitNodeWorkspace>(recordPath), {
    agentId: input.agentId,
    attemptId: input.attemptId,
    recordPath,
  });
}

function nodeResultArtifactPath(
  runWorkspace: GitRunWorkspaceIsolation,
  node: GitNodeWorkspace,
): string {
  return join(
    runWorkspace.isolationRoot,
    "receipts",
    "results",
    `${digest(node.attemptId, 32)}.json`,
  );
}

function baseSnapshotForNode(
  runWorkspace: GitRunWorkspaceIsolation,
  node: GitNodeWorkspace,
  capturedAt: string,
): GitWorkspaceSnapshot {
  return {
    version: 1,
    kind: "git",
    capturedAt,
    sourceWorkspacePath: node.workspacePath,
    // Compare immutable commit objects through the source repository so replay
    // remains valid after the disposable node worktree has been removed.
    repositoryRoot: runWorkspace.sourceRepositoryRoot,
    gitCommonDir: runWorkspace.gitCommonDir,
    relativeWorkspacePath: node.relativeWorkspacePath,
    sourceHead: node.baseCommit,
    baseCommit: node.baseCommit,
    snapshotCommit: node.baseCommit,
    snapshotTree: runGit(runWorkspace.sourceRepositoryRoot, ["rev-parse", `${node.baseCommit}^{tree}`]),
    dirtyFromHead: false,
  };
}

function assertNodeResult(
  runWorkspace: GitRunWorkspaceIsolation,
  node: GitNodeWorkspace,
  result: GitNodeWorkspaceResult,
  artifactPath: string,
): GitNodeWorkspaceResult {
  const snapshot = result?.snapshot;
  if (
    !result
    ||
    result.version !== WORKSPACE_ISOLATION_VERSION
    || result.kind !== "git-node-result"
    || result.runId !== node.runId
    || result.agentId !== node.agentId
    || result.attemptId !== node.attemptId
    || result.baseCommit !== node.baseCommit
    || result.artifactPath !== artifactPath
    || typeof result.capturedAt !== "string"
    || !Number.isFinite(Date.parse(result.capturedAt))
    || !snapshot
    || snapshot.version !== 1
    || snapshot.kind !== "git"
    || snapshot.capturedAt !== result.capturedAt
    || snapshot.sourceWorkspacePath !== node.workspacePath
    || snapshot.repositoryRoot !== node.worktreeRoot
    || snapshot.gitCommonDir !== runWorkspace.gitCommonDir
    || snapshot.relativeWorkspacePath !== node.relativeWorkspacePath
    || snapshot.baseCommit !== node.baseCommit
    || snapshot.snapshotCommit !== result.resultCommit
  ) {
    throw new WorkspaceIsolationError(`node result identity mismatch: ${artifactPath}`);
  }
  const verifiedCommit = runGit(
    runWorkspace.sourceRepositoryRoot,
    ["rev-parse", "--verify", `${result.resultCommit}^{commit}`],
  );
  const verifiedTree = runGit(
    runWorkspace.sourceRepositoryRoot,
    ["rev-parse", `${result.resultCommit}^{tree}`],
  );
  const parents = runGit(
    runWorkspace.sourceRepositoryRoot,
    ["show", "-s", "--format=%P", result.resultCommit],
  ).split(/\s+/).filter(Boolean);
  const validCommitShape = result.resultCommit === node.baseCommit
    || (parents.length === 1 && parents[0] === node.baseCommit);
  const expectedChangeSet = compareGitWorkspaceSnapshots(
    baseSnapshotForNode(runWorkspace, node, node.createdAt),
    snapshot,
  );
  if (
    verifiedCommit !== result.resultCommit
    || verifiedTree !== snapshot.snapshotTree
    || !validCommitShape
    || JSON.stringify(result.changeSet) !== JSON.stringify(expectedChangeSet)
  ) {
    throw new WorkspaceIsolationError(`node result Git evidence mismatch: ${artifactPath}`);
  }
  return result;
}

function reconcileNodeAttemptRef(
  runWorkspace: GitRunWorkspaceIsolation,
  node: GitNodeWorkspace,
  result: GitNodeWorkspaceResult,
): void {
  const current = requiredRef(runWorkspace.sourceRepositoryRoot, node.attemptRef);
  if (current === result.resultCommit) return;
  if (current !== node.baseCommit) {
    throw new WorkspaceIsolationError(`node attempt ref changed unexpectedly: ${node.attemptRef}`);
  }
  updateRef(
    runWorkspace.sourceRepositoryRoot,
    node.attemptRef,
    result.resultCommit,
    node.baseCommit,
  );
}

export function finalizeGitNodeWorkspace(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  node: GitNodeWorkspace;
  now?: Date;
  /** Deterministic crash hooks used by the fault-injection suite. */
  afterResultReceiptPersisted?: (result: GitNodeWorkspaceResult) => void;
  afterAttemptRefAdvanced?: (result: GitNodeWorkspaceResult) => void;
}): GitNodeWorkspaceResult {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  const node = assertNodeWorkspace(runWorkspace, input.node, {
    agentId: input.node.agentId,
    attemptId: input.node.attemptId,
    recordPath: input.node.recordPath,
  });
  const artifactPath = nodeResultArtifactPath(runWorkspace, node);
  const resultClaim = join(
    runWorkspace.isolationRoot,
    "claims",
    "results",
    `${digest(node.attemptId, 32)}.claim`,
  );

  return withExclusiveFileClaim(resultClaim, () => {
    if (existsSync(artifactPath)) {
      const persisted = assertNodeResult(
        runWorkspace,
        node,
        readJson<GitNodeWorkspaceResult>(artifactPath),
        artifactPath,
      );
      reconcileNodeAttemptRef(runWorkspace, node, persisted);
      return persisted;
    }
    const capturedAt = (input.now || new Date()).toISOString();
    mkdirSync(node.workspacePath, { recursive: true, mode: 0o700 });
    const snapshot = captureGitWorkspaceSnapshot({
      workspacePath: node.workspacePath,
      scratchDir: createWorkspaceSnapshotScratchDir(runWorkspace.runDir),
      label: `${node.runId}-${node.agentId}-${node.attemptId}-result`,
      capturedAt,
      baseCommit: node.baseCommit,
    });
    if (snapshot.gitCommonDir !== runWorkspace.gitCommonDir) {
      throw new WorkspaceIsolationError("node result belongs to a different Git repository");
    }
    const changeSet = compareGitWorkspaceSnapshots(
      baseSnapshotForNode(runWorkspace, node, node.createdAt),
      snapshot,
    );
    const candidate: GitNodeWorkspaceResult = {
      version: WORKSPACE_ISOLATION_VERSION,
      kind: "git-node-result",
      runId: node.runId,
      agentId: node.agentId,
      attemptId: node.attemptId,
      baseCommit: node.baseCommit,
      resultCommit: snapshot.snapshotCommit,
      artifactPath,
      capturedAt,
      snapshot,
      changeSet,
    };
    // Persist the immutable result before advancing the attempt ref. A crash
    // can now leave either (receipt, base ref) or (receipt, result ref), and a
    // replay deterministically reconciles both states.
    const persisted = assertNodeResult(
      runWorkspace,
      node,
      writeJsonOnce(artifactPath, candidate),
      artifactPath,
    );
    input.afterResultReceiptPersisted?.(persisted);
    reconcileNodeAttemptRef(runWorkspace, node, persisted);
    input.afterAttemptRefAdvanced?.(persisted);
    return persisted;
  }, { waitTimeoutMs: 30_000 });
}

function isAncestor(repositoryRoot: string, ancestor: string, descendant: string): boolean {
  const result = runGitResult(repositoryRoot, ["merge-base", "--is-ancestor", ancestor, descendant]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  const detail = result.stderr.toString("utf8").trim();
  throw new WorkspaceIsolationError(`git merge-base failed${detail ? `: ${detail}` : ""}`);
}

function mergeTree(
  repositoryRoot: string,
  left: string,
  right: string,
): { status: "merged"; tree: string } | { status: "conflict"; paths: string[] } {
  const result = runGitResult(repositoryRoot, [
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    "-z",
    left,
    right,
  ]);
  const fields = result.stdout.toString("utf8").split("\0").filter(Boolean);
  if (result.status === 1) {
    return { status: "conflict", paths: fields.slice(1).sort() };
  }
  if (result.status !== 0 || !fields[0]) {
    const detail = result.stderr.toString("utf8").trim();
    throw new WorkspaceIsolationError(`git merge-tree failed${detail ? `: ${detail}` : ""}`);
  }
  return { status: "merged", tree: fields[0] };
}

function integrationArtifactPath(
  runWorkspace: GitRunWorkspaceIsolation,
  result: GitNodeWorkspaceResult,
): string {
  return integrationArtifactPathForAttempt(
    runWorkspace,
    result.agentId,
    result.attemptId,
  );
}

function integrationArtifactPathForAttempt(
  runWorkspace: GitRunWorkspaceIsolation,
  agentId: string,
  attemptId: string,
): string {
  return join(
    runWorkspace.isolationRoot,
    "receipts",
    "integrations",
    `${digest(`${agentId}\0${attemptId}`, 32)}.json`,
  );
}

function assertIntegrationResult(
  result: GitNodeWorkspaceResult,
  integration: GitNodeIntegrationResult,
  artifactPath: string,
): GitNodeIntegrationResult {
  assertPersistedIntegrationResult(integration, artifactPath, result.runId, result.agentId, result.attemptId);
  if (
    integration.baseCommit !== result.baseCommit
    || integration.resultCommit !== result.resultCommit
  ) {
    throw new WorkspaceIsolationError(`node integration identity mismatch: ${artifactPath}`);
  }
  return integration;
}

function assertPersistedIntegrationResult(
  integration: GitNodeIntegrationResult,
  artifactPath: string,
  runId: string,
  agentId: string,
  attemptId: string,
): void {
  const statuses = new Set<GitNodeIntegrationStatus>([
    "integrated",
    "already-integrated",
    "no-changes",
    "conflict",
  ]);
  const commits = [
    integration.baseCommit,
    integration.resultCommit,
    integration.previousIntegrationCommit,
    integration.integrationCommit,
    ...(integration.mergeCommit ? [integration.mergeCommit] : []),
  ];
  const validTimestamp = typeof integration.integratedAt === "string"
    && Number.isFinite(Date.parse(integration.integratedAt));
  const validConflictPaths = Array.isArray(integration.conflictPaths)
    && integration.conflictPaths.every((path) => typeof path === "string" && path.length > 0);
  const conflictPaths = validConflictPaths ? integration.conflictPaths : [];
  const validStatusInvariant = validConflictPaths && (() => {
    switch (integration.status) {
      case "conflict":
        return conflictPaths.length > 0
          && integration.integrationCommit === integration.previousIntegrationCommit
          && !integration.mergeCommit;
      case "no-changes":
        return conflictPaths.length === 0
          && integration.resultCommit === integration.baseCommit
          && integration.integrationCommit === integration.previousIntegrationCommit
          && !integration.mergeCommit;
      case "already-integrated":
        return conflictPaths.length === 0
          && integration.integrationCommit === integration.previousIntegrationCommit
          && !integration.mergeCommit;
      case "integrated":
        return conflictPaths.length === 0
          && (integration.mergeCommit
            ? integration.mergeCommit === integration.integrationCommit
            : integration.integrationCommit === integration.resultCommit);
      default:
        return false;
    }
  })();
  if (
    integration.version !== WORKSPACE_ISOLATION_VERSION
    || integration.kind !== "git-node-integration"
    || integration.runId !== runId
    || integration.agentId !== agentId
    || integration.attemptId !== attemptId
    || integration.artifactPath !== artifactPath
    || !statuses.has(integration.status)
    || commits.some((commit) => typeof commit !== "string" || commit.length === 0)
    || !validTimestamp
    || !validConflictPaths
    || !validStatusInvariant
  ) {
    throw new WorkspaceIsolationError(`node integration identity mismatch: ${artifactPath}`);
  }
}

function readNodeResultForIntegration(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  agentId: string;
  attemptId: string;
}): { node: GitNodeWorkspace; result: GitNodeWorkspaceResult } {
  const recordPath = nodeRecordPath(input.runWorkspace, input.attemptId);
  if (!existsSync(recordPath)) {
    throw new WorkspaceIsolationError(`node workspace record is missing: ${recordPath}`);
  }
  const node = assertNodeWorkspaceRecord(
    input.runWorkspace,
    readJson<GitNodeWorkspace>(recordPath),
    {
      agentId: input.agentId,
      attemptId: input.attemptId,
      recordPath,
    },
  );
  const resultPath = nodeResultArtifactPath(input.runWorkspace, node);
  if (!existsSync(resultPath)) {
    throw new WorkspaceIsolationError(`node result receipt is missing: ${resultPath}`);
  }
  const result = assertNodeResult(
    input.runWorkspace,
    node,
    readJson<GitNodeWorkspaceResult>(resultPath),
    resultPath,
  );

  // Before cleanup, prove that the actual worktree still matches the private
  // result receipt. This blocks a fabricated no-change receipt from skipping
  // dirty node output on the completion fast path.
  if (existsSync(node.worktreeRoot)) {
    const observed = captureGitWorkspaceSnapshot({
      workspacePath: node.workspacePath,
      scratchDir: createWorkspaceSnapshotScratchDir(input.runWorkspace.runDir),
      label: `${node.runId}-${node.agentId}-${node.attemptId}-result`,
      capturedAt: result.capturedAt,
      baseCommit: node.baseCommit,
    });
    if (
      observed.gitCommonDir !== input.runWorkspace.gitCommonDir
      || observed.snapshotCommit !== result.resultCommit
      || observed.snapshotTree !== result.snapshot.snapshotTree
      || (
        result.snapshot.sourceIndexSha256 !== undefined
        && observed.sourceIndexSha256 !== result.snapshot.sourceIndexSha256
      )
    ) {
      throw new WorkspaceIsolationError(`node worktree differs from its result receipt: ${resultPath}`);
    }
  }
  return { node, result };
}

function assertIntegrationGitEvidence(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  result: GitNodeWorkspaceResult;
  integration: GitNodeIntegrationResult;
  artifactPath: string;
  currentIntegrationCommit: string;
}): GitNodeIntegrationResult {
  const { runWorkspace, result, integration, artifactPath, currentIntegrationCommit } = input;
  assertIntegrationResult(result, integration, artifactPath);
  for (const commit of [
    integration.baseCommit,
    integration.resultCommit,
    integration.previousIntegrationCommit,
    integration.integrationCommit,
    ...(integration.mergeCommit ? [integration.mergeCommit] : []),
  ]) {
    runGit(runWorkspace.sourceRepositoryRoot, ["rev-parse", "--verify", `${commit}^{commit}`]);
  }

  switch (integration.status) {
    case "no-changes":
      if (integration.resultCommit !== integration.baseCommit) {
        throw new WorkspaceIsolationError(`node no-change receipt has a changed result: ${artifactPath}`);
      }
      break;
    case "already-integrated":
      if (!isAncestor(
        runWorkspace.sourceRepositoryRoot,
        integration.resultCommit,
        integration.previousIntegrationCommit,
      )) {
        throw new WorkspaceIsolationError(`node result was not already integrated: ${artifactPath}`);
      }
      break;
    case "conflict": {
      const replay = mergeTree(
        runWorkspace.sourceRepositoryRoot,
        integration.previousIntegrationCommit,
        integration.resultCommit,
      );
      if (
        replay.status !== "conflict"
        || JSON.stringify(replay.paths) !== JSON.stringify(integration.conflictPaths)
      ) {
        throw new WorkspaceIsolationError(`node conflict receipt is not reproducible: ${artifactPath}`);
      }
      break;
    }
    case "integrated":
      if (integration.mergeCommit) {
        const parents = runGit(
          runWorkspace.sourceRepositoryRoot,
          ["show", "-s", "--format=%P", integration.mergeCommit],
        ).split(/\s+/).filter(Boolean);
        const replay = mergeTree(
          runWorkspace.sourceRepositoryRoot,
          integration.previousIntegrationCommit,
          integration.resultCommit,
        );
        const mergeTreeValue = runGit(
          runWorkspace.sourceRepositoryRoot,
          ["rev-parse", `${integration.mergeCommit}^{tree}`],
        );
        if (
          parents.length !== 2
          || parents[0] !== integration.previousIntegrationCommit
          || parents[1] !== integration.resultCommit
          || replay.status !== "merged"
          || replay.tree !== mergeTreeValue
        ) {
          throw new WorkspaceIsolationError(`node merge receipt does not match Git history: ${artifactPath}`);
        }
      } else if (
        integration.previousIntegrationCommit !== integration.baseCommit
        || integration.integrationCommit !== integration.resultCommit
      ) {
        throw new WorkspaceIsolationError(`node direct integration receipt is invalid: ${artifactPath}`);
      }
      break;
  }

  const pendingRefAdvance = integration.status === "integrated"
    && currentIntegrationCommit === integration.previousIntegrationCommit;
  if (
    !pendingRefAdvance
    && !isAncestor(
      runWorkspace.sourceRepositoryRoot,
      integration.integrationCommit,
      currentIntegrationCommit,
    )
  ) {
    throw new WorkspaceIsolationError(`node integration is outside the current run history: ${artifactPath}`);
  }
  return integration;
}

function reconcileIntegrationRef(
  runWorkspace: GitRunWorkspaceIsolation,
  integration: GitNodeIntegrationResult,
): void {
  const current = requiredRef(runWorkspace.sourceRepositoryRoot, runWorkspace.integrationRef);
  if (
    integration.status === "integrated"
    && current === integration.previousIntegrationCommit
  ) {
    updateRef(
      runWorkspace.sourceRepositoryRoot,
      runWorkspace.integrationRef,
      integration.integrationCommit,
      integration.previousIntegrationCommit,
    );
    return;
  }
  if (!isAncestor(runWorkspace.sourceRepositoryRoot, integration.integrationCommit, current)) {
    throw new WorkspaceIsolationError(
      `run integration ref does not contain node ${integration.attemptId}`,
    );
  }
}

export function readGitNodeIntegrationResult(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  agentId: string;
  attemptId: string;
}): GitNodeIntegrationResult | undefined {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  const artifactPath = integrationArtifactPathForAttempt(
    runWorkspace,
    input.agentId,
    input.attemptId,
  );
  if (!existsSync(artifactPath)) return undefined;
  return withExclusiveFileClaim(
    join(runWorkspace.isolationRoot, "claims", "integration.claim"),
    () => {
      const { result } = readNodeResultForIntegration(input);
      const current = requiredRef(runWorkspace.sourceRepositoryRoot, runWorkspace.integrationRef);
      const integration = assertIntegrationGitEvidence({
        runWorkspace,
        result,
        integration: readJson<GitNodeIntegrationResult>(artifactPath),
        artifactPath,
        currentIntegrationCommit: current,
      });
      reconcileIntegrationRef(runWorkspace, integration);
      return integration;
    },
    { waitTimeoutMs: 30_000 },
  );
}

export function integrateGitNodeWorkspaceResult(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  result: GitNodeWorkspaceResult;
  now?: Date;
  /** Deterministic crash hook used by the fault-injection suite. */
  afterIntegrationReceiptPersisted?: (result: GitNodeIntegrationResult) => void;
}): GitNodeIntegrationResult {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  const artifactPath = integrationArtifactPath(runWorkspace, input.result);
  const nodeClaim = join(
    runWorkspace.isolationRoot,
    "claims",
    "integrations",
    `${digest(input.result.attemptId, 32)}.claim`,
  );

  return withExclusiveFileClaim(
    nodeClaim,
    () => withExclusiveFileClaim(
      join(runWorkspace.isolationRoot, "claims", "integration.claim"),
      () => {
        const { result } = readNodeResultForIntegration({
          runWorkspace,
          agentId: input.result.agentId,
          attemptId: input.result.attemptId,
        });
        if (JSON.stringify(input.result) !== JSON.stringify(result)) {
          throw new WorkspaceIsolationError(
            `integration input differs from the private node result: ${input.result.attemptId}`,
          );
        }
        const previousIntegrationCommit = requiredRef(
          runWorkspace.sourceRepositoryRoot,
          runWorkspace.integrationRef,
        );
        if (existsSync(artifactPath)) {
          const persisted = assertIntegrationGitEvidence({
            runWorkspace,
            result,
            integration: readJson<GitNodeIntegrationResult>(artifactPath),
            artifactPath,
            currentIntegrationCommit: previousIntegrationCommit,
          });
          reconcileIntegrationRef(runWorkspace, persisted);
          return persisted;
        }
        const integratedAt = (input.now || new Date()).toISOString();
        let candidate: GitNodeIntegrationResult;

        if (result.resultCommit === result.baseCommit) {
          candidate = {
            version: WORKSPACE_ISOLATION_VERSION,
            kind: "git-node-integration",
            runId: result.runId,
            agentId: result.agentId,
            attemptId: result.attemptId,
            status: "no-changes",
            baseCommit: result.baseCommit,
            resultCommit: result.resultCommit,
            previousIntegrationCommit,
            integrationCommit: previousIntegrationCommit,
            conflictPaths: [],
            artifactPath,
            integratedAt,
          };
        } else if (isAncestor(
          runWorkspace.sourceRepositoryRoot,
          result.resultCommit,
          previousIntegrationCommit,
        )) {
          candidate = {
            version: WORKSPACE_ISOLATION_VERSION,
            kind: "git-node-integration",
            runId: result.runId,
            agentId: result.agentId,
            attemptId: result.attemptId,
            status: "already-integrated",
            baseCommit: result.baseCommit,
            resultCommit: result.resultCommit,
            previousIntegrationCommit,
            integrationCommit: previousIntegrationCommit,
            conflictPaths: [],
            artifactPath,
            integratedAt,
          };
        } else if (previousIntegrationCommit === result.baseCommit) {
          candidate = {
            version: WORKSPACE_ISOLATION_VERSION,
            kind: "git-node-integration",
            runId: result.runId,
            agentId: result.agentId,
            attemptId: result.attemptId,
            status: "integrated",
            baseCommit: result.baseCommit,
            resultCommit: result.resultCommit,
            previousIntegrationCommit,
            integrationCommit: result.resultCommit,
            conflictPaths: [],
            artifactPath,
            integratedAt,
          };
        } else {
          const merged = mergeTree(
            runWorkspace.sourceRepositoryRoot,
            previousIntegrationCommit,
            result.resultCommit,
          );
          if (merged.status === "conflict") {
            candidate = {
              version: WORKSPACE_ISOLATION_VERSION,
              kind: "git-node-integration",
              runId: result.runId,
              agentId: result.agentId,
              attemptId: result.attemptId,
              status: "conflict",
              baseCommit: result.baseCommit,
              resultCommit: result.resultCommit,
              previousIntegrationCommit,
              integrationCommit: previousIntegrationCommit,
              conflictPaths: merged.paths,
              artifactPath,
              integratedAt,
            };
          } else {
            const mergeCommit = runGit(
              runWorkspace.sourceRepositoryRoot,
              [
                "commit-tree",
                merged.tree,
                "-p",
                previousIntegrationCommit,
                "-p",
                result.resultCommit,
                "-m",
                `Mentiko node integration: ${safeArtifactSegment(result.agentId)}`,
              ],
              syntheticIdentity(result.attemptId, integratedAt),
            );
            candidate = {
              version: WORKSPACE_ISOLATION_VERSION,
              kind: "git-node-integration",
              runId: result.runId,
              agentId: result.agentId,
              attemptId: result.attemptId,
              status: "integrated",
              baseCommit: result.baseCommit,
              resultCommit: result.resultCommit,
              previousIntegrationCommit,
              integrationCommit: mergeCommit,
              mergeCommit,
              conflictPaths: [],
              artifactPath,
              integratedAt,
            };
          }
        }

        // Like node results, the immutable integration receipt is durable
        // before the ref CAS. Replay can therefore finish a ref advance after
        // a process crash without re-running or silently reclassifying work.
        const persisted = assertIntegrationGitEvidence({
          runWorkspace,
          result,
          integration: writeJsonOnce(artifactPath, candidate),
          artifactPath,
          currentIntegrationCommit: previousIntegrationCommit,
        });
        input.afterIntegrationReceiptPersisted?.(persisted);
        reconcileIntegrationRef(runWorkspace, persisted);
        return persisted;
      },
      { waitTimeoutMs: 30_000 },
    ),
    { waitTimeoutMs: 30_000 },
  );
}

export function currentGitRunIntegrationCommit(
  runWorkspace: GitRunWorkspaceIsolation,
): string {
  const current = assertRunIsolation(runWorkspace, {
    runId: runWorkspace.runId,
    statePath: runWorkspace.statePath,
  });
  return requiredRef(current.sourceRepositoryRoot, current.integrationRef);
}

/** Read the current private integration commit at the exact instant a delayed
 * edge (for example fan-in) is accepted. */
export function currentGitRunIntegrationCommitFromRunDir(input: {
  runDir: string;
  runId: string;
}): string | undefined {
  const runWorkspace = readGitRunWorkspaceIsolationFromRunDir(input);
  return runWorkspace
    ? requiredRef(runWorkspace.sourceRepositoryRoot, runWorkspace.integrationRef)
    : undefined;
}

export function readGitRunWorkspaceIsolationFromRunDir(input: {
  runDir: string;
  runId: string;
}): GitRunWorkspaceIsolation | undefined {
  const runDir = requireAbsoluteDirectory(input.runDir, "runDir");
  const statePath = join(runDir, ".internal", "workspace-isolation", "run-workspace.json");
  if (!existsSync(statePath)) return undefined;
  return assertRunIsolation(
    readJson<GitRunWorkspaceIsolation>(statePath),
    { runId: input.runId, statePath },
  );
}

export function removeIntegratedGitNodeWorkspace(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  agentId: string;
  attemptId: string;
}): "removed" | "already-removed" | "preserved-conflict" {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  const integration = readGitNodeIntegrationResult(input);
  if (!integration) {
    throw new WorkspaceIsolationError(
      `cannot remove node workspace before integration: ${input.attemptId}`,
    );
  }
  if (integration.status === "conflict") return "preserved-conflict";
  const recordPath = nodeRecordPath(runWorkspace, input.attemptId);
  if (!existsSync(recordPath)) {
    throw new WorkspaceIsolationError(`node workspace record is missing: ${recordPath}`);
  }
  const node = readJson<GitNodeWorkspace>(recordPath);
  const nodeKey = digest(input.attemptId, 32);
  const expectedWorktreeRoot = join(runWorkspace.worktreesRoot, nodeKey);
  const expectedAttemptRef = `${runRefPrefix(runWorkspace.runId)}/attempts/${nodeKey}`;
  if (
    node.runId !== runWorkspace.runId
    || node.agentId !== input.agentId
    || node.attemptId !== input.attemptId
    || node.recordPath !== recordPath
    || node.worktreeRoot !== expectedWorktreeRoot
    || node.attemptRef !== expectedAttemptRef
  ) {
    throw new WorkspaceIsolationError(`node workspace cleanup identity mismatch: ${recordPath}`);
  }
  const existed = existsSync(node.worktreeRoot);
  if (existed) {
    runGit(runWorkspace.sourceRepositoryRoot, [
      "worktree",
      "remove",
      "--force",
      node.worktreeRoot,
    ]);
  }
  runGit(runWorkspace.sourceRepositoryRoot, ["update-ref", "-d", node.attemptRef]);
  return existed ? "removed" : "already-removed";
}

/**
 * Reclaim an allocation that failed before agent instructions ran. The exact
 * attempt-owned path/ref are removed only while the worktree is still pristine
 * at its pinned base. Any commit, staged file, or untracked file preserves the
 * worktree for recovery instead of guessing that it is disposable.
 */
export function removePristineGitNodeWorkspace(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  agentId: string;
  attemptId: string;
}): "removed" | "already-removed" | "preserved-changes" {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  const recordPath = nodeRecordPath(runWorkspace, input.attemptId);
  if (!existsSync(recordPath)) return "already-removed";
  const candidate = readJson<GitNodeWorkspace>(recordPath);
  const nodeKey = digest(input.attemptId, 32);
  const expectedWorktreeRoot = join(runWorkspace.worktreesRoot, nodeKey);
  const expectedAttemptRef = `${runRefPrefix(runWorkspace.runId)}/attempts/${nodeKey}`;
  if (
    candidate.runId !== runWorkspace.runId
    || candidate.agentId !== input.agentId
    || candidate.attemptId !== input.attemptId
    || candidate.recordPath !== recordPath
    || candidate.worktreeRoot !== expectedWorktreeRoot
    || candidate.attemptRef !== expectedAttemptRef
  ) {
    throw new WorkspaceIsolationError(`node workspace cleanup identity mismatch: ${recordPath}`);
  }
  if (!existsSync(candidate.worktreeRoot)) {
    runGit(runWorkspace.sourceRepositoryRoot, ["update-ref", "-d", candidate.attemptRef]);
    return "already-removed";
  }
  const node = assertNodeWorkspace(runWorkspace, candidate, {
    agentId: input.agentId,
    attemptId: input.attemptId,
    recordPath,
  });
  const head = runGit(node.worktreeRoot, ["rev-parse", "HEAD"]);
  const status = runGit(node.worktreeRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (head !== node.baseCommit || status.length > 0) return "preserved-changes";
  runGit(runWorkspace.sourceRepositoryRoot, [
    "worktree",
    "remove",
    "--force",
    node.worktreeRoot,
  ]);
  runGit(runWorkspace.sourceRepositoryRoot, ["update-ref", "-d", node.attemptRef]);
  return "removed";
}

function publicationArtifactPath(runWorkspace: GitRunWorkspaceIsolation): string {
  return join(runWorkspace.isolationRoot, "receipts", "publication.json");
}

function publicationConflictArtifactPath(
  runWorkspace: GitRunWorkspaceIsolation,
  sourceSnapshot: GitWorkspaceSnapshot,
): string {
  const sourceIdentity = JSON.stringify({
    sourceHead: sourceSnapshot.sourceHead,
    sourceBranch: sourceSnapshot.sourceBranch,
    sourceIndexSha256: sourceSnapshot.sourceIndexSha256,
    snapshotTree: sourceSnapshot.snapshotTree,
  });
  return join(
    runWorkspace.isolationRoot,
    "receipts",
    "publication-conflicts",
    `${digest(sourceIdentity, 32)}.json`,
  );
}

function assertPublicationResult(
  runWorkspace: GitRunWorkspaceIsolation,
  baseline: GitWorkspaceSnapshot,
  integrationCommit: string,
  publication: GitRunWorkspacePublicationResult,
  artifactPath: string,
): GitRunWorkspacePublicationResult {
  const validSourceSnapshot = (snapshot: GitWorkspaceSnapshot | undefined): boolean => Boolean(
    snapshot
    && snapshot.version === 1
    && snapshot.kind === "git"
    && snapshot.sourceWorkspacePath === runWorkspace.sourceWorkspacePath
    && snapshot.repositoryRoot === runWorkspace.sourceRepositoryRoot
    && snapshot.gitCommonDir === runWorkspace.gitCommonDir
    && snapshot.relativeWorkspacePath === runWorkspace.relativeWorkspacePath
    && typeof snapshot.sourceIndexSha256 === "string"
    && /^[a-f0-9]{64}$/.test(snapshot.sourceIndexSha256),
  );
  if (
    !publication
    ||
    publication.version !== WORKSPACE_ISOLATION_VERSION
    || publication.kind !== "git-run-workspace-publication"
    || publication.runId !== runWorkspace.runId
    || publication.baselineCommit !== runWorkspace.baselineCommit
    || publication.integrationCommit !== integrationCommit
    || publication.artifactPath !== artifactPath
    || typeof publication.publishedAt !== "string"
    || !Number.isFinite(Date.parse(publication.publishedAt))
    || !validSourceSnapshot(publication.sourceSnapshot)
  ) {
    throw new WorkspaceIsolationError(`run workspace publication identity mismatch: ${artifactPath}`);
  }
  const integrationTree = runGit(
    runWorkspace.sourceRepositoryRoot,
    ["rev-parse", `${integrationCommit}^{tree}`],
  );
  const expectedChanges = compareGitWorkspaceSnapshots(
    { ...baseline, repositoryRoot: runWorkspace.sourceRepositoryRoot },
    { ...publication.sourceSnapshot, repositoryRoot: runWorkspace.sourceRepositoryRoot },
  );
  if (JSON.stringify(expectedChanges) !== JSON.stringify(publication.sourceChanges)) {
    throw new WorkspaceIsolationError(`run workspace publication changes mismatch: ${artifactPath}`);
  }
  const validStatus = (() => {
    switch (publication.status) {
      case "no-changes":
        return artifactPath === publicationArtifactPath(runWorkspace)
          && integrationTree === runWorkspace.baselineTree
          && !publication.publishedSnapshot;
      case "source-changed":
        return artifactPath === publicationConflictArtifactPath(
          runWorkspace,
          publication.sourceSnapshot,
        )
          && !sourceStillAtBaseline(baseline, publication.sourceSnapshot)
          && !publication.publishedSnapshot;
      case "already-published":
        return artifactPath === publicationArtifactPath(runWorkspace)
          && validSourceSnapshot(publication.publishedSnapshot)
          && sourceMatchesIntegrationAfterApply(
            baseline,
            publication.sourceSnapshot,
            integrationTree,
          )
          && sourceMatchesIntegrationAfterApply(
            baseline,
            publication.publishedSnapshot!,
            integrationTree,
          );
      case "published":
        return artifactPath === publicationArtifactPath(runWorkspace)
          && validSourceSnapshot(publication.publishedSnapshot)
          && sourceStillAtBaseline(baseline, publication.sourceSnapshot)
          && sourceMatchesIntegrationAfterApply(
            baseline,
            publication.publishedSnapshot!,
            integrationTree,
          );
      default:
        return false;
    }
  })();
  if (!validStatus) {
    throw new WorkspaceIsolationError(`run workspace publication status mismatch: ${artifactPath}`);
  }
  return publication;
}

function sourceStillAtBaseline(
  baseline: GitWorkspaceSnapshot,
  observed: GitWorkspaceSnapshot,
): boolean {
  return observed.gitCommonDir === baseline.gitCommonDir
    && observed.relativeWorkspacePath === baseline.relativeWorkspacePath
    && observed.sourceHead === baseline.sourceHead
    && observed.sourceBranch === baseline.sourceBranch
    && (
      baseline.sourceIndexSha256 === undefined
      || observed.sourceIndexSha256 === baseline.sourceIndexSha256
    )
    && observed.snapshotTree === baseline.snapshotTree;
}

function sourceMatchesIntegrationAfterApply(
  baseline: GitWorkspaceSnapshot,
  observed: GitWorkspaceSnapshot,
  integrationTree: string,
): boolean {
  return observed.sourceHead === baseline.sourceHead
    && observed.sourceBranch === baseline.sourceBranch
    && (
      baseline.sourceIndexSha256 === undefined
      || observed.sourceIndexSha256 === baseline.sourceIndexSha256
    )
    && observed.snapshotTree === integrationTree;
}

export function publishGitRunWorkspaceResult(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  baseline: GitWorkspaceSnapshot;
  now?: Date;
  /** Deterministic race hook used by the fault-injection suite. */
  beforeApplyCas?: () => void;
}): GitRunWorkspacePublicationResult {
  const runWorkspace = assertRunIsolation(input.runWorkspace, {
    runId: input.runWorkspace.runId,
    statePath: input.runWorkspace.statePath,
  });
  if (
    input.baseline.snapshotCommit !== runWorkspace.baselineCommit
    || input.baseline.snapshotTree !== runWorkspace.baselineTree
    || input.baseline.sourceWorkspacePath !== runWorkspace.sourceWorkspacePath
    || input.baseline.gitCommonDir !== runWorkspace.gitCommonDir
  ) {
    throw new WorkspaceIsolationError("workspace publication baseline does not match run isolation");
  }

  const integrationCommit = requiredRef(
    runWorkspace.sourceRepositoryRoot,
    runWorkspace.integrationRef,
  );
  const integrationTree = runGit(
    runWorkspace.sourceRepositoryRoot,
    ["rev-parse", `${integrationCommit}^{tree}`],
  );
  const artifactPath = publicationArtifactPath(runWorkspace);
  const publicationClaim = join(
    runWorkspace.gitCommonDir,
    "mentiko-workspace-publication-claims",
    `${digest(runWorkspace.sourceWorkspacePath, 32)}.claim`,
  );

  return withExclusiveFileClaim(publicationClaim, () => {
    if (existsSync(artifactPath)) {
      return assertPublicationResult(
        runWorkspace,
        input.baseline,
        integrationCommit,
        readJson<GitRunWorkspacePublicationResult>(artifactPath),
        artifactPath,
      );
    }

    const publishedAt = (input.now || new Date()).toISOString();
    let sourceSnapshot = captureGitWorkspaceSnapshot({
      workspacePath: runWorkspace.sourceWorkspacePath,
      scratchDir: createWorkspaceSnapshotScratchDir(runWorkspace.runDir),
      label: `${runWorkspace.runId}-source-publication-cas`,
      capturedAt: publishedAt,
    });
    let sourceChanges = compareGitWorkspaceSnapshots(input.baseline, sourceSnapshot);
    let status: GitRunWorkspacePublicationStatus;
    let publishedSnapshot: GitWorkspaceSnapshot | undefined;

    if (integrationTree === runWorkspace.baselineTree) {
      status = "no-changes";
    } else if (sourceMatchesIntegrationAfterApply(input.baseline, sourceSnapshot, integrationTree)) {
      // Crash recovery: the worktree was updated but the immutable receipt was
      // not written. HEAD and branch staying at the baseline distinguish this
      // from a user commit that merely happens to have the same tree.
      status = "already-published";
      publishedSnapshot = sourceSnapshot;
    } else if (!sourceStillAtBaseline(input.baseline, sourceSnapshot)) {
      status = "source-changed";
    } else {
      const patch = runGitResult(runWorkspace.sourceRepositoryRoot, [
        "diff",
        "--binary",
        "--full-index",
        runWorkspace.baselineCommit,
        integrationCommit,
        "--",
        runWorkspace.relativeWorkspacePath,
      ]).stdout;
      input.beforeApplyCas?.();
      const casSnapshot = captureGitWorkspaceSnapshot({
        workspacePath: runWorkspace.sourceWorkspacePath,
        scratchDir: createWorkspaceSnapshotScratchDir(runWorkspace.runDir),
        label: `${runWorkspace.runId}-source-publication-preapply-cas`,
        capturedAt: publishedAt,
      });
      if (!sourceStillAtBaseline(input.baseline, casSnapshot)) {
        sourceSnapshot = casSnapshot;
        sourceChanges = compareGitWorkspaceSnapshots(input.baseline, sourceSnapshot);
        status = "source-changed";
      } else {
        runGitWithInput(runWorkspace.sourceRepositoryRoot, [
          "apply",
          "--check",
          "--binary",
          "--whitespace=nowarn",
          "-",
        ], patch);
        runGitWithInput(runWorkspace.sourceRepositoryRoot, [
          "apply",
          "--binary",
          "--whitespace=nowarn",
          "-",
        ], patch);
        const verified = captureGitWorkspaceSnapshot({
          workspacePath: runWorkspace.sourceWorkspacePath,
          scratchDir: createWorkspaceSnapshotScratchDir(runWorkspace.runDir),
          label: `${runWorkspace.runId}-source-publication-verify`,
          capturedAt: publishedAt,
        });
        if (!sourceMatchesIntegrationAfterApply(input.baseline, verified, integrationTree)) {
          throw new WorkspaceIsolationError(
            `source workspace changed while publishing run ${runWorkspace.runId}`,
          );
        }
        status = "published";
        publishedSnapshot = verified;
      }
    }

    const receiptPath = status === "source-changed"
      ? publicationConflictArtifactPath(runWorkspace, sourceSnapshot)
      : artifactPath;
    const candidate: GitRunWorkspacePublicationResult = {
      version: WORKSPACE_ISOLATION_VERSION,
      kind: "git-run-workspace-publication",
      runId: runWorkspace.runId,
      status,
      baselineCommit: runWorkspace.baselineCommit,
      integrationCommit,
      artifactPath: receiptPath,
      publishedAt,
      sourceSnapshot,
      sourceChanges,
      ...(publishedSnapshot ? { publishedSnapshot } : {}),
    };
    const persisted = writeJsonOnce(receiptPath, candidate);
    return assertPublicationResult(
      runWorkspace,
      input.baseline,
      integrationCommit,
      persisted,
      receiptPath,
    );
  }, { waitTimeoutMs: 30_000 });
}
