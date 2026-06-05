import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { getSecretByName } from "@/lib/secrets/secrets-store";

export const dynamic = "force-dynamic";

const ENGINE_BASE_URL = process.env.KOLLABOR_ENGINE_URL || "http://127.0.0.1:7433";
const TOKEN_PATH = join(homedir(), ".kollab", "engine.token");

async function readEngineToken(): Promise<string> {
  const token = (await readFile(TOKEN_PATH, "utf8")).trim();
  if (!token) throw new Error("engine.token is empty");
  return token;
}

type ProfileBody = {
  name?: unknown;
  provider?: unknown;
  model?: unknown;
  description?: unknown;
  base_url?: unknown;
  api_key_secret?: unknown;  // secret name from vault
  api_key?: unknown;         // raw key (fallback, not recommended)
  editing?: unknown;         // if true, PUT instead of POST
};

export async function POST(request: NextRequest) {
  if (!(await checkAuth(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: ProfileBody;
  try {
    body = (await request.json()) as ProfileBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  // resolve api key — prefer secret reference, fall back to raw value
  let resolvedApiKey: string | undefined;
  if (typeof body.api_key_secret === "string" && body.api_key_secret.trim()) {
    const secretName = body.api_key_secret.trim();
    const val = getSecretByName(namespaceId, orgId, secretName);
    if (!val) {
      return NextResponse.json(
        { error: `secret "${secretName}" not found in vault` },
        { status: 400 }
      );
    }
    resolvedApiKey = val;
  } else if (typeof body.api_key === "string" && body.api_key.trim()) {
    resolvedApiKey = body.api_key.trim();
  }

  const engineBody: Record<string, unknown> = {
    name,
    provider: body.provider,
    model: body.model,
    description: body.description ?? "",
  };
  if (resolvedApiKey) engineBody.api_key = resolvedApiKey;
  if (typeof body.base_url === "string" && body.base_url.trim()) {
    engineBody.base_url = body.base_url.trim();
  }

  let token: string;
  try {
    token = await readEngineToken();
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `engine token unavailable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 503 }
    );
  }

  const isEditing = body.editing === true;
  const url = isEditing
    ? `${ENGINE_BASE_URL}/profiles/${encodeURIComponent(name)}`
    : `${ENGINE_BASE_URL}/profiles`;

  try {
    const res = await fetch(url, {
      method: isEditing ? "PUT" : "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(engineBody),
    });

    const data = (await res.json()) as unknown;
    return NextResponse.json(data, { status: res.status });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `engine unavailable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 503 }
    );
  }
}
