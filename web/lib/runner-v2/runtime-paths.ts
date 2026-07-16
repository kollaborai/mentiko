import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RuntimePaths {
  readonly values: Record<string, string>;
  readonly directoriesToCreate: readonly string[];
}

type RuntimeEnv = Record<string, string | undefined>;

function value(env: RuntimeEnv, key: string, fallback: string): string {
  return env[key] || fallback;
}

// Preserve config.sh's string-concatenation semantics. In particular a
// trailing slash in MENTIKO_GLOBAL_ROOT remains observable to existing callers.
function child(root: string, ...segments: string[]): string {
  return `${root}/${segments.join("/")}`;
}

function slugPart(input: string): string {
  const slug = input
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "root";
}

export function deriveRuntimePtyDaemon(root: string, namespaceId: string, orgId: string): string {
  return ["mentiko", slugPart(root), slugPart(namespaceId || "default"), slugPart(orgId || "default")].join("-");
}

export function resolveRuntimePaths(
  env: RuntimeEnv = process.env,
  options: { codeRoot: string; home?: string } = { codeRoot: process.cwd() },
): RuntimePaths {
  const codeRoot = value(env, "MENTIKO_CODE_ROOT", options.codeRoot);
  const root = value(env, "MENTIKO_ROOT", codeRoot);
  // MENTIKO_ROOT is a code-root compatibility alias in the sourced shell
  // environment. Data-root resolution must therefore use only the explicit
  // MENTIKO_GLOBAL_ROOT value or HOME, exactly as config.sh previously did.
  const globalRoot = value(env, "MENTIKO_GLOBAL_ROOT", join(options.home || env.HOME || homedir(), ".mentiko"));
  const namespaceId = value(env, "NAMESPACE_ID", "default");
  const orgId = value(env, "ORG_ID", "default");
  const projectDir = value(env, "MENTIKO_PROJECT_DIR", codeRoot);
  const projectId = value(env, "MENTIKO_PROJECT_ID", projectDir.replace(/\//g, "-"));
  const namespaceRoot = value(env, "MENTIKO_NAMESPACE_ROOT", child(globalRoot, "namespaces", namespaceId));
  const orgRoot = value(env, "MENTIKO_ORG_ROOT", orgId === "default" ? namespaceRoot : child(namespaceRoot, "orgs", orgId));
  const projectRoot = value(env, "MENTIKO_PROJECT_ROOT", projectDir === codeRoot ? orgRoot : child(orgRoot, "projects", projectId));

  const values = {
    MENTIKO_CODE_ROOT: codeRoot,
    MENTIKO_ROOT: root,
    MENTIKO_GLOBAL_ROOT: globalRoot,
    NAMESPACE_ID: namespaceId,
    ORG_ID: orgId,
    MENTIKO_PROJECT_DIR: projectDir,
    MENTIKO_PROJECT_ID: projectId,
    MENTIKO_NAMESPACE_ROOT: namespaceRoot,
    MENTIKO_ORG_ROOT: orgRoot,
    MENTIKO_PROJECT_ROOT: projectRoot,
    NAMESPACE_ROOT: namespaceRoot,
    NAMESPACES_BASE: value(env, "NAMESPACES_BASE", child(globalRoot, "namespaces")),
    PTY_DAEMON: value(env, "PTY_DAEMON", deriveRuntimePtyDaemon(globalRoot, namespaceId, orgId)),
    BILLING_DIR: value(env, "BILLING_DIR", child(namespaceRoot, "billing")),
    MARKETPLACE_DIR: value(env, "MARKETPLACE_DIR", child(namespaceRoot, "marketplace")),
    CHAIN_DIR: value(env, "CHAIN_DIR", child(orgRoot, "chains")),
    LINKS_DIR: value(env, "LINKS_DIR", child(orgRoot, "links")),
    AGENTS_DIR: value(env, "AGENTS_DIR", child(orgRoot, "agents")),
    AGENT_PROFILES_DIR: value(env, "AGENT_PROFILES_DIR", child(orgRoot, "agent-profiles")),
    CONFIG_PROFILES_DIR: value(env, "CONFIG_PROFILES_DIR", child(orgRoot, "config-profiles")),
    TEMPLATES_DIR: value(env, "TEMPLATES_DIR", child(orgRoot, "templates")),
    WEBHOOKS_DIR: value(env, "WEBHOOKS_DIR", child(orgRoot, "webhooks")),
    EMAILS_DIR: value(env, "EMAILS_DIR", child(orgRoot, "emails")),
    RUNS_DIR: value(env, "RUNS_DIR", child(projectRoot, "runs")),
    JOBS_DIR: value(env, "JOBS_DIR", child(projectRoot, "jobs")),
    EVENTS_DIR: value(env, "EVENTS_DIR", child(projectRoot, "events")),
    STATE_DIR: value(env, "STATE_DIR", child(projectRoot, "state")),
    DECISIONS_DIR: value(env, "DECISIONS_DIR", child(projectRoot, "decisions")),
    SCHEDULES_DIR: value(env, "SCHEDULES_DIR", child(projectRoot, "schedules")),
    METRICS_DIR: value(env, "METRICS_DIR", child(projectRoot, "metrics")),
    REPORTS_DIR: value(env, "REPORTS_DIR", child(projectRoot, "reports")),
    DEBUG_DIR: value(env, "DEBUG_DIR", child(projectRoot, "debug")),
    WORKSPACE_DIR: value(env, "WORKSPACE_DIR", child(projectRoot, "workspace")),
    RUNSPACE_DIR: value(env, "RUNSPACE_DIR", child(projectRoot, "runspace")),
    WATCHDOG_HOOKS_DIR: value(env, "WATCHDOG_HOOKS_DIR", child(projectRoot, "watchdog-hooks")),
    AGENTS_RUNTIME_DIR: value(env, "AGENTS_RUNTIME_DIR", child(projectRoot, "agents-runtime")),
    RUNTIME_DIR: value(env, "RUNTIME_DIR", child(projectRoot, "runtime")),
    BIN_DIR: value(env, "BIN_DIR", child(codeRoot, "bin")),
    LIB_DIR: value(env, "LIB_DIR", child(codeRoot, "lib")),
    DEFAULT_CLI: value(env, "DEFAULT_CLI", "claude"),
    DEFAULT_SESSION_PREFIX: value(env, "DEFAULT_SESSION_PREFIX", "mentiko"),
    DEFAULT_PROJECT_ROOT: value(env, "DEFAULT_PROJECT_ROOT", "auto"),
    WEB_PORT: value(env, "WEB_PORT", value(env, "PORT", "3000")),
    MAX_CONCURRENT_AGENTS: value(env, "MAX_CONCURRENT_AGENTS", "10"),
    DEFAULT_MAX_ROUNDS: value(env, "DEFAULT_MAX_ROUNDS", "50"),
    MENTIKO_MAX_CONCURRENT_CHAINS: value(env, "MENTIKO_MAX_CONCURRENT_CHAINS", "4"),
    MENTIKO_MAX_ACTIVE_AGENTS: value(env, "MENTIKO_MAX_ACTIVE_AGENTS", "3"),
    MENTIKO_CAP_MAX_WAIT_SECS: value(env, "MENTIKO_CAP_MAX_WAIT_SECS", "300"),
  };

  return {
    values: { ...values, CHAINS_DIR: values.CHAIN_DIR },
    directoriesToCreate: [
      values.BILLING_DIR, values.MARKETPLACE_DIR,
      values.CHAIN_DIR, values.LINKS_DIR, values.AGENTS_DIR, values.AGENT_PROFILES_DIR,
      values.CONFIG_PROFILES_DIR, values.TEMPLATES_DIR, values.WEBHOOKS_DIR, values.EMAILS_DIR,
      values.RUNS_DIR, values.JOBS_DIR, values.EVENTS_DIR, values.STATE_DIR, values.DECISIONS_DIR,
      values.SCHEDULES_DIR, values.METRICS_DIR, values.REPORTS_DIR, values.DEBUG_DIR,
    ],
  };
}

export function ensureRuntimePathDirectories(paths: RuntimePaths): void {
  for (const directory of paths.directoriesToCreate) {
    try {
      mkdirSync(directory, { recursive: true });
    } catch {
      // config.sh historically made directory creation best-effort.
    }
  }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatRuntimePathExports(paths: RuntimePaths): string {
  return Object.entries(paths.values)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n");
}
