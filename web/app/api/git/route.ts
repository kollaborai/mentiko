import { checkAuth } from "@/lib/auth/api-auth";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { resolveAndValidate, getAllowedRoots } from "@/lib/system/path-validation";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized, Forbidden } from "@/lib/api-errors";
import { runGit, runGitOptional } from "@/lib/git/exec";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// ── types ──────────────────────────────────────────────────────────────────

export interface GitFileStatus {
  path: string;
  name: string;
  staged: boolean;       // has staged changes
  unstaged: boolean;     // has unstaged changes
  untracked: boolean;    // new file not yet added
  statusCode: string;    // raw XY from git status --porcelain
}

export interface GitStatusResult {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
}

// Branch management types
export interface GitBranch {
  name: string;           // Branch name (e.g., "feature/new-ui" or "origin/main")
  isCurrent: boolean;     // true if this is the currently checked-out branch
  isRemote: boolean;     // true if this is a remote branch (contains /)
  tracking?: string;      // Remote branch this local branch tracks (e.g., "origin/main")
  lastCommit?: string;    // Short hash of last commit (optional, for UI display)
  lastCommitDate?: string; // Human-readable date (e.g., "2 days ago")
}

export interface GitBranchListResult {
  branches: GitBranch[];   // All local and remote branches
  current: string;         // Name of currently checked-out branch
  defaultBranch?: string;  // Repository's default branch (main/master)
}

export interface GitBranchCreateResult {
  ok: boolean;            // true if branch was created successfully
  branch?: string;        // Name of the created branch
  error?: string;         // Error message if creation failed
  current?: string;       // Current branch after creation (unchanged)
}

export interface GitBranchSwitchResult {
  ok: boolean;            // true if switch succeeded
  current?: string;       // New current branch name
  previous?: string;      // Previous branch name (for undo)
  error?: string;         // Error message if switch failed
  hasUncommittedChanges?: boolean; // Warning flag if switch had uncommitted changes
}

export interface GitBranchDeleteResult {
  ok: boolean;            // true if branch was deleted
  deleted?: string;       // Name of deleted branch
  error?: string;         // Error message if deletion failed
  forceUsed?: boolean;    // true if -D (force delete) was used
}

export interface GitBranchCurrentResult {
  ok: boolean;
  current?: string;
  error?: string;
}

// Stash management types
export interface GitStash {
  id: string;              // "0", "1", etc. or full "stash@{0}"
  branch: string;          // Branch where stash was created (e.g., "main")
  message: string;         // User-provided message or "WIP on branch: hash" default
  date: string;            // ISO timestamp or relative (e.g., "2 days ago")
  commitHash?: string;     // Abbreviated SHA of stashed commit
}

export interface GitStashListResult {
  ok: boolean;             // Success flag
  stashes: GitStash[];     // All stashes, newest first
  error?: string;          // Error if retrieval failed
}

export interface GitStashCreateResult {
  ok: boolean;             // true if stash created
  stashId?: string;        // Identifier of created stash (e.g., "stash@{0}")
  message?: string;        // Actual message used (user-provided or default)
  error?: string;          // Error if creation failed
}

export interface GitStashApplyResult {
  ok: boolean;             // true if apply succeeded without conflicts
  appliedStashId?: string; // Which stash was applied
  conflicts?: string[];    // File paths with merge conflicts (if any)
  conflictCount?: number;  // Count of conflicted files
  hasUnmergedPaths?: boolean; // true if conflicts remain after apply
  error?: string;          // Error message (conflict or other issue)
  status?: GitStatusResult; // Updated working directory status
}

export interface GitStashDropResult {
  ok: boolean;             // true if drop succeeded
  droppedId?: string;      // Stash that was dropped
  error?: string;          // Error if drop failed
}

export interface GitStashShowResult {
  ok: boolean;             // true if show succeeded
  diff: string;            // Unified diff format (may be empty)
  stashId?: string;        // Which stash was shown
  error?: string;          // Error if show failed
}

// ── helpers ────────────────────────────────────────────────────────────────
// Thin local aliases over @/lib/git/exec. This file historically used
// exec(args, cwd) / runArgs(args, cwd) with an args-first signature; the
// aliases preserve that so the call sites below stay unchanged while every
// actual git spawn goes through the single argv execution layer shared by all
// git routes. No `execSync` / shell strings live here.
const exec = (args: string[], cwd: string): string => runGit(cwd, args);
const runArgs = (args: string[], cwd: string): string => runGitOptional(cwd, args);

function parseStatus(cwd: string): GitStatusResult {
  // get branch info
  const branchLine = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const branch = branchLine || "HEAD";

  // upstream tracking
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  try {
    const remote = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
    if (remote) upstream = remote;
    const counts = runGitOptional(cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if (counts) {
      const [a, b] = counts.split("\t").map(Number);
      ahead = a || 0;
      behind = b || 0;
    }
  } catch {}

  // porcelain v1 status
  const raw = runGitOptional(cwd, ["status", "--porcelain", "-u"]);
  const files: GitFileStatus[] = [];

  for (const line of raw.split("\n").filter(Boolean)) {
    const xy = line.slice(0, 2);
    const x = xy[0]; // index (staged)
    const y = xy[1]; // worktree (unstaged)
    const rawPath = line.slice(3);
    // handle renames: "old -> new"
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ")[1] : rawPath;
    const name = path.split("/").pop() ?? path;

    files.push({
      path,
      name,
      staged: x !== " " && x !== "?",
      unstaged: y !== " " && y !== "?",
      untracked: x === "?" && y === "?",
      statusCode: xy,
    });
  }

  return { branch, upstream, ahead, behind, files };
}

function parseLog(cwd: string, limit = 20): GitLogEntry[] {
  const sep = "||GITSEP||";
  const fmt = `%H${sep}%h${sep}%s${sep}%an${sep}%ar${sep}%D`;
  const raw = runGitOptional(cwd, ["log", `--format=${fmt}`, "-n", String(limit)]);
  if (!raw) return [];

  return raw.split("\n").filter(Boolean).map((line) => {
    const parts = line.split(sep);
    return {
      hash: parts[0] ?? "",
      shortHash: parts[1] ?? "",
      message: parts[2] ?? "",
      author: parts[3] ?? "",
      date: parts[4] ?? "",
      refs: parts[5] ?? "",
    };
  });
}

// ── branch helpers ────────────────────────────────────────────────────────

/**
 * Validate Git branch name according to git-check-ref-format rules
 * - Must not start or end with dot
 * - Must not contain consecutive dots
 * - Must not contain ~ ^ : ? * [ \
 * - Must not contain @{
 * - Must not be a single @
 * - Must not end with .lock
 * - Max length: 255 characters
 */
function validateBranchName(branchName: string): { valid: boolean; error?: string } {
  if (!branchName || branchName.trim().length === 0) {
    return { valid: false, error: "Branch name cannot be empty" };
  }

  if (branchName.length > 255) {
    return { valid: false, error: "Branch name must be 255 characters or less" };
  }

  // Git ref format validation (from git-check-ref-format)
  const invalidChars = /[~^:?*\[\\@{}]/;
  if (invalidChars.test(branchName)) {
    return { valid: false, error: `Branch name contains invalid characters: ~ ^ : ? * [ \\ @ { }` };
  }

  // Cannot start or end with dot
  if (branchName.startsWith(".") || branchName.endsWith(".")) {
    return { valid: false, error: "Branch name cannot start or end with a dot" };
  }

  // Cannot have consecutive dots
  if (branchName.includes("..")) {
    return { valid: false, error: "Branch name cannot contain consecutive dots" };
  }

  // Cannot be single @
  if (branchName === "@") {
    return { valid: false, error: "Branch name cannot be a single @" };
  }

  // Cannot contain @{ (prevents reflog access)
  if (branchName.includes("@{")) {
    return { valid: false, error: "Branch name cannot contain '@{" };
  }

  // Cannot end with .lock
  if (branchName.endsWith(".lock")) {
    return { valid: false, error: "Branch name cannot end with .lock" };
  }

  // Cannot contain slash at start or end (prevents absolute paths)
  if (branchName.startsWith("/") || branchName.endsWith("/")) {
    return { valid: false, error: "Branch name cannot start or end with slash" };
  }

  return { valid: true };
}

/**
 * Get current branch name
 */
function getCurrentBranch(cwd: string): string {
  return runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";
}

/**
 * List all local and remote branches
 */
function parseBranchList(cwd: string): GitBranchListResult {
  // Get current branch
  const current = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";

  // Get default branch
  const defaultRef = runGitOptional(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  const defaultBranch = defaultRef ? defaultRef.replace(/^refs\/remotes\/origin\//, "") : undefined;

  const branches: GitBranch[] = [];

  // Get local branches with tracking info
  const localRaw = runGitOptional(cwd, ["branch", "--format=%(refname:short)|%(HEAD)|%(upstream:short)|%(objectname:short)|%(committerdate:relative)"]);
  for (const line of localRaw.split("\n").filter(Boolean)) {
    const parts = line.split("|");
    if (parts.length < 5) continue;
    const [name, headMarker, tracking, shortHash, date] = parts;
    branches.push({
      name,
      isCurrent: headMarker === "*",
      isRemote: false,
      tracking: tracking || undefined,
      lastCommit: shortHash,
      lastCommitDate: date,
    });
  }

  // Get remote branches
  const remoteRaw = runGitOptional(cwd, ["branch", "--remote", "--format=%(refname:short)|%(HEAD)|%(objectname:short)|%(committerdate:relative)"]);
  for (const line of remoteRaw.split("\n").filter(Boolean)) {
    const parts = line.split("|");
    if (parts.length < 4) continue;
    const [name, headMarker, shortHash, date] = parts;
    branches.push({
      name,
      isCurrent: false, // Remote branches are never "current" in the working tree
      isRemote: true,
      lastCommit: shortHash,
      lastCommitDate: date,
    });
  }

  return { branches, current, defaultBranch };
}

/**
 * Create a new branch from current HEAD
 */
function createBranch(cwd: string, branchName: string): GitBranchCreateResult {
  try {
    exec(["branch", branchName], cwd);
    const current = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return {
      ok: true,
      branch: branchName,
      current: current || "HEAD",
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e),
    };
  }
}

/**
 * Switch to a different branch
 */
function switchBranch(cwd: string, targetBranch: string): GitBranchSwitchResult {
  const previous = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";

  try {
    // Try safe switch first (fails if uncommitted changes)
    exec(["switch", targetBranch], cwd);
    const current = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return {
      ok: true,
      current: current || targetBranch,
      previous,
      hasUncommittedChanges: false,
    };
  } catch (e) {
    const error = String(e);

    // If error is about uncommitted changes, retry with --merge, which carries
    // the uncommitted changes over into the target branch (NOT a stash).
    if (error.includes("uncommitted") || error.includes("working tree") || error.includes("changes")) {
      try {
        exec(["switch", "-m", targetBranch], cwd);
        const current = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
        return {
          ok: true,
          current: current || targetBranch,
          previous,
          hasUncommittedChanges: true,
        };
      } catch (e2) {
        return {
          ok: false,
          error: String(e2),
          previous,
        };
      }
    }

    return {
      ok: false,
      error: String(e),
      previous,
    };
  }
}

/**
 * Delete a branch (local or remote)
 */
function deleteBranch(cwd: string, branchName: string, force: boolean = false): GitBranchDeleteResult {
  const current = runGitOptional(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD";

  // Cannot delete current branch
  if (branchName === current) {
    return {
      ok: false,
      error: "Cannot delete the currently checked-out branch. Switch to another branch first.",
    };
  }

  // A branch is only remote if its first path segment names an actual remote —
  // local branches (feature/x, fix/y) contain slashes too, and must never be
  // turned into a `git push <remote> --delete` call.
  const remotes = runArgs(["remote"], cwd).split("\n").filter(Boolean);
  const remote = remotes.find((r) => branchName.startsWith(`${r}/`));

  try {
    if (remote) {
      // Delete remote branch
      const remoteBranch = branchName.substring(remote.length + 1);
      exec(["push", remote, "--delete", remoteBranch], cwd);
      return {
        ok: true,
        deleted: branchName,
        forceUsed: false,
      };
    } else {
      // Delete local branch
      const args = force ? ["branch", "-D", branchName] : ["branch", "-d", branchName];
      exec(args, cwd);
      return {
        ok: true,
        deleted: branchName,
        forceUsed: force,
      };
    }
  } catch (e) {
    const error = String(e);

    // If safe delete failed, suggest force delete
    if (!force && error.includes("not fully merged")) {
      return {
        ok: false,
        error: `Branch has unmerged commits. Use force delete to remove it anyway.`,
      };
    }

    return {
      ok: false,
      error: String(e),
    };
  }
}

// ── stash helpers ─────────────────────────────────────────────────────────

/**
 * Helper: format stash ID into git reference
 */
function formatStashRef(id: string): string {
  if (id.startsWith("stash@{")) {
    return id; // Already formatted
  }
  return `stash@{${id}}`;
}

/**
 * Helper: extract branch name from stash message
 */
function extractBranchFromMessage(message: string): string {
  // "WIP on main: a1b2c3d message" → "main"
  const match = message.match(/on (.+?):/);
  return match ? match[1] : "unknown";
}

/**
 * Parse stash list output into structured stashes
 */
function parseStashList(cwd: string): GitStash[] {
  const sep = "||STASHSEP||";
  // `git stash list` runs `git log` over the stash reflog, so the format MUST
  // use git-log placeholders — NOT for-each-ref %(refname:short) / %(subject) /
  // %(objectname:short) / %(creatordate:relative), which git-log prints
  // literally (the whole stash list came back as one garbage entry, so
  // list_stashes / resolveStashRef-by-SHA silently never matched anything).
  //   %gd = reflog selector ("stash@{0}")  %s = subject  %cr = relative date
  //   %h  = abbreviated commit hash (the stable SHA resolveStashRef keys on)
  const fmt = `%gd${sep}%s${sep}%cr${sep}%h`;
  const raw = runGitOptional(cwd, ["stash", "list", `--format=${fmt}`]);

  if (!raw) return [];

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(sep);
      const fullId = parts[0] ?? "stash@{0}";
      const id = fullId.replace(/^stash@\{|\}$/g, ""); // "0" from "stash@{0}"

      return {
        id,
        branch: extractBranchFromMessage(parts[1] ?? ""),
        message: parts[1] ?? "",
        date: parts[2] ?? "",
        commitHash: parts[3],
      };
    });
}

/**
 * Create a new stash from working directory changes
 */
function createStash(cwd: string, message?: string, includeUntracked?: boolean): GitStashCreateResult {
  try {
    const args = ["stash", "push"];
    if (includeUntracked) {
      args.push("-u");
    }
    if (message?.trim()) {
      args.push("-m", message);
    }
    exec(args, cwd);

    // After push, list to get the new stash ID
    const stashes = parseStashList(cwd);
    if (stashes.length > 0) {
      return {
        ok: true,
        stashId: `stash@{${stashes[0].id}}`,
        message: message?.trim() || stashes[0].message,
      };
    }
    return { ok: true, message: message?.trim() };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Resolve a stash reference for a mutating operation. Prefers the stable commit
 * SHA (positional indices shift whenever stashes are created or dropped, so an
 * index captured by the UI can point at the wrong stash by the time the user
 * clicks). Falls back to the positional id when no SHA is provided. Returns
 * null when a SHA is provided but no longer matches any stash — callers must
 * NOT fall back to an index in that case.
 */
function resolveStashRef(cwd: string, stashId?: string, stashCommit?: string): string | null {
  if (stashCommit) {
    const hit = parseStashList(cwd).find(
      (s) => s.commitHash && stashCommit.startsWith(s.commitHash)
    );
    return hit ? formatStashRef(hit.id) : null;
  }
  if (stashId) return formatStashRef(stashId);
  return null;
}

/**
 * Apply a stash (without removing)
 */
function applyStash(cwd: string, ref: string): GitStashApplyResult {
  try {
    exec(["stash", "apply", ref], cwd);

    const status = parseStatus(cwd);
    return {
      ok: true,
      appliedStashId: ref,
      status,
    };
  } catch (e) {
    const error = String(e);

    // Detect merge conflicts in error output
    if (error.includes("CONFLICT") || error.includes("conflicting")) {
      const status = parseStatus(cwd);
      const conflicts = status.files
        .filter((f) => f.statusCode.includes("U"))
        .map((f) => f.path);

      return {
        ok: false,
        appliedStashId: ref,
        conflicts,
        conflictCount: conflicts.length,
        hasUnmergedPaths: conflicts.length > 0,
        error: "Merge conflicts during stash apply. Resolve conflicts and commit.",
        status,
      };
    }

    return { ok: false, error, appliedStashId: ref };
  }
}

/**
 * Drop a stash permanently
 */
function dropStash(cwd: string, ref: string): GitStashDropResult {
  try {
    exec(["stash", "drop", ref], cwd);
    return {
      ok: true,
      droppedId: ref,
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e),
      droppedId: ref,
    };
  }
}

/**
 * Show stash diff
 */
function showStash(cwd: string, stashId: string): GitStashShowResult {
  try {
    const ref = formatStashRef(stashId);
    const diff = runArgs(["stash", "show", "-p", ref], cwd);
    return {
      ok: true,
      diff,
      stashId,
    };
  } catch (e) {
    return {
      ok: false,
      diff: "",
      error: String(e),
      stashId,
    };
  }
}

// ── handler ────────────────────────────────────────────────────────────────

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) throw new Unauthorized();

  const body = await request.json() as {
    action: string;
    workspacePath: string;
    paths?: string[];
    message?: string;
    path?: string;
    staged?: boolean;
    branchName?: string;
    force?: boolean;
    stashId?: string;
    stashCommit?: string;
    stashMessage?: string;
    includeUntracked?: boolean;
    commitHash?: string;
  };

  const { action, workspacePath } = body;
  if (!workspacePath) {
    return apiSuccess({ error: "workspacePath required" }, undefined, 400);
  }

  // mutating git actions are member+ (block guests); reads stay auth-only
  const GIT_WRITE_ACTIONS = new Set([
    "stage", "unstage", "stage_all", "unstage_all", "commit", "push",
    "create_branch", "switch_branch", "delete_branch",
    "create_stash", "apply_stash", "drop_stash",
  ]);
  if (GIT_WRITE_ACTIONS.has(action)) {
    const permError = await requirePermission(request, "manage_chains");
    if (permError) return permError;
  }

  // workspacePath becomes the cwd for every git command below — constrain it
  // to a root the caller is allowed to touch, or any authed user could run git
  // against arbitrary host repositories.
  const allowedRoots = await getAllowedRoots(request);
  const validatedWorkspace = resolveAndValidate(workspacePath, allowedRoots);
  if (!validatedWorkspace) {
    throw new Forbidden("workspacePath is outside the allowed roots");
  }

  // resolve git root from the validated workspace, then re-validate it —
  // `show-toplevel` can walk up out of a workspace subdirectory.
  const gitRoot = runGitOptional(validatedWorkspace, ["rev-parse", "--show-toplevel"]) || validatedWorkspace;
  if (!resolveAndValidate(gitRoot, allowedRoots)) {
    throw new Forbidden("git root is outside the allowed roots");
  }

  switch (action) {
    case "status":
      return apiSuccess(parseStatus(gitRoot));

    case "log":
      return apiSuccess({ entries: parseLog(gitRoot) });

    case "stage": {
      const paths = body.paths ?? [];
      if (!paths.length) return apiSuccess({ ok: false, error: "no paths" });
      try {
        exec(["add", "--", ...paths], gitRoot);
      } catch (e) {
        return apiSuccess({ ok: false, error: String(e) });
      }
      return apiSuccess({ ok: true, status: parseStatus(gitRoot) });
    }

    case "unstage": {
      const paths = body.paths ?? [];
      if (!paths.length) return apiSuccess({ ok: false, error: "no paths" });
      try {
        exec(["restore", "--staged", "--", ...paths], gitRoot);
      } catch (e) {
        return apiSuccess({ ok: false, error: String(e) });
      }
      return apiSuccess({ ok: true, status: parseStatus(gitRoot) });
    }

    case "stage_all":
      try {
        exec(["add", "-A"], gitRoot);
      } catch (e) {
        return apiSuccess({ ok: false, error: String(e) });
      }
      return apiSuccess({ ok: true, status: parseStatus(gitRoot) });

    case "unstage_all":
      try {
        exec(["restore", "--staged", "."], gitRoot);
      } catch (e) {
        return apiSuccess({ ok: false, error: String(e) });
      }
      return apiSuccess({ ok: true, status: parseStatus(gitRoot) });

    case "commit": {
      const message = body.message?.trim();
      if (!message) return apiSuccess({ ok: false, error: "commit message required" });
      try {
        const out = exec(["commit", "-m", message], gitRoot);
        return apiSuccess({ ok: true, output: out, status: parseStatus(gitRoot) });
      } catch (e) {
        return apiSuccess({ ok: false, error: String(e), status: parseStatus(gitRoot) });
      }
    }

    case "push": {
      try {
        const out = exec(["push"], gitRoot);
        return apiSuccess({ ok: true, output: out, status: parseStatus(gitRoot) });
      } catch (e) {
        return apiSuccess({ ok: false, error: String(e), status: parseStatus(gitRoot) });
      }
    }

    case "show": {
      // get file content at HEAD (for diff original side)
      const showPath = body.path;
      if (!showPath) return apiSuccess({ content: "", error: "path required" });
      try {
        const content = exec(["show", `HEAD:${showPath}`], gitRoot);
        return apiSuccess({ content });
      } catch {
        // file doesn't exist at HEAD (new file)
        return apiSuccess({ content: "" });
      }
    }

    case "show_commit": {
      // full patch for a single commit — opened as a diff tab from the log view.
      // hash is validated hex so it can never be read as a git option or path.
      const commitHash = body.commitHash;
      if (!commitHash || !/^[0-9a-f]{4,40}$/i.test(commitHash)) {
        return apiSuccess({ content: "", error: "valid commitHash required" });
      }
      try {
        const content = exec(["show", "--no-color", commitHash], gitRoot);
        return apiSuccess({ content });
      } catch (e) {
        return apiSuccess({ content: "", error: String(e) });
      }
    }

    case "diff": {
      // get unified diff for a file
      const diffPath = body.path;
      if (!diffPath) return apiSuccess({ diff: "", error: "path required" });
      try {
        // staged diff: git diff --cached -- path
        // unstaged diff: git diff -- path
        const args = body.staged
          ? ["diff", "--cached", "--", diffPath]
          : ["diff", "--", diffPath];
        const diff = runArgs(args, gitRoot);
        return apiSuccess({ diff });
      } catch {
        return apiSuccess({ diff: "" });
      }
    }

    // ── branch actions ─────────────────────────────────────────────────────

    case "list_branches": {
      return apiSuccess(parseBranchList(gitRoot));
    }

    case "current_branch": {
      const current = getCurrentBranch(gitRoot);
      return apiSuccess({ ok: true, current });
    }

    case "create_branch": {
      const branchName = body.branchName?.trim();
      if (!branchName) {
        return apiSuccess({ ok: false, error: "branchName is required" }, undefined, 400);
      }

      const validation = validateBranchName(branchName);
      if (!validation.valid) {
        return apiSuccess({ ok: false, error: validation.error }, undefined, 400);
      }

      return apiSuccess(createBranch(gitRoot, branchName));
    }

    case "switch_branch": {
      const branchName = body.branchName?.trim();
      if (!branchName) {
        return apiSuccess({ ok: false, error: "branchName is required" }, undefined, 400);
      }

      const validation = validateBranchName(branchName);
      if (!validation.valid) {
        return apiSuccess({ ok: false, error: validation.error }, undefined, 400);
      }

      return apiSuccess(switchBranch(gitRoot, branchName));
    }

    case "delete_branch": {
      const branchName = body.branchName?.trim();
      if (!branchName) {
        return apiSuccess({ ok: false, error: "branchName is required" }, undefined, 400);
      }

      const validation = validateBranchName(branchName);
      if (!validation.valid) {
        return apiSuccess({ ok: false, error: validation.error }, undefined, 400);
      }

      const force = body.force || false;
      return apiSuccess(deleteBranch(gitRoot, branchName, force));
    }

    // ── stash actions ──────────────────────────────────────────────────────

    case "list_stashes": {
      const stashes = parseStashList(gitRoot);
      return apiSuccess({ ok: true, stashes });
    }

    case "create_stash": {
      const message = body.stashMessage?.trim();
      const includeUntracked = body.includeUntracked as boolean | undefined;
      return apiSuccess(createStash(gitRoot, message, includeUntracked));
    }

    case "apply_stash": {
      const stashId = body.stashId?.trim();
      const stashCommit = body.stashCommit?.trim();
      if (!stashId && !stashCommit) {
        return apiSuccess({ ok: false, error: "stashId or stashCommit required" }, undefined, 400);
      }
      const ref = resolveStashRef(gitRoot, stashId, stashCommit);
      if (!ref) {
        return apiSuccess({ ok: false, error: "stash not found — it may have been applied or dropped already" });
      }
      return apiSuccess(applyStash(gitRoot, ref));
    }

    case "drop_stash": {
      const stashId = body.stashId?.trim();
      const stashCommit = body.stashCommit?.trim();
      if (!stashId && !stashCommit) {
        return apiSuccess({ ok: false, error: "stashId or stashCommit required" }, undefined, 400);
      }
      const ref = resolveStashRef(gitRoot, stashId, stashCommit);
      if (!ref) {
        return apiSuccess({ ok: false, error: "stash not found — it may have been applied or dropped already" });
      }
      return apiSuccess(dropStash(gitRoot, ref));
    }

    case "show_stash": {
      const stashId = body.stashId?.trim();
      if (!stashId) {
        return apiSuccess({ ok: false, error: "stashId required" }, undefined, 400);
      }
      return apiSuccess(showStash(gitRoot, stashId));
    }

    default:
      return apiSuccess({ error: `unknown action: ${action}` }, undefined, 400);
  }
});
