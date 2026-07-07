import { readSystemSettings } from "@/lib/system/system-settings";
import { getWorkspace, resolveAutoRun } from "@/lib/workspaces/workspace-storage";

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
  const workspace = getWorkspace(input.namespaceId, input.orgId, input.workspacePath);
  if (!workspace) {
    return false;
  }
  const settings = readSystemSettings(input.namespaceId);
  return resolveAutoRun(workspace, settings.auto_run_enabled);
}
