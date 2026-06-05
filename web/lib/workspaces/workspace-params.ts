// Workspace parameter extraction from request URLs.

import { existsSync } from "fs";

export function getWorkspaceId(request: { url: string }): string | undefined {
  const { searchParams } = new URL(request.url);
  const workspace = searchParams.get("workspace");
  if (!workspace) return undefined;
  if (workspace.includes("..") || workspace.includes("\0")) return undefined;
  return workspace;
}

export function getWorkspacePath(request: { url: string }): string | undefined {
  return getWorkspaceId(request);
}

export function hasWorkspaceParam(request: { url: string }): boolean {
  const { searchParams } = new URL(request.url);
  return !!searchParams.get("workspace");
}

export function getWorkspaceCwd(request: { url: string }): string | undefined {
  const workspace = getWorkspaceId(request);
  if (!workspace) return undefined;
  if (existsSync(workspace)) return workspace;
  return undefined;
}
