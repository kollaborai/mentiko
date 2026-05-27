/**
 * session-log-resolver.ts - resolve session log paths for any CLI provider
 *
 * Uses provider-bundles.ts as source of truth for default log paths.
 * AgentProfile.log_path overrides the default.
 */

import path from "path";
import { homedir } from "os";
import { getBundleByProvider } from "./provider-bundles";
import type { AgentProfileProvider } from "./types";

/** Encode a working directory into a CLI-specific slug */
export function encodeCwdSlug(cli: string, cwd: string): string {
  switch (cli) {
    case "claude":
    case "claude-code":
    case "kollab":
      // claude code replaces both / and . with - to form the project slug
      return cwd.replace(/[\/.]/g, "-");
    case "codex":
      return "";
    default:
      return cwd.replace(/[\/.]/g, "-");
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
    const providerMap: Record<string, AgentProfileProvider> = {
      claude: "claude-code",
      "claude-code": "claude-code",
      codex: "codex",
      opencode: "opencode",
      kollab: "kollab",
      gemini: "gemini",
    };
    const providerId = providerMap[provider] || (provider as AgentProfileProvider);
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
