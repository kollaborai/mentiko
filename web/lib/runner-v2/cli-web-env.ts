import { execFileSync } from "node:child_process";
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
 * Runs Next's own loader (@next/env loadEnvConfig) in a short-lived child
 * process, so parsing, ${VAR} expansion and file precedence match the server
 * exactly, and only the four signing/origin keys come back. The CLI's own
 * process.env is never modified: the web env files also hold OAuth secrets,
 * tokens and runtime switches (e.g. MENTIKO_PTY_MGR_BIN) that must not reach
 * the CLI or the agents it launches. Synchronous, so parallel batch launches
 * cannot observe a half-loaded result. A failed load is not cached.
 */
export function loadWebEnvForCliSigning(env: NodeJS.ProcessEnv = process.env): CliWebEnv {
  if (cachedWebEnv) return cachedWebEnv;
  // Without Next's loader, the effective values are the caller's own.
  const callerOnly = pickKeys({ ...process.env, ...env });
  try {
    const webDir = join(config.codeRoot, "web");
    // dev checkouts keep Next under web/node_modules; the standalone image
    // assembles it under <codeRoot>/node_modules
    const nextEnv = [join(webDir, "node_modules", "@next", "env"), join(config.codeRoot, "node_modules", "@next", "env")]
      .find((candidate) => existsSync(candidate));
    if (!nextEnv) return callerOnly;
    const dev = (env.NODE_ENV ?? process.env.NODE_ENV) !== "production";
    const script = [
      `const { loadEnvConfig } = require(${JSON.stringify(nextEnv)});`,
      `loadEnvConfig(${JSON.stringify(webDir)}, ${dev}, { info() {}, warn() {}, error() {} });`,
      `const out = {};`,
      `for (const k of ${JSON.stringify(CLI_WEB_ENV_KEYS)}) if (process.env[k] !== undefined) out[k] = process.env[k];`,
      `process.stdout.write(JSON.stringify(out));`,
    ].join("\n");
    const out = execFileSync(process.execPath, ["-e", script], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    cachedWebEnv = JSON.parse(out) as CliWebEnv;
    return cachedWebEnv;
  } catch {
    // Best effort: without file values a missing root secret fails at mint
    // time with a clear error instead of launching an agent without ops access.
    return callerOnly;
  }
}

function pickKeys(source: Record<string, string | undefined>): CliWebEnv {
  const out: CliWebEnv = {};
  for (const key of CLI_WEB_ENV_KEYS) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/**
 * Root signing secret, resolved like the server's getRootSecret
 * (BETTER_AUTH_SECRET || SECRET_KEY) over the effective values: caller env
 * overlaid with the web env files, bytes preserved.
 */
export function cliSigningSecret(webEnv: CliWebEnv): string | undefined {
  return webEnv.BETTER_AUTH_SECRET || webEnv.SECRET_KEY || undefined;
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
