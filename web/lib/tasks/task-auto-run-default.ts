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

export interface AutoRunPolicyInput {
  namespaceId: string;
  orgId: string;
  workspacePath?: string | null;
  explicitAutoRun?: boolean;
}

/**
 * Where the resolved auto-run value came from. Chain-contract Track C (task
 * producer parity): the creation response must report the EFFECTIVE policy,
 * not just the requested value, so a caller can tell "you asked for nothing
 * and got workspace default ON" apart from "you explicitly asked for ON".
 */
export type AutoRunPolicySource =
  | "explicit"           // caller passed an explicit true/false
  | "workspace_override" // workspace.auto_run is "enabled" or "disabled"
  | "system_default"     // workspace.auto_run is "inherit"/unset -> system setting
  | "unscoped";          // no resolvable workspace -> hardcoded false

export interface AutoRunPolicy {
  enabled: boolean;
  source: AutoRunPolicySource;
}

// Single algorithm both resolveTaskAutoRunDefault (existing boolean-only
// callers) and resolveTaskAutoRunPolicy (Track C: needs provenance) run
// through, so there is exactly one place the fallthrough order lives.
function resolvePolicy(input: AutoRunPolicyInput): AutoRunPolicy {
  if (typeof input.explicitAutoRun === "boolean") {
    return { enabled: input.explicitAutoRun, source: "explicit" };
  }
  if (!input.workspacePath) {
    return { enabled: false, source: "unscoped" };
  }
  const workspace = findWorkspaceByIdOrPath(input.namespaceId, input.orgId, input.workspacePath);
  if (!workspace) {
    return { enabled: false, source: "unscoped" };
  }
  const settings = readSystemSettings(input.namespaceId);
  const enabled = resolveAutoRun(workspace, settings.auto_run_enabled);
  const source: AutoRunPolicySource =
    workspace.auto_run === "enabled" || workspace.auto_run === "disabled"
      ? "workspace_override"
      : "system_default";
  return { enabled, source };
}

export function resolveTaskAutoRunDefault(input: {
  namespaceId: string;
  orgId: string;
  workspacePath?: string | null;
  explicitAutoRun?: boolean;
}): boolean {
  return resolvePolicy(input).enabled;
}

/**
 * Same resolution as resolveTaskAutoRunDefault, but returns the provenance
 * alongside the value. Used by task-creation-service.ts so the creation
 * response can report the effective policy (C3) instead of only the
 * requested value. Do not re-derive this boolean anywhere else — both UI and
 * MCP task creation must resolve through this one function.
 */
export function resolveTaskAutoRunPolicy(input: AutoRunPolicyInput): AutoRunPolicy {
  return resolvePolicy(input);
}
