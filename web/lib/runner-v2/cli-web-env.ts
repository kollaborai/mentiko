import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "@/lib/config";

/** The only web env-file values the CLI needs: the signing secret and the web origin. */
const CLI_WEB_ENV_KEYS = ["BETTER_AUTH_SECRET", "SECRET_KEY", "MENTIKO_WEB_URL", "BETTER_AUTH_URL"] as const;
export type CliWebEnv = Partial<Record<(typeof CLI_WEB_ENV_KEYS)[number], string>>;

let cachedWebEnv: CliWebEnv | null = null;

/**
 * CLI-side token minting must sign with the same root secret the web server
 * verifies with. The documented local setup keeps BETTER_AUTH_SECRET in
 * web/.env.local, which Next loads for the server but a plain CLI shell does
 * not; without it, a CLI-minted token is signed with the separate local
 * development secret and every ops call returns 401.
 *
 * Reads the web app's env files and returns ONLY the signing secret and web
 * origin. process.env is restored afterwards: the web env files also hold
 * OAuth secrets, tokens and runtime switches (e.g. MENTIKO_PTY_MGR_BIN) that
 * must not leak into the CLI process or the agents it launches.
 */
export async function loadWebEnvForCliSigning(): Promise<CliWebEnv> {
  if (cachedWebEnv) return cachedWebEnv;
  cachedWebEnv = {};
  const snapshot = { ...process.env };
  try {
    const webDir = join(config.codeRoot, "web");
    if (!existsSync(webDir)) return cachedWebEnv;
    const { loadEnvConfig } = await import("@next/env");
    // Match the server's file set: `next dev` loads .env.development*, a
    // production server loads .env.production*. Without the flag @next/env
    // always picks the production files.
    loadEnvConfig(webDir, process.env.NODE_ENV !== "production");
    for (const key of CLI_WEB_ENV_KEYS) {
      const value = process.env[key];
      // keep only values the files added; caller-set values stay the caller's
      if (value && snapshot[key] === undefined) cachedWebEnv[key] = value;
    }
  } catch {
    // Env files are best effort; a missing root secret fails at mint time
    // with a clear error instead of launching an agent without ops access.
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) delete process.env[key];
    }
    Object.assign(process.env, snapshot);
  }
  return cachedWebEnv;
}

/**
 * Run fn with the web env-file signing secret visible to mintSessionToken
 * (which reads process.env), then remove it again so nothing launched later
 * inherits it.
 */
export async function withWebSigningSecret<T>(webEnv: CliWebEnv, fn: () => Promise<T>): Promise<T> {
  const added: string[] = [];
  for (const key of ["BETTER_AUTH_SECRET", "SECRET_KEY"] as const) {
    if (webEnv[key] && process.env[key] === undefined) {
      process.env[key] = webEnv[key];
      added.push(key);
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of added) delete process.env[key];
  }
}

/**
 * Resolve the web origin the CLI-minted token's ops calls target. Explicit
 * configuration wins (caller env first, then process env after the web env
 * files are loaded); the local dev fallback is the web app's port from
 * web/processes.dev.json. Never silently default to :3000.
 */
export function resolveWebOrigin(env: NodeJS.ProcessEnv, webEnv: CliWebEnv = {}): string {
  const fromCaller = originFrom(env);
  if (fromCaller) return fromCaller;
  const fromProcess = originFrom(process.env);
  if (fromProcess) return fromProcess;
  const fromWebFiles = originFrom(webEnv);
  if (fromWebFiles) return fromWebFiles;
  if (process.env.NODE_ENV !== "production") {
    const port = devWebPort();
    if (port) return `http://127.0.0.1:${port}`;
  }
  throw new Error(
    "cannot resolve the mentiko web origin for CLI ops access: set MENTIKO_WEB_URL or BETTER_AUTH_URL",
  );
}

// One source at a time, so a value loaded from an env file never overrides
// what the caller set. WEB_PORT/PORT are deliberately not read: bin/mentiko's
// lib/config.sh always exports WEB_PORT=3000 as a default, so it cannot tell a
// real override from the default.
function originFrom(source: Record<string, string | undefined>): string | null {
  return source.MENTIKO_WEB_URL?.trim() || source.BETTER_AUTH_URL?.trim() || null;
}

function devWebPort(): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(config.codeRoot, "web", "processes.dev.json"), "utf8"),
    ) as { processes?: Array<{ name?: string; env?: Record<string, string> }> };
    const webEntry = parsed.processes?.find((entry) => entry.name === "platform");
    const port = webEntry?.env?.PORT;
    return port && /^\d+$/.test(port) ? port : null;
  } catch {
    return null;
  }
}

/**
 * Prove the minted token is accepted by the web app the agent will call,
 * before any agent launches. Env-file loading can only guess the server's
 * signing context (its mode, its secret); this asks the server itself, so a
 * CLI and server that disagree for any reason fail here with a clear message
 * instead of an agent hitting 401 on its first ops call.
 */
/** No web app answered at the origin (refused, DNS, timeout). */
export class WebAppUnreachableError extends Error {}

export async function assertWebAcceptsToken(origin: string, token: string, timeoutMs = 5000): Promise<void> {
  const url = `${origin.replace(/\/+$/, "")}/api/mentiko-mcp/ops/monitor/status`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      // a redirect (e.g. to a login page) is not proof the token was verified
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WebAppUnreachableError(
      `mentiko web app at ${origin} is unreachable (${error instanceof Error ? error.message : String(error)}); start it or set MENTIKO_WEB_URL`,
    );
  }
  if (res.status === 401) {
    throw new Error(
      `mentiko web app at ${origin} rejected the CLI session token (HTTP 401); the usual cause is that the CLI and the web app use different BETTER_AUTH_SECRET values`,
    );
  }
  // Only the route's own authenticated answer counts: a 200 carrying its
  // monitor digest. Anything else (404/405 from an older server or a proxy,
  // a redirect, an unrelated 200) proves nothing about the token.
  let body: unknown = null;
  if (res.status === 200) body = await res.json().catch(() => null);
  if (res.status !== 200 || !body || typeof body !== "object" || !("digest" in body)) {
    throw new Error(
      `mentiko web app at ${origin} did not confirm the CLI session token (HTTP ${res.status} from ${url}); check MENTIKO_WEB_URL points at the mentiko web app`,
    );
  }
}
