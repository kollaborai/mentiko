/**
 * session-log-resolver.ts - resolve session log paths for any CLI provider
 *
 * Uses provider-bundles.ts as source of truth for default log paths.
 * AgentProfile.log_path overrides the default.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import path from "path";
import { homedir } from "os";
import { getBundleProviderForTool } from "../agents/agent-provider-catalog";
import { getBundleByProvider } from "../agents/provider-bundles";
import type { AgentProfileProvider } from "../types";

/** Encode a working directory into a CLI-specific slug */
export function encodeCwdSlug(cli: string, cwd: string): string {
  if (cli.startsWith("kollab")) {
    return cwd.replace(/^\//, "").replace(/\//g, "_");
  }
  switch (cli) {
    case "claude":
    case "claude-code":
      // claude code replaces both / and . with - to form the project slug
      return cwd.replace(/[\/.]/g, "-");
    case "codex":
      return "";
    default:
      return cwd.replace(/[\/.]/g, "-");
  }
}

const TRANSCRIPT_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CONVERSATION_WINDOW_SECONDS = 30;

/**
 * Resolve a transcript directory from a validated profile. Profiles without an
 * explicit log_path intentionally degrade capture rather than guessing a
 * provider directory.
 */
export function resolveProfileLogDir(profile: { cli: string; log_path?: string }, cwd: string): string {
  if (!profile.log_path?.trim()) return "";
  return resolveLogDir(profile.cli, cwd, profile.log_path);
}

/** Map a PTY capture UUID onto the configured transcript root. */
export function resolveSessionLog(logDir: string, session: string, ptyBinary: string): string {
  if (!isDirectory(logDir) || !session || !ptyBinary) return "";
  const capture = spawnSync(ptyBinary, ["capture", session, "100"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  const uuid = (capture.stdout ?? "").match(TRANSCRIPT_UUID)?.[0];
  if (!uuid) return "";
  const candidate = path.join(logDir, `${uuid}.jsonl`);
  return isRegularFile(candidate) ? candidate : "";
}

/**
 * Find transcript JSONL files created in the historical +/- 30 second window.
 * When no file falls in that window, return the newest regular JSONL just as
 * the prior shell contract did. No provider root is guessed here.
 */
export function findConversationFiles(logDir: string, startedAtEpoch: number, cli = "claude"): string[] {
  if (!isDirectory(logDir) || !Number.isFinite(startedAtEpoch) || startedAtEpoch <= 0) return [];
  const dateRoot = cli === "codex" ? codexDateRoot(logDir, startedAtEpoch) : logDir;
  const searchRoot = isDirectory(dateRoot) ? dateRoot : logDir;
  const files = listJsonlFiles(searchRoot, 2);
  const matched = files.filter((file) => {
    const birth = fileBirthEpoch(file);
    return birth >= startedAtEpoch - CONVERSATION_WINDOW_SECONDS
      && birth <= startedAtEpoch + CONVERSATION_WINDOW_SECONDS;
  });
  if (matched.length) return matched;
  const newest = files
    .map((file) => ({ file, birth: fileBirthEpoch(file) }))
    .sort((left, right) => right.birth - left.birth || left.file.localeCompare(right.file))[0];
  return newest ? [newest.file] : [];
}

/** List transcript JSONL files under a provider's configured log root. */
export function listConversationFiles(logDir: string, cli = "claude"): string[] {
  if (!isDirectory(logDir)) return [];
  return listJsonlFiles(logDir, cli === "codex" ? 4 : 2);
}

export function fileBirthEpoch(file: string): number {
  try {
    const stat = statSync(file);
    const birth = Math.floor(stat.birthtimeMs / 1000);
    if (Number.isFinite(birth) && birth > 0) return birth;
    const modified = Math.floor(stat.mtimeMs / 1000);
    return Number.isFinite(modified) && modified > 0 ? modified : 0;
  } catch {
    return 0;
  }
}

function codexDateRoot(logDir: string, epoch: number): string {
  const date = new Date(epoch * 1000);
  const part = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join(path.sep);
  return path.join(logDir, part);
}

function listJsonlFiles(root: string, depth: number): string[] {
  if (depth < 0 || !isDirectory(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      const candidate = path.join(root, entry.name);
      if (entry.isDirectory()) return depth > 1 ? listJsonlFiles(candidate, depth - 1) : [];
      return entry.isFile() && entry.name.endsWith(".jsonl") && isRegularFile(candidate) ? [candidate] : [];
    });
  } catch {
    return [];
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return existsSync(candidate) && lstatSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isRegularFile(candidate: string): boolean {
  try {
    return lstatSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the directory containing session log files.
 *
 * @param provider - AgentProfileProvider or CLI command name
 * @param cwd - working directory (for slug encoding)
 * @param logPathOverride - optional override from AgentProfile.log_path
 * @returns absolute path to log directory
 */
export function resolveLogDir(
  provider: AgentProfileProvider | string,
  cwd: string,
  logPathOverride?: string,
): string {
  let logPath = logPathOverride || "";

  if (!logPath) {
    const providerId = getBundleProviderForTool(provider) || (provider as AgentProfileProvider);
    const bundle = getBundleByProvider(providerId);
    logPath = bundle?.log_path || "";
  }

  if (!logPath) return "";

  if (logPath.startsWith("~")) {
    logPath = path.join(homedir(), logPath.slice(1));
  }

  logPath = logPath.replace(/\/+$/, "");

  const slug = encodeCwdSlug(provider, cwd);
  return slug ? path.join(logPath, slug) : logPath;
}

/**
 * Backward-compatible wrapper: resolve claude project path from cwd.
 * Drop-in replacement for the function previously in config.ts.
 */
export function claudeProjectPath(cwd: string): string {
  return resolveLogDir("claude-code", cwd, process.env.CLAUDE_PROJECTS_DIR);
}

/**
 * Convenience: resolve log dir from an AgentProfile-shaped object.
 */
export function resolveLogDirFromProfile(
  profile: { cli: string; log_path?: string },
  cwd: string,
): string {
  return resolveLogDir(profile.cli, cwd, profile.log_path);
}
