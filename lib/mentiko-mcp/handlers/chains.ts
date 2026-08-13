import { opsDelete, opsGet, opsPatch, opsPost } from "./ops-client.js";

export async function getCurrentPage() {
  return await opsGet<{ page: { pathname: string; search: string; label?: string; updatedAt: number } | null }>(
    "/api/mentiko-mcp/current-page",
  );
}

export async function listChains(id?: string) {
  return await opsGet(
    id
      ? `/api/mentiko-mcp/ops/chains?id=${encodeURIComponent(id)}`
      : "/api/mentiko-mcp/ops/chains",
  );
}

export async function createChainDraft(name: string, template?: string) {
  return await opsPost("/api/mentiko-mcp/ops/chains", { name, template });
}

export async function saveChainJson(
  name: string,
  chain: Record<string, unknown>,
  overwrite: boolean = false,
) {
  return await opsPost("/api/mentiko-mcp/ops/chains", {
    name,
    chain,
    overwrite,
  });
}

export async function renameChain(id: string, name: string) {
  return await opsPatch("/api/mentiko-mcp/ops/chains", { id, name });
}

export async function deleteChain(id: string) {
  return await opsDelete("/api/mentiko-mcp/ops/chains", { id });
}

export async function attachAgent(
  chainId: string,
  agentId: string,
  position?: number,
) {
  return await opsPatch("/api/mentiko-mcp/ops/chains", {
    action: "attach_agent",
    chainId,
    agentId,
    position,
  }) as { chainId: string; agentId: string; agentCount: number };
}

export async function detachAgent(chainId: string, agentId: string) {
  return await opsPatch("/api/mentiko-mcp/ops/chains", {
    action: "detach_agent",
    chainId,
    agentId,
  }) as { chainId: string; agentId: string; agentCount: number };
}
