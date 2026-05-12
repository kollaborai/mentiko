import { execSync, execFileSync } from "child_process";
import { checkAuth } from "@/lib/api-auth";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";
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

// ── helpers ────────────────────────────────────────────────────────────────

// read-only: swallows errors, returns "" on failure
function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

// mutation: throws on non-zero exit (caller must catch)
function exec(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 10000 }).trim();
}

function parseStatus(cwd: string): GitStatusResult {
  // get branch info
  const branchLine = run("git rev-parse --abbrev-ref HEAD", cwd);
  const branch = branchLine || "HEAD";

  // upstream tracking
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  try {
    const remote = run("git rev-parse --abbrev-ref @{upstream}", cwd);
    if (remote) upstream = remote;
    const counts = run("git rev-list --left-right --count HEAD...@{upstream}", cwd);
    if (counts) {
      const [a, b] = counts.split("\t").map(Number);
      ahead = a || 0;
      behind = b || 0;
    }
  } catch {}

  // porcelain v1 status
  const raw = run("git status --porcelain -u", cwd);
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
  const raw = run(`git log --format="${fmt}" -n ${limit}`, cwd);
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
  };

  const { action, workspacePath } = body;
  if (!workspacePath) {
    return apiSuccess({ error: "workspacePath required" }, undefined, 400);
  }

  // resolve git root from workspacePath
  const gitRoot = run("git rev-parse --show-toplevel", workspacePath) || workspacePath;

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
        const diff = run(`git ${args.join(" ")}`, gitRoot);
        return apiSuccess({ diff });
      } catch {
        return apiSuccess({ diff: "" });
      }
    }

    default:
      return apiSuccess({ error: `unknown action: ${action}` }, undefined, 400);
  }
});
