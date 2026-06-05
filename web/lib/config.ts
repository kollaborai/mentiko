/**
 * mentiko web configuration
 *
 * ONE source of truth for all paths. 3-tier hierarchy:
 *   global > namespace > org > project
 *
 * code root (git checkout) is separate from data root (~/.mentiko).
 *
 * NEVER resolve paths outside this file. import config and use it.
 */

import path from "path";
import { homedir } from "os";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

function slugPart(value: string): string {
  const slug = value
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "root";
}

export function derivePtyDaemonName(root: string, namespace: string, org: string): string {
  return [
    "mentiko",
    slugPart(root),
    slugPart(namespace || "default"),
    slugPart(org || "default"),
  ].join("-");
}

/**
 * Encode a directory path into a filesystem-safe ID.
 * $MENTIKO_CODE_ROOT -> -workspace-mentiko
 * Same convention as Claude Code's project directories.
 */
export function encodeProjectPath(dir: string): string {
  return dir.replace(/\//g, "-");
}

// ---------------------------------------------------------------------------
// root resolution
// ---------------------------------------------------------------------------

// Global root: where all mentiko data lives.
// Override: MENTIKO_GLOBAL_ROOT (production / docker).
// Fallback: MENTIKO_ROOT (legacy compat) -> ~/.mentiko
const globalRoot = expandTilde(
  process.env.MENTIKO_GLOBAL_ROOT
    || process.env.MENTIKO_ROOT
    || path.join(homedir(), ".mentiko")
);

// Code root: the git checkout where bin/, lib/, web/ live.
// Override: MENTIKO_CODE_ROOT (production / docker).
// Fallback: parent of process.cwd() (Next.js runs from web/).
const codeRoot =
  process.env.MENTIKO_CODE_ROOT
    || path.resolve(process.cwd(), "..");

// ---------------------------------------------------------------------------
// tier IDs
// ---------------------------------------------------------------------------

const namespaceId = process.env.NAMESPACE_ID || "default";
const orgId = process.env.ORG_ID || "default";
const ptyDaemonName = process.env.PTY_DAEMON || derivePtyDaemonName(globalRoot, namespaceId, orgId);
process.env.PTY_DAEMON = ptyDaemonName;

// Project directory: the actual codebase being worked on.
// For local dev, this is the code root itself.
// Override: MENTIKO_PROJECT_DIR (when spawning from a different context).
const projectDir = process.env.MENTIKO_PROJECT_DIR || codeRoot;
const projectId = encodeProjectPath(projectDir);

// ---------------------------------------------------------------------------
// tier roots
// ---------------------------------------------------------------------------

const namespaceRoot =
  process.env.MENTIKO_NAMESPACE_ROOT
    || path.join(globalRoot, "namespaces", namespaceId);

// Default org collapses into namespace root (backward compat for local dev / OSS).
// Non-default orgs get their own subdirectory under the namespace.
const orgRoot =
  process.env.MENTIKO_ORG_ROOT
    || (orgId === "default" ? namespaceRoot : path.join(namespaceRoot, "orgs", orgId));

// Default project (codeRoot == projectDir) collapses into org root.
// Non-default projects get their own subdirectory under the org.
const projectRoot =
  process.env.MENTIKO_PROJECT_ROOT
    || (projectDir === codeRoot ? orgRoot : path.join(orgRoot, "projects", projectId));

// External tool paths (not mentiko data, but tools we integrate with)
/** @deprecated use resolveLogDir from session-log-resolver.ts instead */
const claudeProjectsBase = process.env.CLAUDE_PROJECTS_DIR || path.join(homedir(), ".claude", "projects");
const ptyManagerDir = process.env.PTY_MANAGER_DIR || path.join(homedir(), ".pty-manager");
const demoWorkspaceDir = process.env.DEMO_WORKSPACE_DIR || path.join(globalRoot, "demo-workspace");

// ---------------------------------------------------------------------------
// path helpers (for dynamic namespace/org/project from request context)
// ---------------------------------------------------------------------------

/** Resolve a path under a specific namespace */
export function nsPath(nsId: string, ...segments: string[]): string {
  return path.join(globalRoot, "namespaces", nsId, ...segments);
}

/** Resolve a path under a specific org within a namespace.
 *  Default org collapses into namespace root (no /orgs/default/ segment). */
export function orgPath(nsId: string, oId: string, ...segments: string[]): string {
  if (oId === "default") {
    return path.join(globalRoot, "namespaces", nsId, ...segments);
  }
  return path.join(globalRoot, "namespaces", nsId, "orgs", oId, ...segments);
}

/** Resolve a path under the current project */
export function projectPath(...segments: string[]): string {
  return path.join(projectRoot, ...segments);
}

/** Resolve a path under the global root */
export function globalPath(...segments: string[]): string {
  return path.join(globalRoot, ...segments);
}

/** Resolve a path under the code root */
export function codePath(...segments: string[]): string {
  return path.join(codeRoot, ...segments);
}

export { claudeProjectPath } from "./runs/session-log-resolver";

// ---------------------------------------------------------------------------
// config object
// ---------------------------------------------------------------------------

export const config = {
  // --- roots ---
  globalRoot,
  codeRoot,
  namespaceRoot,
  orgRoot,
  projectRoot,

  // --- IDs ---
  namespaceId,
  orgId,
  projectId,
  projectDir,

  // backward compat: root was used for code paths (bin, lib, scripts)
  root: codeRoot,
  // backward compat: namespacesBase used by some API routes
  namespacesBase: path.join(globalRoot, "namespaces"),

  // --- tier 1: global ---
  authDbPath: path.join(globalRoot, "data", "auth.db"),

  // --- tier 2: namespace ---
  billingDir: path.join(namespaceRoot, "billing"),
  namespaceSettingsDir: path.join(namespaceRoot, "settings"),
  marketplaceDir: path.join(namespaceRoot, "marketplace"),

  // --- tier 3: org ---
  chainsDir: process.env.CHAIN_DIR || path.join(orgRoot, "chains"),
  linksDir: process.env.LINKS_DIR || path.join(orgRoot, "links"),
  agentsDir: process.env.AGENTS_DIR || path.join(orgRoot, "agents"),
  agentProfilesDir: process.env.AGENT_PROFILES_DIR || path.join(orgRoot, "agent-profiles"),
  configProfilesDir: process.env.CONFIG_PROFILES_DIR || path.join(orgRoot, "config-profiles"),
  templatesDir: process.env.TEMPLATES_DIR || path.join(orgRoot, "templates"),
  webhooksDir: process.env.WEBHOOKS_DIR || path.join(orgRoot, "webhooks"),
  emailsDir: process.env.EMAILS_DIR || path.join(orgRoot, "emails"),

  // --- tier 4: project ---
  runsDir: process.env.RUNS_DIR || path.join(projectRoot, "runs"),
  jobsDir: process.env.JOBS_DIR || path.join(projectRoot, "jobs"),
  eventsDir: process.env.EVENTS_DIR || path.join(projectRoot, "events"),
  stateDir: process.env.STATE_DIR || path.join(projectRoot, "state"),
  decisionsDir: process.env.DECISIONS_DIR || path.join(projectRoot, "decisions"),
  schedulesDir: process.env.SCHEDULES_DIR || path.join(projectRoot, "schedules"),
  metricsDir: process.env.METRICS_DIR || path.join(projectRoot, "metrics"),
  notificationsDir: process.env.NOTIFICATIONS_DIR || path.join(projectRoot, "notifications"),
  reportsDir: process.env.REPORTS_DIR || path.join(projectRoot, "reports"),
  debugDir: process.env.DEBUG_DIR || path.join(projectRoot, "debug"),
  workspaceDir: process.env.WORKSPACE_DIR || path.join(projectRoot, "workspace"),
  profilesDir: process.env.PROFILES_DIR || path.join(projectRoot, "profiles"),
  watchdogHooksDir: process.env.WATCHDOG_HOOKS_DIR || path.join(projectRoot, "watchdog-hooks"),

  // --- code root (not data, these are executables/scripts) ---
  binDir: process.env.BIN_DIR || path.join(codeRoot, "bin"),
  libDir: process.env.LIB_DIR || path.join(codeRoot, "lib"),

  // --- external tool paths (system-level, not data) ---
  ptyManagerDir,
  ptySocketPath: process.env.PTY_SOCKET_PATH || null,
  ptyTokenPath: process.env.PTY_TOKEN_PATH || null,
  ptyDaemonName,
  demoWorkspaceDir,
  claudeProjectsDir: claudeProjectsBase,
  infraSshPublicKey: process.env.MENTIKO_SSH_PUBLIC_KEY || null,
  infraSshPrivateKey: process.env.MENTIKO_SSH_PRIVATE_KEY || null,

  // --- operational ---
  cliBin: process.env.CLI_BIN || "claude",
  sessionPrefix: process.env.SESSION_PREFIX || "mentiko",
  defaultMaxRounds: parseInt(process.env.DEFAULT_MAX_ROUNDS || "50", 10),
  polling: {
    sessions: parseInt(process.env.POLLING_SESSIONS || "3000", 10),
    output: parseInt(process.env.POLLING_OUTPUT || "2000", 10),
    conversations: parseInt(process.env.POLLING_CONVERSATIONS || "5000", 10),
    messages: parseInt(process.env.POLLING_MESSAGES || "3000", 10),
  },
};

export default config;
