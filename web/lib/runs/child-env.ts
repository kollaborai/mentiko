/**
 * Build an environment for spawned child processes using an allowlist.
 *
 * Prevents leaking server secrets (STRIPE_SECRET_KEY, GITHUB_CLIENT_SECRET,
 * DATABASE_URL, etc.) to detached workers and AI CLI subprocesses.
 *
 * Pass any job-specific overrides as the argument — they are merged on top
 * of the allowlisted base env.
 */

const ALLOWED_KEYS = [
  // runtime
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "NODE_ENV",
  "PTY_DAEMON",

  // mentiko data hierarchy
  "MENTIKO_GLOBAL_ROOT",
  "MENTIKO_CODE_ROOT",
  "MENTIKO_PROJECT_ROOT",
  "MENTIKO_ORG_ROOT",
  "MENTIKO_NAMESPACE_ROOT",
  "MENTIKO_ROOT",
  "NAMESPACE_ID",
  "ORG_ID",
  "TENANT_ID",

  // job runner (callback auth is scoped to job runner alone)
  "JOB_CALLBACK_URL",
  "JOB_CALLBACK_SECRET",
  "JOB_WORKSPACE_CWD",
  "WEB_PORT",

  // secret-store key derivation — runner decrypts {secret:NAME} references
  // from agent profiles, so it needs BETTER_AUTH_SECRET. no other child
  // process should read this.
  "BETTER_AUTH_SECRET",

  // CLI auth may still use its own config dir. Provider credentials must come
  // from an explicit agent profile, never inherited from the server process.
  "CLAUDE_CONFIG_DIR",

  // startup readiness + bounded recovery toggles. Typed bootstrap reads these;
  // forwarding them lets a deployment turn fail-closed readiness on
  // via env (e.g. web/.env.local or the tenant container) without code changes.
  "MENTIKO_READINESS_FAIL_CLOSED",
  "MENTIKO_STARTUP_RECOVERY",
  "MENTIKO_STARTUP_RECOVERY_MAX",
  "MENTIKO_CLI_READY_TIMEOUT",
  "MENTIKO_CLI_READY_POLL",

  // tenant execution capacity. These limits are set by the control plane for
  // each hosting tier and must survive the server -> detached runner boundary.
  // Dropping them makes typed bootstrap silently use its larger defaults.
  "MENTIKO_CAP_DISABLED",
  "MENTIKO_MAX_CONCURRENT_CHAINS",
  "MENTIKO_CAP_MAX_WAIT_SECS",
  "MENTIKO_CAP_POLL_SECS",
  "MENTIKO_CAP_POLL_MAX_SECS",
  "MENTIKO_MAX_ACTIVE_AGENTS",
  "MAX_CONCURRENT_AGENTS",
  "MENTIKO_AGENT_CAP_MAX_WAIT_SECS",
  "MENTIKO_AGENT_CAP_POLL_SECS",
  "MENTIKO_AGENT_CAP_POLL_MAX_SECS",

  // side-by-side migration flag for the typescript orchestration controller.
  // checked by the web launch service before spawning the runner process.
  "MENTIKO_RUNNER_V2",
  "MENTIKO_RUNNER_V2_COMPLETION",
];

type ChildEnvOverrides = Record<string, string | undefined>;

/**
 * Returns a loose env dict compatible with both NodeJS.ProcessEnv (spawn opts)
 * and Record<string, string> (pty-client.spawn). All values are strings at
 * runtime (undefined values are filtered out), so both consumers are happy
 * even though the declared type is ProcessEnv-compatible.
 */
type ChildEnv = NodeJS.ProcessEnv & Record<string, string>;

export function buildChildEnv(overrides: ChildEnvOverrides = {}): ChildEnv {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env as ChildEnv;
}
