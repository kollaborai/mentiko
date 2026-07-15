import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  canonicalizeRunsDir,
  requireRunId,
  resolveExistingRunRecordPaths,
  resolveRunRecordPaths,
} from "@/lib/runs/run-record";
import {
  updateRunActivityManifestFromArtifacts,
} from "@/lib/runner-v2/run-record-operations";
import { profileTranscriptConfig } from "@/lib/runner-v2/agent-profile";

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GIT_SHA_PATTERN = /^[A-Fa-f0-9]{7,64}$/;
const CONVERSATION_WINDOW_SECONDS = 30;

export interface ActivityCaptureInput {
  agentId: string;
  runId: string;
  projectRoot: string;
  runsDir: string;
  reportFile?: string;
  profileFile?: string;
  namespaceId?: string;
  now?: Date;
}

export interface ActivityChangedFile {
  status: string;
  file: string;
}

export interface ActivityCaptureResult {
  agentId: string;
  runId: string;
  artifactsDir: string;
  git: {
    captured: boolean;
    diffPath?: string;
    filesChangedPath?: string;
    diffLines?: number;
    filesChanged?: number;
    reason?: string;
  };
  conversations: {
    captured: boolean;
    path?: string;
    files: string[];
    reason?: string;
  };
  output: {
    captured: boolean;
    path?: string;
    lines?: number;
    reason?: string;
  };
  manifest: {
    updated: boolean;
    reason?: string;
  };
}

/**
 * Capture the completion-time activity bundle for one agent.
 *
 * Filesystem JSON and provenance are owned here. Git remains an external
 * process boundary: its stdout is parsed as a typed name-status/diff result,
 * then published through the same atomic writer as every other artifact.
 */
export function captureAgentActivity(input: ActivityCaptureInput): ActivityCaptureResult {
  const agentId = requireAgentId(input.agentId);
  const runId = requireRunId(input.runId);
  const projectRoot = requireDirectory(input.projectRoot, "project root");
  const runsDir = canonicalizeRunsDir(input.runsDir);
  ensureDirectory(runsDir, "runs root");

  const paths = resolveRunRecordPaths(runsDir, runId);
  ensureDirectory(paths.runDir, "run directory");
  const artifactsDir = join(paths.runDir, "artifacts");
  ensureDirectory(artifactsDir, "activity artifact directory");

  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Activity capture timestamp is invalid.");

  const result: ActivityCaptureResult = {
    agentId,
    runId,
    artifactsDir,
    git: { captured: false },
    conversations: { captured: false, files: [] },
    output: { captured: false },
    manifest: { updated: false },
  };

  captureGitActivity({ ...input, agentId, runId, projectRoot, artifactsDir }, result);
  captureConversations({ ...input, agentId, projectRoot, artifactsDir }, result);
  captureOutput({ ...input, agentId, artifactsDir }, result);
  updateManifest({ runsDir, runId, agentId, runJsonPath: paths.runJsonPath, result, now });
  return result;
}

interface GitCaptureInput {
  agentId: string;
  runId: string;
  projectRoot: string;
  artifactsDir: string;
}

function captureGitActivity(input: GitCaptureInput, result: ActivityCaptureResult): void {
  const beforeShaPath = join(input.artifactsDir, `${input.agentId}-git-before.txt`);
  if (!existsSync(beforeShaPath)) {
    result.git.reason = "git-before artifact is absent";
    return;
  }
  assertRegularFile(beforeShaPath, "git-before artifact");
  const beforeSha = readFileSync(beforeShaPath, "utf8").trim();
  if (!GIT_SHA_PATTERN.test(beforeSha)) {
    result.git.reason = "git-before artifact does not contain a valid commit id";
    return;
  }

  const commitProbe = runGit(input.projectRoot, ["cat-file", "-e", `${beforeSha}^{commit}`]);
  if (commitProbe.status !== 0) {
    result.git.reason = "git-before commit is not present in the project repository";
    return;
  }

  const diffPath = join(input.artifactsDir, `${input.agentId}-diff.patch`);
  let diff = runGitRequired(input.projectRoot, ["diff", `${beforeSha}..HEAD`]);
  if (diff.length === 0) {
    const staged = runGitRequired(input.projectRoot, ["diff", "--staged"]);
    const unstaged = runGitRequired(input.projectRoot, ["diff"]);
    diff = `${staged}${staged && unstaged ? "\n" : ""}${unstaged}`;
  }
  writeAtomic(diffPath, diff);

  const committedNames = runGitRequired(input.projectRoot, ["diff", "--name-status", `${beforeSha}..HEAD`]);
  const changedOutput = committedNames.length > 0
    ? committedNames
    : `${runGitRequired(input.projectRoot, ["diff", "--name-status", "--staged"])}${runGitRequired(input.projectRoot, ["diff", "--name-status"])}`;
  const changed = dedupeChangedFiles(parseGitNameStatus(changedOutput));
  const changedPath = join(input.artifactsDir, `${input.agentId}-files-changed.json`);
  writeAtomic(changedPath, `${JSON.stringify(changed, null, 2)}\n`);

  result.git = {
    captured: true,
    diffPath,
    filesChangedPath: changedPath,
    diffLines: countLines(diff),
    filesChanged: changed.length,
  };
}

interface ConversationCaptureInput {
  agentId: string;
  projectRoot: string;
  artifactsDir: string;
  profileFile?: string;
}

function captureConversations(input: ConversationCaptureInput, result: ActivityCaptureResult): void {
  const startedAtPath = join(input.artifactsDir, `${input.agentId}-started-at.txt`);
  if (!existsSync(startedAtPath)) {
    result.conversations.reason = "started-at artifact is absent";
    return;
  }
  assertRegularFile(startedAtPath, "started-at artifact");
  const startedAt = Date.parse(readFileSync(startedAtPath, "utf8").trim());
  if (!Number.isFinite(startedAt)) throw new Error(`Invalid started-at artifact: ${startedAtPath}`);

  const conversationPath = join(input.artifactsDir, `${input.agentId}-conversations.json`);
  const files = input.profileFile
    ? findConversationFiles(input.profileFile, input.projectRoot, startedAt)
    : [];
  writeAtomic(conversationPath, `${JSON.stringify(files.map((path) => ({ path })), null, 2)}\n`);
  result.conversations = {
    captured: true,
    path: conversationPath,
    files,
    ...(files.length === 0 && !input.profileFile ? { reason: "profile file is absent" } : {}),
  };
}

interface OutputCaptureInput {
  agentId: string;
  artifactsDir: string;
  reportFile?: string;
}

function captureOutput(input: OutputCaptureInput, result: ActivityCaptureResult): void {
  if (!input.reportFile) {
    result.output.reason = "report file is absent";
    return;
  }
  if (!existsSync(input.reportFile)) {
    result.output.reason = "report file does not exist";
    return;
  }
  assertRegularFile(input.reportFile, "report file");
  const outputPath = join(input.artifactsDir, `${input.agentId}-output.txt`);
  if (resolve(input.reportFile) === resolve(outputPath)) {
    throw new Error("Report file cannot be the activity output artifact itself.");
  }
  const output = readFileSync(input.reportFile);
  writeAtomic(outputPath, output);
  result.output = {
    captured: true,
    path: outputPath,
    lines: countLines(output.toString("utf8")),
  };
}

interface ManifestInput {
  runsDir: string;
  runId: string;
  agentId: string;
  runJsonPath: string;
  result: ActivityCaptureResult;
  now: Date;
}

function updateManifest(input: ManifestInput): void {
  if (!existsSync(input.runJsonPath)) {
    input.result.manifest.reason = "run.json is absent";
    return;
  }
  // Resolve and validate the complete run record before allowing a provenance
  // mutation. This rejects symlinked run directories and run.json files.
  const existing = resolveExistingRunRecordPaths(input.runsDir, input.runId);
  try {
    updateRunActivityManifestFromArtifacts(existing.runJsonPath, input.agentId, input.now);
    input.result.manifest.updated = true;
  } catch (error) {
    input.result.manifest.reason = error instanceof Error ? error.message : String(error);
  }
}

function findConversationFiles(profilePath: string, projectRoot: string, startedAtMs: number): string[] {
  assertRegularFile(profilePath, "agent profile");
  const { cli, logPath } = profileTranscriptConfig(profilePath);
  if (!logPath) return [];

  const expanded = logPath.startsWith("~") ? join(process.env.HOME || "", logPath.slice(2)) : logPath;
  const absoluteLogPath = isAbsolute(expanded) ? resolve(expanded) : resolve(projectRoot, expanded);
  const slug = encodeCwdSlug(cli, projectRoot);
  const searchDir = slug ? join(absoluteLogPath, slug) : absoluteLogPath;
  if (!existsSync(searchDir)) return [];
  assertDirectoryNotSymlink(searchDir, "conversation log directory");

  let candidateDir = searchDir;
  if (cli === "codex") {
    const dateDir = join(searchDir, localDatePath(startedAtMs));
    if (existsSync(dateDir)) {
      assertDirectoryNotSymlink(dateDir, "codex conversation date directory");
      candidateDir = dateDir;
    }
  }

  const files = listJsonlFiles(candidateDir);
  const startSeconds = startedAtMs / 1000;
  const matching = files.filter((path) => {
    const stamp = fileBirthOrMtime(path);
    const difference = stamp - startSeconds;
    return difference >= -CONVERSATION_WINDOW_SECONDS && difference <= CONVERSATION_WINDOW_SECONDS;
  });
  if (matching.length > 0) return matching.sort();
  return files
    .sort((left, right) => fileBirthOrMtime(right) - fileBirthOrMtime(left))
    .slice(0, 1);
}

function listJsonlFiles(directory: string, depth = 0): string[] {
  assertDirectoryNotSymlink(directory, "conversation log directory");
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(path);
      continue;
    }
    if (stat.isDirectory() && depth < 2) files.push(...listJsonlFiles(path, depth + 1));
  }
  return files;
}

function fileBirthOrMtime(path: string): number {
  const stat = statSync(path);
  const birth = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
  return birth / 1000;
}

function encodeCwdSlug(cli: string, cwd: string): string {
  if (cli === "codex") return "";
  if (cli.startsWith("kollab")) return cwd.replace(/^\//, "").replaceAll("/", "_");
  return cwd.replace(/^\//, "-").replaceAll(/[/.]/g, "-");
}

function localDatePath(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

function parseGitNameStatus(output: string): ActivityChangedFile[] {
  if (output.length === 0) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const fields = line.split("\t");
    if (fields.length < 2 || !fields[0] || !fields[1] || fields.some((field) => field.includes("\n"))) {
      throw new Error(`Invalid git name-status output: ${line}`);
    }
    return { status: fields[0], file: fields[1] };
  });
}

function dedupeChangedFiles(files: ActivityChangedFile[]): ActivityChangedFile[] {
  const byPath = new Map<string, ActivityChangedFile>();
  for (const file of files) byPath.set(file.file, file);
  return [...byPath.values()];
}

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runGit(projectRoot: string, args: string[]): GitResult {
  const result = spawnSync("git", ["-C", projectRoot, ...args], { encoding: "utf8" });
  if (result.error) throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

function runGitRequired(projectRoot: string, args: string[]): string {
  const result = runGit(projectRoot, args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  return result.stdout;
}

function writeAtomic(path: string, content: string | Buffer): void {
  const directory = dirname(path);
  ensureDirectory(directory, "activity artifact directory");
  if (existsSync(path)) {
    const existing = lstatSync(path);
    if (existing.isSymbolicLink()) throw new Error(`Activity artifact must not be a symbolic link: ${path}`);
    if (!existing.isFile()) throw new Error(`Activity artifact must be a regular file: ${path}`);
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
  renameSync(temporaryPath, path);
}

function ensureDirectory(path: string, label: string): void {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute: ${path}`);
  mkdirSync(path, { recursive: true });
  assertDirectoryNotSymlink(path, label);
}

function assertDirectoryNotSymlink(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${path}`);
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
}

function requireDirectory(path: string, label: string): string {
  if (!path || !isAbsolute(path)) throw new Error(`${label} must be an absolute path.`);
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  assertDirectoryNotSymlink(path, label);
  // Preserve the caller's configured spelling for profile transcript slugs
  // (Claude derives them from the workspace path), while lstat above rejects a
  // symlink at the workspace boundary.
  return resolve(path);
}

function requireAgentId(value: string): string {
  if (!AGENT_ID_PATTERN.test(value)) throw new Error(`Invalid agent id: ${value}`);
  return value;
}

function countLines(value: string): number {
  return (value.match(/\n/g) || []).length;
}
