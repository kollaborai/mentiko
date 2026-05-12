import { opsGet, opsPost } from "./ops-client.js";

export async function detectCliStatus() {
  const response = await opsGet("/api/mentiko-mcp/ops/system/cli-status");
  return response;
}

export async function startCliAuth(tool: string) {
  const response = await opsPost("/api/mentiko-mcp/ops/system/cli-auth", { tool });
  return response;
}

export async function pollCliAuth(sessionId: string) {
  const response = await opsGet(
    `/api/mentiko-mcp/ops/system/cli-auth?sessionId=${encodeURIComponent(sessionId)}`
  );
  return response;
}

export async function listSecrets() {
  const response = await opsGet("/api/mentiko-mcp/ops/secrets");
  return response;
}

export async function createSecret(
  name: string,
  envVar: string,
  value: string,
  description?: string
) {
  const response = await opsPost("/api/mentiko-mcp/ops/secrets", {
    name,
    envVar,
    value,
    description,
  });
  return response;
}
