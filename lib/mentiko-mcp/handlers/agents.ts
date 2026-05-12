import { opsGet, opsPost } from "./ops-client.js";

export async function listAgents(_scope?: string) {
  return await opsGet("/api/mentiko-mcp/ops/agents");
}

export async function createAgent(
  name: string,
  prompt: string,
  profile?: string,
) {
  return await opsPost("/api/mentiko-mcp/ops/agents", { name, prompt, profile });
}
