import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";

/**
 * Structured projections returned by the legacy git integration helpers.
 *
 * Git itself remains the external product boundary. TypeScript owns the
 * parsing and serialization of the records so callers never have to decode
 * shell-generated JSON.
 */
export interface GitStatusRecord {
  branch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
  has_changes: boolean;
}

export interface GitHistoryRecord {
  hash: string;
  short: string;
  author: string;
  date: string;
  message: string;
}

export interface GitHistoryDetailedRecord extends GitHistoryRecord {
  body: string;
}

export interface GitDiffFile {
  status: string;
  file: string;
  diff: string;
}

export interface GitDiffRecord {
  from: string;
  to: string;
  files: GitDiffFile[];
}

export interface GitDiffSummaryFile {
  status: string;
  file: string;
  additions: number;
  deletions: number;
}

export interface GitDiffSummaryRecord {
  from: string;
  to: string;
  files: GitDiffSummaryFile[];
  summary: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  diff?: string;
}

export type GitCommandRunner = (cwd: string, args: string[]) => string;
export type GitBytesRunner = (cwd: string, args: string[]) => Buffer;

export class GitRepositoryError extends Error {
  constructor(public readonly chainDir: string) {
    super(`not a git repo: ${chainDir}`);
    this.name = "GitRepositoryError";
  }
}

/** Return true only for a normal directory-backed repository. */
export function isGitRepository(chainDir: string): boolean {
  try {
    return lstatSync(join(chainDir, ".git")).isDirectory();
  } catch {
    return false;
  }
}

function requireGitRepository(chainDir: string): void {
  if (!isGitRepository(chainDir)) throw new GitRepositoryError(chainDir);
}

function runGit(cwd: string, args: string[]): string {
  const output = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  return output;
}

function runGitBytes(cwd: string, args: string[]): Buffer {
  const output = execFileSync("git", args, {
    cwd,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function currentBranch(chainDir: string, runner: GitCommandRunner = runGit): string {
  const branch = runner(chainDir, ["branch", "--show-current"]).trim();
  return branch || "HEAD";
}

/**
 * Parse `git status --porcelain` into the stable status record consumed by
 * shell callers and API adapters. Both sides of the XY status are retained;
 * this fixes the old shell parser's omission of deleted/renamed files while
 * preserving the staged/modified split.
 */
export function readGitStatus(
  chainDir: string,
  runner: GitCommandRunner = runGit,
): GitStatusRecord {
  requireGitRepository(chainDir);
  const branch = currentBranch(chainDir, runner);
  const output = runner(chainDir, ["status", "--porcelain=v1"]);
  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3);
    if (!file) continue;
    if (status === "??") {
      untracked.push(file);
      continue;
    }
    if (status[0] && status[0] !== " ") staged.push(file);
    if (status[1] && status[1] !== " ") modified.push(file);
  }

  return {
    branch,
    staged,
    modified,
    untracked,
    has_changes: staged.length > 0 || modified.length > 0 || untracked.length > 0,
  };
}

function normalizeMaxCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error("max_count must be a non-negative integer");
  return value;
}

function parseRecordFields(record: string, count: number, label: string): string[] {
  const fields = record.split("\x1f");
  if (fields.length < count || fields.slice(0, count).some((field) => field.length === 0)) {
    throw new Error(`invalid ${label} record`);
  }
  return fields;
}

function requireRevision(value: string, label: string): string {
  if (!value || value.startsWith("-") || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

/** Parse git's record-separated log output into typed commit records. */
export function readGitHistory(
  chainDir: string,
  maxCount = 50,
  runner: GitCommandRunner = runGit,
): GitHistoryRecord[] {
  return readGitHistoryDetailed(chainDir, maxCount, "HEAD", runner).map(({ body: _body, ...record }) => record);
}

/** Read branch-scoped history including the commit body for API consumers. */
export function readGitHistoryDetailed(
  chainDir: string,
  maxCount = 50,
  branch = "HEAD",
  runner: GitCommandRunner = runGit,
): GitHistoryDetailedRecord[] {
  requireGitRepository(chainDir);
  const count = normalizeMaxCount(maxCount);
  const revision = requireRevision(branch, "branch");
  const output = runner(chainDir, [
    "log",
    "-n",
    String(count),
    "--pretty=format:%H%x1f%h%x1f%an%x1f%ci%x1f%s%x1f%b%x1e",
    revision,
  ]);
  return output
    .split("\x1e")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, short, author, date, message, ...bodyParts] = parseRecordFields(record, 5, "git history");
      return { hash, short, author, date, message, body: bodyParts.join("\x1f").trim() };
    });
}

function parseNameStatus(output: string): Array<{ status: string; file: string }> {
  return output
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => ({ status: line.slice(0, 1), file: line.slice(2) }))
    .filter((entry) => entry.file.length > 0);
}

/**
 * Capture a commit diff as base64 bytes so arbitrary patch text cannot alter
 * the JSON record. Git remains the only external process in this path.
 */
export function readGitDiff(
  chainDir: string,
  fromCommit = "HEAD",
  toCommit = "HEAD",
  runner: GitCommandRunner = runGit,
  bytesRunner: GitBytesRunner = runGitBytes,
): GitDiffRecord {
  requireGitRepository(chainDir);
  const from = requireRevision(fromCommit, "from revision");
  const to = requireRevision(toCommit, "to revision");
  const filesChanged = runner(chainDir, ["diff", "--name-status", from, to]);
  const files = parseNameStatus(filesChanged).map(({ status, file }) => ({
    status,
    file,
    diff: bytesRunner(chainDir, ["diff", from, to, "--", file]).toString("base64"),
  }));
  return { from, to, files };
}

function normalizedDiffStatus(status: string): string {
  switch (status[0]) {
    case "A": return "added";
    case "D": return "deleted";
    case "M": return "modified";
    case "R": return "renamed";
    case "C": return "copied";
    default: return status || "M";
  }
}

/** Parse numstat/name-status output into the API's stable diff summary record. */
export function readGitDiffSummary(
  chainDir: string,
  fromCommit = "HEAD",
  toCommit = "HEAD",
  includeContent = false,
  runner: GitCommandRunner = runGit,
  bytesRunner: GitBytesRunner = runGitBytes,
): GitDiffSummaryRecord {
  requireGitRepository(chainDir);
  const from = requireRevision(fromCommit, "from revision");
  const to = requireRevision(toCommit, "to revision");
  const nameStatus = parseNameStatus(runner(chainDir, ["diff", "--name-status", from, to]));
  const statusByFile = new Map(nameStatus.map((entry) => [entry.file, normalizedDiffStatus(entry.status)]));
  const files = runner(chainDir, ["diff", "--numstat", from, to])
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      const [additionsRaw, deletionsRaw, ...fileParts] = line.split("\t");
      const file = fileParts.join("\t").trim();
      if (!file) throw new Error("invalid git diff numstat record");
      const additions = additionsRaw === "-" ? 0 : Number(additionsRaw);
      const deletions = deletionsRaw === "-" ? 0 : Number(deletionsRaw);
      if (!Number.isInteger(additions) || additions < 0 || !Number.isInteger(deletions) || deletions < 0) {
        throw new Error("invalid git diff numstat record");
      }
      return { status: statusByFile.get(file) ?? "modified", file, additions, deletions };
    });
  const result: GitDiffSummaryRecord = {
    from,
    to,
    files,
    summary: {
      filesChanged: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
    },
  };
  if (includeContent) result.diff = bytesRunner(chainDir, ["diff", from, to]).toString("utf8");
  return result;
}

export function renderGitStatusText(record: GitStatusRecord): string {
  const lines = [`branch: ${record.branch}`];
  if (record.staged.length > 0) lines.push(`staged: ${record.staged.join(" ")}`);
  if (record.modified.length > 0) lines.push(`modified: ${record.modified.join(" ")}`);
  if (record.untracked.length > 0) lines.push(`untracked: ${record.untracked.join(" ")}`);
  return lines.join("\n");
}

export function renderGitHistoryText(records: GitHistoryRecord[]): string {
  return records.map((record) => `${record.short}|${record.author}|${record.date}|${record.message}`).join("\n");
}

export function renderGitDiffText(
  chainDir: string,
  fromCommit: string,
  toCommit: string,
  runner: GitCommandRunner = runGit,
): string {
  return runner(chainDir, ["diff", fromCommit, toCommit]);
}

export interface GitBranchRecord {
  name: string;
  short: string;
  author: string;
  date: string;
  message: string;
  current: boolean;
}

export interface GitConflictRecord {
  conflicts: string[];
}

export interface GitCommitFile {
  status: string;
  file: string;
}

export interface GitCommitInfoRecord {
  hash: string;
  short: string;
  author: string;
  author_email: string;
  date: string;
  message: string;
  body: string;
  files: GitCommitFile[];
}

export interface GitBranchComparisonRecord {
  branch1: string;
  branch2: string;
  ahead: number;
  behind: number;
}

export interface GitStashRecord {
  stash: string;
  branch: string;
  message: string;
  date: string;
}

/**
 * Split git format output that uses the \x1e record separator. git append a
 * trailing newline after each formatted record (for-each-ref, stash list), so
 * surrounding newlines are stripped per record before the caller splits fields.
 */
function splitRecords(output: string): string[] {
  return output
    .split("\x1e")
    .map((record) => record.replace(/^\r?\n/, "").replace(/\r?\n$/, ""))
    .filter((record) => record.length > 0);
}

/**
 * List local branches from `git for-each-ref` with the current branch flagged.
 * Field separators stay under TypeScript control; shell never pipes through jq.
 */
export function readGitBranches(
  chainDir: string,
  runner: GitCommandRunner = runGit,
): GitBranchRecord[] {
  requireGitRepository(chainDir);
  const current = runner(chainDir, ["branch", "--show-current"]).trim();
  // for-each-ref does not interpret the %x1f/%x1e escapes that --pretty does,
  // so the unit/record separator bytes are embedded literally and passed to git
  // verbatim (execFileSync never goes through a shell).
  const output = runner(chainDir, [
    "for-each-ref",
    `--format=%(refname:short)\x1f%(objectname:short)\x1f%(authorname)\x1f%(committerdate:iso8601)\x1f%(contents:subject)\x1e`,
    "refs/heads/",
  ]);
  return splitRecords(output).map((record) => {
    const [name, short, author, date, message = ""] = parseRecordFields(record, 4, "git branch");
    return { name, short, author, date, message, current: name === current };
  });
}

/**
 * Read unmerged paths from `git diff --name-only --diff-filter=U` as a stable
 * conflicts record. The normalized shape is always { conflicts: string[] };
 * the old shell branch that emitted a bare [] on empty output is gone.
 */
export function readGitConflicts(
  chainDir: string,
  runner: GitCommandRunner = runGit,
): GitConflictRecord {
  requireGitRepository(chainDir);
  const output = runner(chainDir, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { conflicts };
}

/**
 * Resolve a single commit's metadata and changed files from record-separated
 * `git show` output. Body bytes that contain newlines are preserved verbatim;
 * a missing commit fails closed through git instead of inventing an empty record.
 */
export function readGitCommitInfo(
  chainDir: string,
  commit = "HEAD",
  runner: GitCommandRunner = runGit,
): GitCommitInfoRecord {
  requireGitRepository(chainDir);
  const revision = requireRevision(commit, "commit");
  const info = runner(chainDir, [
    "show",
    "-s",
    "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ci%x1f%s%x1f%b%x1e",
    revision,
  ]);
  const record = splitRecords(info)[0];
  if (!record) throw new Error("invalid git commit-info record");
  const [hash, short, author, author_email, date, message = "", ...bodyParts] = parseRecordFields(record, 5, "git commit-info");
  const body = bodyParts.join("\x1f");
  const filesOutput = runner(chainDir, ["show", "--name-status", "--format=", revision]);
  const files = parseNameStatus(filesOutput);
  return { hash, short, author, author_email, date, message, body, files };
}

function parseCount(output: string, label: string): number {
  const value = Number(output.trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid ${label}: ${JSON.stringify(output)}`);
  }
  return value;
}

/**
 * Compare two revisions via `git rev-list --count` ahead/behind. Revisions are
 * validated before being joined into a range; an unknown ref fails closed
 * rather than degrading to a fabricated zero count.
 */
export function readGitBranchComparison(
  chainDir: string,
  branch1 = "HEAD",
  branch2 = "main",
  runner: GitCommandRunner = runGit,
): GitBranchComparisonRecord {
  requireGitRepository(chainDir);
  const left = requireRevision(branch1, "branch1");
  const right = requireRevision(branch2, "branch2");
  const ahead = parseCount(runner(chainDir, ["rev-list", "--count", `${right}..${left}`]), "ahead count");
  const behind = parseCount(runner(chainDir, ["rev-list", "--count", `${left}..${right}`]), "behind count");
  return { branch1: left, branch2: right, ahead, behind };
}

/**
 * List stashed changes from `git stash list` with a record-separated format.
 * The branch field preserves git's raw body (%B); shell no longer builds JSON.
 */
export function readGitStashList(
  chainDir: string,
  runner: GitCommandRunner = runGit,
): GitStashRecord[] {
  requireGitRepository(chainDir);
  const output = runner(chainDir, [
    "stash",
    "list",
    "--format=%H%x1f%B%x1f%s%x1f%ci%x1e",
  ]);
  return splitRecords(output).map((record) => {
    const [stash, branch, message = "", ...dateParts] = parseRecordFields(record, 2, "git stash");
    return { stash, branch: branch.trim(), message, date: dateParts.join("\x1f").trim() };
  });
}

export function renderGitBranchesText(records: GitBranchRecord[]): string {
  return records
    .map((record) => {
      const marker = record.current ? "*" : " ";
      return `${marker} ${record.short}|${record.name}|${record.author}|${record.date}|${record.message}`;
    })
    .join("\n");
}

export function renderGitConflictsText(record: GitConflictRecord): string {
  return record.conflicts.join("\n");
}

export function renderGitCommitInfoText(record: GitCommitInfoRecord): string {
  const lines = [
    `commit ${record.hash}`,
    `Author: ${record.author} <${record.author_email}>`,
    `Date:   ${record.date}`,
    "",
    `    ${record.message}`,
  ];
  if (record.body) lines.push("", record.body);
  if (record.files.length > 0) {
    lines.push("");
    for (const file of record.files) lines.push(`${file.status}\t${file.file}`);
  }
  return lines.join("\n");
}

export function renderGitBranchComparisonText(record: GitBranchComparisonRecord): string {
  return [
    `${record.branch1} is ${record.ahead} commits ahead of ${record.branch2}`,
    `${record.branch1} is ${record.behind} commits behind ${record.branch2}`,
  ].join("\n");
}

export function renderGitStashText(records: GitStashRecord[]): string {
  return records.map((record) => `${record.stash}|${record.message}|${record.date}`).join("\n");
}
