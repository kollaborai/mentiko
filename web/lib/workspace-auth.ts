import { listWorkspaces, checkWorkspaceAccess } from "@/lib/workspace-storage";

function cleanWorkspaceRef(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("\0")) return undefined;
  return trimmed;
}

export function resolveAuthorizedWorkspacePath(
  namespaceId: string,
  orgId: string,
  workspaceRef: unknown,
  userId?: string
): string | undefined {
  const requested = cleanWorkspaceRef(workspaceRef);
  if (!requested) return undefined;

  const workspace = listWorkspaces(namespaceId, orgId).find(
    (w) => w.id === requested || w.path === requested
  );
  if (!workspace?.path) return undefined;
  if (userId && !checkWorkspaceAccess(workspace, userId)) return undefined;
  if (!userId && workspace.members && workspace.members.length > 0) return undefined;
  return workspace.path;
}
