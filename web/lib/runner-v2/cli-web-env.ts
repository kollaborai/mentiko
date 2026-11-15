import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "@/lib/config";

let webEnvLoaded = false;

/**
 * CLI-side token minting must sign with the same root secret the web server
 * verifies with. The documented local setup keeps BETTER_AUTH_SECRET in
 * web/.env.local, which Next loads for the server but a plain CLI shell does
 * not — without this, a CLI-minted token is signed with the separate local
 * development secret and every ops call returns 401. Loads the web app's env
 * files once per process; @next/env never overrides variables already present
 * in process.env.
 */
export async function loadWebEnvForCliSigning(): Promise<void> {
  if (webEnvLoaded) return;
  webEnvLoaded = true;
  try {
    const webDir = join(config.codeRoot, "web");
    if (!existsSync(webDir)) return;
    const { loadEnvConfig } = await import("@next/env");
    // Match the server's file set: `next dev` loads .env.development*, a
    // production server loads .env.production*. Without the flag @next/env
    // always picks the production files.
    loadEnvConfig(webDir, process.env.NODE_ENV !== "production");
  } catch {
    // Env files are best effort; a missing root secret fails at mint time
    // with a clear error instead of launching an agent without ops access.
  }
}

/**
 * Resolve the web origin the CLI-minted token's ops calls target. Explicit
 * configuration wins (caller env first, then process env after the web env
 * files are loaded); the local dev fallback is the web app's port from
 * web/processes.dev.json. Never silently default to :3000.
 */
export function resolveWebOrigin(env: NodeJS.ProcessEnv): string {
  const fromCaller = originFrom(env);
  if (fromCaller) return fromCaller;
  const fromProcess = originFrom(process.env);
  if (fromProcess) return fromProcess;
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
function originFrom(source: NodeJS.ProcessEnv): string | null {
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
