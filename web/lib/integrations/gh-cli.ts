import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// ponytail: 60s module cache — the connection poll shells out to gh on every
// onboarding mount; re-resolving the keyring token + /user each time is waste.
// If the user switches gh accounts mid-session they wait at most a minute.
const CACHE_TTL_MS = 60_000;

export type GhCliStatus = { available: boolean; login?: string };

let cached: { at: number; status: GhCliStatus } | null = null;

/** Returns the gh CLI's stored OAuth token, or null when gh is absent/signed out. */
export async function getGhCliToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], { timeout: 5_000 });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Reports whether a signed-in gh CLI exists on this box (and which account).
 * The token itself never leaves the server — callers store it via the secrets
 * store only when the user explicitly picks the gh-cli connect option.
 */
export async function getGhCliStatus(force = false): Promise<GhCliStatus> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.status;
  const token = await getGhCliToken();
  if (!token) {
    cached = { at: Date.now(), status: { available: false } };
    return cached.status;
  }
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!res.ok) {
      cached = { at: Date.now(), status: { available: false } };
      return cached.status;
    }
    const user = (await res.json()) as { login?: string };
    cached = { at: Date.now(), status: { available: true, login: user.login } };
    return cached.status;
  } catch {
    cached = { at: Date.now(), status: { available: false } };
    return cached.status;
  }
}
