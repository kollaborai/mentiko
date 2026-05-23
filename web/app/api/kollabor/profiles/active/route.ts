import { readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { registerMentikoProfile } from "@/lib/mentiko-engine-profile";

export const dynamic = "force-dynamic";

// one-shot lazy retry guard: when the engine takes longer than the boot
// poll window to come up, the first GET to this route (fired by the
// floating bar) triggers a single re-registration attempt. only flipped
// to true on success so a failed attempt can be retried by a later GET.
let lazyRetryAttempted = false;

const CONFIG_PATH = join(homedir(), ".kollab", "config.json");
const TOKEN_PATH = join(homedir(), ".kollab", "engine.token");
const ENGINE_BASE_URL = process.env.KOLLABOR_ENGINE_URL || "http://127.0.0.1:7433";

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

type EngineProfile = {
  name?: unknown;
  supports_tools?: unknown;
};

type EngineProfilesResponse = {
  profiles?: EngineProfile[];
  active?: unknown;
};

async function readConfig(): Promise<KollabConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as KollabConfig;
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && e.code === "ENOENT") {
      return {};
    }
    throw e;
  }
}

async function readEngineToken(): Promise<string> {
  const token = (await readFile(TOKEN_PATH, "utf8")).trim();
  if (!token) throw new Error("engine.token is empty");
  return token;
}

async function loadEngineProfiles(): Promise<EngineProfilesResponse> {
  const token = await readEngineToken();
  const res = await fetch(`${ENGINE_BASE_URL}/profiles`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`engine profiles unavailable: ${res.status}`);
  }
  const data = (await res.json()) as EngineProfilesResponse;
  return {
    active: data.active,
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
  };
}

function findProfile(data: EngineProfilesResponse, name: string): EngineProfile | null {
  return data.profiles?.find((profile) => profile.name === name) ?? null;
}

function profileCanRunTools(profile: EngineProfile): boolean {
  return profile.supports_tools !== false;
}

async function validateProfileName(name: string): Promise<NextResponse | null> {
  let data: EngineProfilesResponse;
  try {
    data = await loadEngineProfiles();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  const profile = findProfile(data, name);
  if (!profile) {
    return NextResponse.json({ error: `profile not found: ${name}` }, { status: 400 });
  }
  if (!profileCanRunTools(profile)) {
    return NextResponse.json(
      { error: `profile cannot run Mentiko tools: ${name}` },
      { status: 400 },
    );
  }
  return null;
}

function selectReadableActive(
  configActive: string | null,
  data: EngineProfilesResponse,
): string | null {
  if (configActive) {
    const profile = findProfile(data, configActive);
    if (profile && profileCanRunTools(profile)) return configActive;
  }

  if (typeof data.active === "string" && data.active) {
    const profile = findProfile(data, data.active);
    if (profile && profileCanRunTools(profile)) return data.active;
  }

  return null;
}

async function readActiveProfile(): Promise<string | null> {
  const config = await readConfig();
  const active = config.kollabor?.llm?.active_profile ?? null;
  try {
    return selectReadableActive(active, await loadEngineProfiles());
  } catch {
    return active;
  }
}

export async function POST(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let name: string;
  try {
    const body = (await request.json()) as { name?: unknown };
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    name = body.name.trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  try {
    const validationError = await validateProfileName(name);
    if (validationError) return validationError;

    const config = await readConfig();
    if (!config.kollabor) config.kollabor = {};
    if (!config.kollabor.llm) config.kollabor.llm = {};
    config.kollabor.llm.active_profile = name;
    config.kollabor.llm.default_profile = { name, level: "global" };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
    return NextResponse.json({ ok: true, active: name });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    let active = await readActiveProfile();

    if (
      !lazyRetryAttempted &&
      process.env.MENTIKO_AI_GATEWAY_ENABLED === "true" &&
      active !== "mentiko"
    ) {
      try {
        const ok = await registerMentikoProfile();
        if (ok) {
          lazyRetryAttempted = true;
          active = await readActiveProfile();
        } else {
          console.warn("[mentiko-profile] lazy retry failed: registration returned false");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[mentiko-profile] lazy retry failed: ${msg}`);
      }
    }

    return NextResponse.json({ active });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
