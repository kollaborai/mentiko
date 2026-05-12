import { opsGet, opsPost } from "./ops-client.js";

export async function getUserContext() {
  return await opsGet("/api/mentiko-mcp/ops/context/user");
}

export async function getActiveWorkspace() {
  return await opsGet("/api/mentiko-mcp/ops/context/workspace");
}

export async function getRecentActivity() {
  return await opsGet("/api/mentiko-mcp/ops/context/activity");
}

export async function listWorkspaces() {
  return await opsGet("/api/mentiko-mcp/ops/context/workspaces");
}

export async function startRun(
  chainId: string,
  task?: string,
  workspaceId?: string,
) {
  return await opsPost("/api/mentiko-mcp/ops/context/runs", {
    chainId,
    task,
    workspaceId,
  }) as { runId: string };
}

export async function cancelRun(runId: string) {
  return await opsPost("/api/mentiko-mcp/ops/context/runs/cancel", { runId });
}
