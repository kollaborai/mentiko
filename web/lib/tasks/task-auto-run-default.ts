import { readSystemSettings } from "@/lib/system/system-settings";
import { getWorkspace, listWorkspaces, resolveAutoRun } from "@/lib/workspaces/workspace-storage";

// getWorkspace() only matches Workspace.id, but callers here (task.workspace_id
// / the `?workspace=` param) usually hand in a filesystem PATH, not the id
// slug -- so an id-only lookup silently misses and auto-run defaults to off
// for every path-hydrated task. Try the id match first (fast path, and keeps
// existing id-based callers working), then fall back to a path match.
function findWorkspaceByIdOrPath(namespaceId: string, orgId: string, idOrPath: string) {
  const byId = getWorkspace(namespaceId, orgId, idOrPath);
  if (byId) return byId;
  return listWorkspaces(namespaceId, orgId).find((w) => w.path === idOrPath) ?? null;
}

export function resolveTaskAutoRunDefault(input: {
  namespaceId: string;
  orgId: string;
  workspacePath?: string | null;
  explicitAutoRun?: boolean;
}): boolean {
  if (typeof input.explicitAutoRun === "boolean") {
    return input.explicitAutoRun;
  }
  if (!input.workspacePath) {
    return false;
  }
  const workspace = findWorkspaceByIdOrPath(input.namespaceId, input.orgId, input.workspacePath);
  if (!workspace) {
    return false;
  }
  const settings = readSystemSettings(input.namespaceId);
  return resolveAutoRun(workspace, settings.auto_run_enabled);
}
