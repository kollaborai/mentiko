import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { orgPath } from "../config";
import type { TaskProviderConfig } from "../task-provider/types";

export interface WorkspaceExecution {
  type: "local" | "ssh" | "docker";
  ssh?: {
    host: string;
    user: string;
    path: string;
    key?: string;
    port?: number;
  };
  docker?: {
    container: string;
    path?: string;
    user?: string;
  };
}

export interface WorkspaceModel {
  cli?: string;       // e.g. 'cc', 'claude'
  model?: string;
  cli_args?: string[];
}

export interface WorkspaceProject {
  /** git remote URL (https or ssh) */
  gitUrl?: string;
  /** default branch to check out (overrides workspace default_branch) */
  branch?: string;
  /** chain ID to run by default for this project */
  defaultChain?: string;
}

/** Per-workspace auto-run override. "inherit" uses system default. */
export type WorkspaceAutoRun = "enabled" | "disabled" | "inherit";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  icon?: string;
  description?: string;
  addedAt: string;
  execution?: WorkspaceExecution;
  model?: WorkspaceModel;
  env?: Record<string, string>;
  max_agents?: number;
  max_rounds?: number;
  default_branch?: string;
  default_agent_profile?: string;
  project?: WorkspaceProject;
  /** User IDs who have access to this workspace. Empty array = owner-only access. */
  members?: string[];
  /** Per-workspace task provider config. If absent, defaults to native SQLite provider. */
  taskProvider?: TaskProviderConfig;
  /** Per-workspace auto-run override. Defaults to "inherit" (uses system setting). */
  auto_run?: WorkspaceAutoRun;
  /**
   * When enabled, the recommendation for a decision in this workspace is selected
   * and its generated plan is approved without waiting for a browser action.
   * Absent is deliberately false so existing workspaces keep their human gate.
   */
  auto_approve_decisions?: boolean;
}

function getWorkspacesFile(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "workspaces.json");
}

export function listWorkspaces(namespaceId: string, orgId: string): Workspace[] {
  const file = getWorkspacesFile(namespaceId, orgId);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

export function getWorkspace(namespaceId: string, orgId: string, workspaceId: string): Workspace | null {
  return listWorkspaces(namespaceId, orgId).find((w) => w.id === workspaceId) ?? null;
}

export function addWorkspace(namespaceId: string, orgId: string, workspace: Workspace): void {
  const file = getWorkspacesFile(namespaceId, orgId);
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const workspaces = listWorkspaces(namespaceId, orgId);
  if (workspaces.some((w) => w.id === workspace.id)) {
    throw new Error(`Workspace '${workspace.id}' already exists`);
  }
  workspaces.push(workspace);
  writeFileSync(file, JSON.stringify(workspaces, null, 2));
}

export function updateWorkspace(
  namespaceId: string,
  orgId: string,
  workspaceId: string,
  updates: Partial<Omit<Workspace, "id" | "addedAt">>
): Workspace {
  const file = getWorkspacesFile(namespaceId, orgId);
  const workspaces = listWorkspaces(namespaceId, orgId);
  const idx = workspaces.findIndex((w) => w.id === workspaceId);
  if (idx === -1) throw new Error(`Workspace '${workspaceId}' not found`);
  workspaces[idx] = { ...workspaces[idx], ...updates };
  writeFileSync(file, JSON.stringify(workspaces, null, 2));
  return workspaces[idx];
}

export function removeWorkspace(namespaceId: string, orgId: string, workspaceId: string): void {
  const file = getWorkspacesFile(namespaceId, orgId);
  const workspaces = listWorkspaces(namespaceId, orgId);
  const filtered = workspaces.filter((w) => w.id !== workspaceId);
  if (filtered.length === workspaces.length) {
    throw new Error(`Workspace '${workspaceId}' not found`);
  }
  writeFileSync(file, JSON.stringify(filtered, null, 2));
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// auto-run resolution
// ---------------------------------------------------------------------------

/**
 * resolve whether auto-run is enabled for a workspace.
 * priority: workspace override > system default.
 * "inherit" or undefined falls through to system default.
 */
export function resolveAutoRun(
  workspace: Workspace,
  systemDefault: boolean
): boolean {
  if (workspace.auto_run === "enabled") return true;
  if (workspace.auto_run === "disabled") return false;
  // "inherit" or undefined → use system default
  return systemDefault;
}

/**
 * Decision approval is workspace-scoped and opt-in. Unlike task auto-run, there
 * is no system-level default: a missing setting must retain the human gate.
 */
export function resolveDecisionAutoApprove(workspace: Workspace | null | undefined): boolean {
  return workspace?.auto_approve_decisions === true;
}

/**
 * check if user has access to workspace (owner or member)
 * returns true if user is in members array or if members is empty (backward compat)
 */
export function checkWorkspaceAccess(workspace: Workspace, userId: string): boolean {
  // backward compatibility: workspaces without members array are accessible to all users in the org
  if (!workspace.members || workspace.members.length === 0) {
    return true;
  }
  // check if user is in members list
  return workspace.members.includes(userId);
}

/**
 * migrate existing workspaces: add auto_run="inherit" where missing.
 * returns count of migrated workspaces.
 */
export function migrateAutoRun(namespaceId: string, orgId: string): number {
  const file = getWorkspacesFile(namespaceId, orgId);
  if (!existsSync(file)) return 0;

  let workspaces: Workspace[];
  try {
    workspaces = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return 0;
  }

  let migrated = 0;
  for (const ws of workspaces) {
    if (!ws.auto_run) {
      ws.auto_run = "inherit";
      migrated++;
    }
  }

  if (migrated > 0) {
    writeFileSync(file, JSON.stringify(workspaces, null, 2));
  }

  return migrated;
}
