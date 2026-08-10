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

function assertNodeWorkspace(
  runWorkspace: GitRunWorkspaceIsolation,
  node: GitNodeWorkspace,
  expected: { agentId: string; attemptId: string; recordPath: string },
): GitNodeWorkspace {
  if (
    node.version !== WORKSPACE_ISOLATION_VERSION
    || node.kind !== "git-node-worktree"
    || node.runId !== runWorkspace.runId
    || node.agentId !== expected.agentId
    || node.attemptId !== expected.attemptId
    || node.recordPath !== expected.recordPath
    || node.relativeWorkspacePath !== runWorkspace.relativeWorkspacePath
  ) {
    throw new WorkspaceIsolationError(`node workspace identity mismatch: ${expected.recordPath}`);
  }
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
        return assertNodeWorkspace(runWorkspace, readJson<GitNodeWorkspace>(recordPath), {
          agentId: input.agentId,
          attemptId: input.attemptId,
          recordPath,
        });
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
            ensureRef(runWorkspace.sourceRepositoryRoot, attemptRef, current);
            return current;
          },
          { waitTimeoutMs: 30_000 },
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
    runWorkspace.runDir,
    "artifacts",
    `${safeArtifactSegment(node.agentId)}-workspace-result-${digest(node.attemptId, 16)}.json`,
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
    repositoryRoot: node.worktreeRoot,
    gitCommonDir: runWorkspace.gitCommonDir,
    relativeWorkspacePath: node.relativeWorkspacePath,
    sourceHead: node.baseCommit,
    baseCommit: node.baseCommit,
    snapshotCommit: node.baseCommit,
    snapshotTree: runGit(node.worktreeRoot, ["rev-parse", `${node.baseCommit}^{tree}`]),
    dirtyFromHead: false,
  };
}

function assertNodeResult(
  node: GitNodeWorkspace,
  result: GitNodeWorkspaceResult,
  artifactPath: string,
): GitNodeWorkspaceResult {
  if (
    result.version !== WORKSPACE_ISOLATION_VERSION
    || result.kind !== "git-node-result"
    || result.runId !== node.runId
    || result.agentId !== node.agentId
    || result.attemptId !== node.attemptId
    || result.baseCommit !== node.baseCommit
    || result.artifactPath !== artifactPath
  ) {
    throw new WorkspaceIsolationError(`node result identity mismatch: ${artifactPath}`);
  }
  return result;
}

export function finalizeGitNodeWorkspace(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  node: GitNodeWorkspace;
  now?: Date;
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
      return assertNodeResult(node, readJson<GitNodeWorkspaceResult>(artifactPath), artifactPath);
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
    const attemptRefCommit = requiredRef(runWorkspace.sourceRepositoryRoot, node.attemptRef);
    if (attemptRefCommit === node.baseCommit && candidate.resultCommit !== node.baseCommit) {
      updateRef(
        runWorkspace.sourceRepositoryRoot,
        node.attemptRef,
        candidate.resultCommit,
        node.baseCommit,
      );
    } else if (
      attemptRefCommit !== node.baseCommit
      && attemptRefCommit !== candidate.resultCommit
    ) {
      throw new WorkspaceIsolationError(`node attempt ref changed unexpectedly: ${node.attemptRef}`);
    }
    const persisted = writeJsonOnce(artifactPath, candidate);
    return assertNodeResult(node, persisted, artifactPath);
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
  return join(
    runWorkspace.runDir,
    "artifacts",
    `${safeArtifactSegment(result.agentId)}-workspace-integration-${digest(result.attemptId, 16)}.json`,
  );
}

function assertIntegrationResult(
  result: GitNodeWorkspaceResult,
  integration: GitNodeIntegrationResult,
  artifactPath: string,
): GitNodeIntegrationResult {
  if (
    integration.version !== WORKSPACE_ISOLATION_VERSION
    || integration.kind !== "git-node-integration"
    || integration.runId !== result.runId
    || integration.agentId !== result.agentId
    || integration.attemptId !== result.attemptId
    || integration.baseCommit !== result.baseCommit
    || integration.resultCommit !== result.resultCommit
    || integration.artifactPath !== artifactPath
  ) {
    throw new WorkspaceIsolationError(`node integration identity mismatch: ${artifactPath}`);
  }
  return integration;
}

export function integrateGitNodeWorkspaceResult(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  result: GitNodeWorkspaceResult;
  now?: Date;
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

  return withExclusiveFileClaim(nodeClaim, () => {
    if (existsSync(artifactPath)) {
      return assertIntegrationResult(
        input.result,
        readJson<GitNodeIntegrationResult>(artifactPath),
        artifactPath,
      );
    }
    return withExclusiveFileClaim(
      join(runWorkspace.isolationRoot, "claims", "integration.claim"),
      () => {
        const previousIntegrationCommit = requiredRef(
          runWorkspace.sourceRepositoryRoot,
          runWorkspace.integrationRef,
        );
        const integratedAt = (input.now || new Date()).toISOString();
        let candidate: GitNodeIntegrationResult;

        if (input.result.resultCommit === input.result.baseCommit) {
          candidate = {
            version: WORKSPACE_ISOLATION_VERSION,
            kind: "git-node-integration",
            runId: input.result.runId,
            agentId: input.result.agentId,
            attemptId: input.result.attemptId,
            status: "no-changes",
            baseCommit: input.result.baseCommit,
            resultCommit: input.result.resultCommit,
            previousIntegrationCommit,
            integrationCommit: previousIntegrationCommit,
            conflictPaths: [],
            artifactPath,
            integratedAt,
          };
        } else if (isAncestor(
          runWorkspace.sourceRepositoryRoot,
          input.result.resultCommit,
          previousIntegrationCommit,
        )) {
          candidate = {
            version: WORKSPACE_ISOLATION_VERSION,
            kind: "git-node-integration",
            runId: input.result.runId,
            agentId: input.result.agentId,
            attemptId: input.result.attemptId,
            status: "already-integrated",
            baseCommit: input.result.baseCommit,
            resultCommit: input.result.resultCommit,
            previousIntegrationCommit,
            integrationCommit: previousIntegrationCommit,
            conflictPaths: [],
            artifactPath,
            integratedAt,
          };
        } else if (previousIntegrationCommit === input.result.baseCommit) {
          updateRef(
            runWorkspace.sourceRepositoryRoot,
            runWorkspace.integrationRef,
            input.result.resultCommit,
            previousIntegrationCommit,
          );
          candidate = {
            version: WORKSPACE_ISOLATION_VERSION,
            kind: "git-node-integration",
            runId: input.result.runId,
            agentId: input.result.agentId,
            attemptId: input.result.attemptId,
            status: "integrated",
            baseCommit: input.result.baseCommit,
            resultCommit: input.result.resultCommit,
            previousIntegrationCommit,
            integrationCommit: input.result.resultCommit,
            conflictPaths: [],
            artifactPath,
            integratedAt,
          };
        } else {
          const merged = mergeTree(
            runWorkspace.sourceRepositoryRoot,
            previousIntegrationCommit,
            input.result.resultCommit,
          );
          if (merged.status === "conflict") {
            candidate = {
              version: WORKSPACE_ISOLATION_VERSION,
              kind: "git-node-integration",
              runId: input.result.runId,
              agentId: input.result.agentId,
              attemptId: input.result.attemptId,
              status: "conflict",
              baseCommit: input.result.baseCommit,
              resultCommit: input.result.resultCommit,
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
                input.result.resultCommit,
                "-m",
                `Mentiko node integration: ${safeArtifactSegment(input.result.agentId)}`,
              ],
              syntheticIdentity(input.result.attemptId, integratedAt),
            );
            updateRef(
              runWorkspace.sourceRepositoryRoot,
              runWorkspace.integrationRef,
              mergeCommit,
              previousIntegrationCommit,
            );
            candidate = {
              version: WORKSPACE_ISOLATION_VERSION,
              kind: "git-node-integration",
              runId: input.result.runId,
              agentId: input.result.agentId,
              attemptId: input.result.attemptId,
              status: "integrated",
              baseCommit: input.result.baseCommit,
              resultCommit: input.result.resultCommit,
              previousIntegrationCommit,
              integrationCommit: mergeCommit,
              mergeCommit,
              conflictPaths: [],
              artifactPath,
              integratedAt,
            };
          }
        }

        const persisted = writeJsonOnce(artifactPath, candidate);
        return assertIntegrationResult(input.result, persisted, artifactPath);
      },
      { waitTimeoutMs: 30_000 },
    );
  }, { waitTimeoutMs: 30_000 });
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

function publicationArtifactPath(runWorkspace: GitRunWorkspaceIsolation): string {
  return join(runWorkspace.runDir, "artifacts", "workspace-publication.json");
}

function assertPublicationResult(
  runWorkspace: GitRunWorkspaceIsolation,
  integrationCommit: string,
  publication: GitRunWorkspacePublicationResult,
  artifactPath: string,
): GitRunWorkspacePublicationResult {
  if (
    publication.version !== WORKSPACE_ISOLATION_VERSION
    || publication.kind !== "git-run-workspace-publication"
    || publication.runId !== runWorkspace.runId
    || publication.baselineCommit !== runWorkspace.baselineCommit
    || publication.integrationCommit !== integrationCommit
    || publication.artifactPath !== artifactPath
  ) {
    throw new WorkspaceIsolationError(`run workspace publication identity mismatch: ${artifactPath}`);
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
    && observed.snapshotTree === baseline.snapshotTree;
}

function sourceMatchesIntegrationAfterApply(
  baseline: GitWorkspaceSnapshot,
  observed: GitWorkspaceSnapshot,
  integrationTree: string,
): boolean {
  return observed.sourceHead === baseline.sourceHead
    && observed.sourceBranch === baseline.sourceBranch
    && observed.snapshotTree === integrationTree;
}

export function publishGitRunWorkspaceResult(input: {
  runWorkspace: GitRunWorkspaceIsolation;
  baseline: GitWorkspaceSnapshot;
  now?: Date;
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
        integrationCommit,
        readJson<GitRunWorkspacePublicationResult>(artifactPath),
        artifactPath,
      );
    }

    const publishedAt = (input.now || new Date()).toISOString();
    const sourceSnapshot = captureGitWorkspaceSnapshot({
      workspacePath: runWorkspace.sourceWorkspacePath,
      scratchDir: createWorkspaceSnapshotScratchDir(runWorkspace.runDir),
      label: `${runWorkspace.runId}-source-publication-cas`,
      capturedAt: publishedAt,
    });
    const sourceChanges = compareGitWorkspaceSnapshots(input.baseline, sourceSnapshot);
    let status: GitRunWorkspacePublicationStatus;

    if (integrationTree === runWorkspace.baselineTree) {
      status = "no-changes";
    } else if (sourceMatchesIntegrationAfterApply(input.baseline, sourceSnapshot, integrationTree)) {
      // Crash recovery: the worktree was updated but the immutable receipt was
      // not written. HEAD and branch staying at the baseline distinguish this
      // from a user commit that merely happens to have the same tree.
      status = "already-published";
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
    }

    const candidate: GitRunWorkspacePublicationResult = {
      version: WORKSPACE_ISOLATION_VERSION,
      kind: "git-run-workspace-publication",
      runId: runWorkspace.runId,
      status,
      baselineCommit: runWorkspace.baselineCommit,
      integrationCommit,
      artifactPath,
      publishedAt,
      sourceSnapshot,
      sourceChanges,
    };
    const persisted = writeJsonOnce(artifactPath, candidate);
    return assertPublicationResult(runWorkspace, integrationCommit, persisted, artifactPath);
  }, { waitTimeoutMs: 30_000 });
}
