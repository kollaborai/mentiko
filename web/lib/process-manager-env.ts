import { join } from "path";
import type { ProcessConfig } from "./pm-types";

export const MANAGED_PROCESS_ENV_WHITELIST = [
  "PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM",
  "SHELL", "HOSTNAME", "TZ", "NODE_ENV", "PORT",
  "NODE_PATH", "NPM_CONFIG_PREFIX",
  // terminal bridge: operator-configurable port + proxy mode + origin allowlist
  "WS_PORT", "WS_TERMINAL_PORT", "WS_TERMINAL_HOST",
  "MENTIKO_TERMINAL_PROXY", "WS_TERMINAL_PROXY_PATH",
  "WS_ALLOWED_ORIGINS",
  // platform auth + runtime config -- must be passed to next.js
  "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "AUTH_SECRET",
  "DATABASE_URL", "MENTIKO_ROOT", "MENTIKO_GLOBAL_ROOT",
  "MENTIKO_CODE_ROOT", "STORAGE_BUCKET",
  "CONTROL_PLANE_URL", "ADMIN_EMAILS",
  "MARKETPLACE_AUTO_SYNC", "MARKETPLACE_SYNC_INTERVAL",
  // tenant transactional email -- next-server sends auth/reset mail.
  "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_FROM",
  "SMTP_USER", "SMTP_PASS", "RESEND_API_KEY",
  // tenant isolation -- child processes need tier context
  "TENANT_ID", "NAMESPACE_ID", "ORG_ID",
  "MENTIKO_NAMESPACE_ROOT", "MENTIKO_ORG_ROOT",
  "MENTIKO_TIER", "ENV_SCHEMA_VERSION",
  // mentiko-mcp subprocess reads these to reach the platform inbox
  "MENTIKO_INBOX_KEY", "MENTIKO_WEB_URL",
  "MENTIKO_NAMESPACE_ID", "MENTIKO_ORG_ID",
  "MENTIKO_DEFAULT_NAMESPACE_ID", "MENTIKO_DEFAULT_ORG_ID",
  // optional override for the platform's server-side engine proxy
  "KOLLABOR_ENGINE_URL",
  // optional override for local/bundled PTY manager binary selection
  "PTY_MGR_BIN", "MENTIKO_PTY_MGR_BIN", "PTY_DAEMON",
  // internal service auth -- used by engine->web refresh-token calls
  "INTERNAL_SERVICE_SECRET",
  // SaaS signup gate -- auth-deployment.ts + auth-server.ts read these
  // to lock public signup and accept the control-plane bootstrap token.
  "MENTIKO_DISABLE_PUBLIC_SIGNUP", "MENTIKO_PROVISIONING_TOKEN",
  "MENTIKO_OWNER_EMAIL",
  // version-skew protection: next.js encrypts server-action closures with this
  // key at build time. the runtime container needs the SAME key to decrypt
  // actions invoked by clients. without it, every deploy invalidates in-flight
  // actions with "Failed to find Server Action". on managed deploys the key
  // is injected from cp's .env into the tenant container via cloud-init.ts.
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
] as const;

export const PLATFORM_PROCESS_ENV_WHITELIST = [
  // hosted included-AI gateway config. next.js signs upstream gateway requests;
  // agents only receive a separate local proxy token from route launch env.
  "MENTIKO_AI_GATEWAY_ENABLED",
  "MENTIKO_AI_GATEWAY_URL",
  "MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN",
  "MENTIKO_AI_GATEWAY_TOKEN_ID",
  "MENTIKO_AI_GATEWAY_TOKEN",
] as const;

type EnvSource = Record<string, string | undefined>;

/**
 * Development processes need an explicit root because their child
 * environments are allow-listed. This mirrors config.ts's local default,
 * while production intentionally remains responsible for providing a root.
 */
export function resolveManagedDevGlobalRoot(
  environment: EnvSource,
  home: string,
): string {
  return environment.MENTIKO_GLOBAL_ROOT || environment.MENTIKO_ROOT || join(home, ".mentiko");
}

/**
 * A local supervisor can inherit `/app` from a long-lived container-oriented
 * terminal daemon. Treat only a missing `/app` as that stale transport value;
 * every other explicit root remains authoritative.
 */
export function shouldReplaceUnavailableDevContainerRoot(
  environment: EnvSource,
  appRootExists: boolean,
): boolean {
  return environment.MENTIKO_GLOBAL_ROOT === "/app" && !appRootExists;
}

function expandEnvValue(value: string, sourceEnv: EnvSource) {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => sourceEnv[name] || "");
}

/** Expand explicit process-config arguments from the supervisor environment. */
export function expandManagedProcessArgs(
  args: readonly string[],
  sourceEnv: EnvSource = process.env,
): string[] {
  return args.map((arg) => expandEnvValue(arg, sourceEnv));
}

function copyWhitelistedEnv(
  target: Record<string, string>,
  sourceEnv: EnvSource,
  keys: readonly string[],
) {
  for (const key of keys) {
    if (sourceEnv[key]) target[key] = sourceEnv[key]!;
  }
}

export function buildManagedProcessEnv(
  config: Pick<ProcessConfig, "name" | "env">,
  sourceEnv: EnvSource = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};

  copyWhitelistedEnv(env, sourceEnv, MANAGED_PROCESS_ENV_WHITELIST);
  if (config.name === "platform") {
    copyWhitelistedEnv(env, sourceEnv, PLATFORM_PROCESS_ENV_WHITELIST);
  }

  for (const [key, value] of Object.entries(config.env || {})) {
    // Container/operator env wins over processes.json defaults. Without
    // this, hardcoded "PORT": "3000" in the config would shadow an
    // operator's `docker run -e PORT=13000`.
    if (sourceEnv[key]) {
      env[key] = sourceEnv[key]!;
    } else {
      env[key] = expandEnvValue(value, sourceEnv);
    }
  }

  return env;
}
