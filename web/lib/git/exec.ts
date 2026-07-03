import { execFileSync } from "child_process";

// Shared git execution layer for every API route under app/api/**/git.
//
// Both git surfaces (the editor's POST /api/git action handler and the
// per-chain /api/chains/[id]/git/* routes) import from here so that "no route
// shells out to git" is a single grep invariant (`execSync` must not appear in
// app/api/**/git). argv form means caller-supplied branch names, refs, paths,
// and commit messages can never be interpreted as a command.

export interface GitExecOptions {
  timeout?: number;
}

/**
 * Run git with argv args. Throws on non-zero exit — callers that need to
 * detect failure (e.g. `git diff --cached --quiet` to check for staged
 * changes) wrap this in try/catch. stdout is trimmed.
 */
export function runGit(cwd: string, args: string[], opts: GitExecOptions = {}): string {
  return execFileSync("git", args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
    timeout: opts.timeout ?? 30000,
  }).trim();
}

/**
 * Read-only git: swallows non-zero exits and returns "". For status/log/list
 * probes where a missing ref, unborn branch, or absent upstream should degrade
 * to empty instead of throwing.
 */
export function runGitOptional(cwd: string, args: string[], opts: GitExecOptions = {}): string {
  try {
    return runGit(cwd, args, opts);
  } catch {
    return "";
  }
}
