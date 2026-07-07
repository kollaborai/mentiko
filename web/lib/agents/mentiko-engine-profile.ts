/**
 * mentiko-engine-profile: register the built-in "mentiko" llm profile with
 * the local kollabor-engine at boot. used when MENTIKO_AI_GATEWAY_ENABLED=true
 * so the floating chat widget can route through the local ai-gateway proxy
 * straight to the standalone gateway.
 *
 * no top-level fs/network — everything happens lazily inside the exported
 * async functions so this module is safe to import from anywhere.
 */

import { createHmac } from "node:crypto";
import { MENTIKO_GATEWAY_PROFILE } from "./agent-provider-catalog";

const INTERNAL_AUTH_CONTEXT = "ai-gateway-local-proxy";
const INTERNAL_AUTH_INFO = `mentiko-internal-api:${INTERNAL_AUTH_CONTEXT}`;
const ENGINE_BASE_URL = "http://127.0.0.1:7433";
export const ENGINE_WAIT_MS = 90_000;
export const ENGINE_POLL_INTERVAL_MS = 1_000;
const PROFILE_NAME = MENTIKO_GATEWAY_PROFILE.name;
const PROFILE_MODEL = MENTIKO_GATEWAY_PROFILE.model;
const PROFILE_PROVIDER = MENTIKO_GATEWAY_PROFILE.provider;
const PROFILE_DESCRIPTION = MENTIKO_GATEWAY_PROFILE.description;

export interface MentikoProfileConfig {
  name: string;
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  description: string;
}

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

function rootSecret(env: Env): string | null {
  const value = env.BETTER_AUTH_SECRET || env.SECRET_KEY;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * derive the hex bearer used to authenticate to the local ai-gateway proxy.
 * mirrors resolveInternalAuthSecret("ai-gateway-local-proxy") from
 * web/lib/internal-api-auth.ts without touching its dev-secret fs path.
 */
export function getInternalGatewayBearer(env: Env = process.env): string {
  const secret = rootSecret(env);
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required to derive internal gateway bearer");
  }
  return createHmac("sha256", secret).update(INTERNAL_AUTH_INFO, "utf8").digest("hex");
}

function localProxyBaseUrl(env: Env): string {
  const webUrl = env.MENTIKO_WEB_URL || env.MENTIKO_INTERNAL_WEB_ORIGIN;
  if (webUrl) return `${webUrl.replace(/\/$/, "")}/api/ai-gateway/local/v1`;
  const port = env.WEB_PORT || env.PORT || "3000";
  return `http://127.0.0.1:${port}/api/ai-gateway/local/v1`;
}

export function buildMentikoProfileConfig(env: Env = process.env): MentikoProfileConfig | null {
  if (env.MENTIKO_AI_GATEWAY_ENABLED !== "true") return null;
  if (!rootSecret(env)) return null;

  return {
    name: PROFILE_NAME,
    provider: PROFILE_PROVIDER,
    model: PROFILE_MODEL,
    base_url: localProxyBaseUrl(env),
    api_key: getInternalGatewayBearer(env),
    description: PROFILE_DESCRIPTION,
  };
}

interface FetchLike {
  (input: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

async function waitForEngine(fetchImpl: FetchLike): Promise<boolean> {
  const deadline = Date.now() + ENGINE_WAIT_MS;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${ENGINE_BASE_URL}/health`);
      // engine /health may be unauthenticated (200) or require auth (401).
      // either case means the process is up and accepting connections.
      if (res.status < 500) return true;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, ENGINE_POLL_INTERVAL_MS));
  }
  if (lastErr) {
    // surface last poll error for diagnostics
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(`[mentiko-profile] engine never came up: ${msg}`);
  }
  return false;
}

async function readEngineToken(): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const path = join(homedir(), ".kollab", "engine.token");
    const raw = await readFile(path, "utf8");
    const token = raw.trim();
    return token || null;
  } catch {
    return null;
  }
}

function looksLikeExists(status: number, bodyText: string): boolean {
  if (status === 409) return true;
  if (status === 400) {
    const lower = bodyText.toLowerCase();
    if (lower.includes("exist") || lower.includes("duplicate")) return true;
  }
  return false;
}

async function postOrPutProfile(
  fetchImpl: FetchLike,
  token: string,
  config: MentikoProfileConfig,
): Promise<{ ok: boolean; status: number; body: string; customized?: boolean }> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify(config);

  const postRes = await fetchImpl(`${ENGINE_BASE_URL}/profiles`, {
    method: "POST",
    headers,
    body,
  });
  const postBody = await postRes.text();
  if (postRes.ok) {
    return { ok: true, status: postRes.status, body: postBody };
  }

  if (!looksLikeExists(postRes.status, postBody)) {
    return { ok: false, status: postRes.status, body: postBody };
  }

  // profile already exists. before PUT-ing our defaults, check if the user
  // customized base_url (e.g. pointed at a different upstream like featherless).
  // if customized, leave it — don't clobber on every boot.
  const getRes = await fetchImpl(
    `${ENGINE_BASE_URL}/profiles/${encodeURIComponent(PROFILE_NAME)}`,
    { method: "GET", headers },
  );
  if (getRes.ok) {
    const getBody = await getRes.text();
    let existingBaseUrl: string | null = null;
    try {
      const parsed = JSON.parse(getBody) as unknown;
      if (parsed && typeof parsed === "object" && "base_url" in parsed) {
        const value = (parsed as { base_url?: unknown }).base_url;
        if (typeof value === "string") existingBaseUrl = value;
      }
    } catch {
      // unparseable response — fall through to PUT
    }
    if (existingBaseUrl && existingBaseUrl !== config.base_url) {
      return {
        ok: true,
        status: getRes.status,
        body: getBody,
        customized: true,
      };
    }
  }

  const putRes = await fetchImpl(
    `${ENGINE_BASE_URL}/profiles/${encodeURIComponent(PROFILE_NAME)}`,
    { method: "PUT", headers, body },
  );
  const putBody = await putRes.text();
  return { ok: putRes.ok, status: putRes.status, body: putBody };
}

type KollabConfig = {
  kollabor?: {
    llm?: {
      active_profile?: string;
      default_profile?: { name: string; level: string };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

async function writeActiveProfile(): Promise<void> {
  const { readFile, writeFile, mkdir } = await import("node:fs/promises");
  const { join, dirname } = await import("node:path");
  const { homedir } = await import("node:os");

  const configPath = join(homedir(), ".kollab", "config.json");
  let config: KollabConfig = {};
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      config = parsed as KollabConfig;
    }
  } catch (err) {
    if (
      !err ||
      typeof err !== "object" ||
      !("code" in err) ||
      (err as { code?: string }).code !== "ENOENT"
    ) {
      throw err;
    }
  }

  if (!config.kollabor || typeof config.kollabor !== "object") {
    config.kollabor = {};
  }
  if (!config.kollabor.llm || typeof config.kollabor.llm !== "object") {
    config.kollabor.llm = {};
  }

  // idempotent: only seed if missing or still on mentiko. don't clobber a
  // user who picked a different active profile.
  const llm = config.kollabor.llm;
  const existingActive = typeof llm.active_profile === "string" ? llm.active_profile : null;
  const existingDefaultName =
    llm.default_profile && typeof llm.default_profile === "object"
      ? llm.default_profile.name
      : null;
  let dirty = false;
  if (!existingActive || existingActive === PROFILE_NAME) {
    if (existingActive !== PROFILE_NAME) {
      llm.active_profile = PROFILE_NAME;
      dirty = true;
    }
  }
  if (!existingDefaultName || existingDefaultName === PROFILE_NAME) {
    if (existingDefaultName !== PROFILE_NAME) {
      llm.default_profile = { name: PROFILE_NAME, level: "global" };
      dirty = true;
    }
  }
  if (!dirty) return;

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function registerMentikoProfile(): Promise<boolean> {
  const env = process.env;
  if (env.MENTIKO_AI_GATEWAY_ENABLED !== "true") return false;

  const profile = buildMentikoProfileConfig(env);
  if (!profile) {
    console.warn("[mentiko-profile] error: gateway enabled but profile config missing (BETTER_AUTH_SECRET unset?)");
    return false;
  }

  try {
    const fetchImpl = fetch as unknown as FetchLike;

    const up = await waitForEngine(fetchImpl);
    if (!up) {
      console.warn(
        `[mentiko-profile] error: engine did not come up within ${ENGINE_WAIT_MS / 1000}s`,
      );
      return false;
    }

    const token = await readEngineToken();
    if (!token) {
      console.warn("[mentiko-profile] error: engine token unavailable");
      return false;
    }

    const result = await postOrPutProfile(fetchImpl, token, profile);
    if (!result.ok) {
      const trimmed = result.body.slice(0, 200).replace(/\s+/g, " ");
      console.warn(`[mentiko-profile] error: profile save failed (${result.status}) ${trimmed}`);
      return false;
    }

    await writeActiveProfile();
    if (result.customized) {
      console.log("[mentiko-profile] registered (existing base_url customization preserved)");
    } else {
      console.log("[mentiko-profile] registered");
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mentiko-profile] error: ${msg.split("\n")[0]}`);
    return false;
  }
}
