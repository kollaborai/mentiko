/**
 * Run-level ACL helper — RBAC-2.
 *
 * Centralizes the "can this authenticated user see/mutate this run?" check
 * used by /api/runs/* routes. Reads the run's workspaceId, loads the
 * workspace record, and delegates to checkWorkspaceAccess.
 *
 * Callers should throw Unauthorized when !ok is returned (for single-run
 * endpoints) or use filterRunsByAccess for list endpoints.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import config from "@/lib/config";
import { getSessionUser } from "@/lib/auth/auth-bridge";
import {
  getNamespaceIdFromRequest,
  getOrgIdFromRequest,
} from "@/lib/namespace-config";
import { getWorkspace, listWorkspaces, checkWorkspaceAccess, type Workspace } from "@/lib/workspaces/workspace-storage";

const SAFE_RUN_ID_RE = /^run-[A-Za-z0-9_-]{1,120}$/;

export interface RunAclResult {
  ok: boolean;
  reason?: "not-authenticated" | "run-not-found" | "no-workspace" | "denied";
  userId?: string;
  workspaceId?: string;
}

// minimal run shape we care about — avoid importing the full type just for this.
interface RunSummary {
  id?: string;
  workspaceId?: string;
  // legacy runs: some code paths (web /api/chains/run) only persist workspacePath.
  // resolve to a workspace record by path as a fallback.
  workspacePath?: string;
}

export function normalizeRunId(value: unknown, { allowBare = false } = {}): string | null {
  if (typeof value !== "string") return null;
  if (value !== value.trim()) return null;
  const runId = allowBare && !value.startsWith("run-") ? `run-${value}` : value;
  return SAFE_RUN_ID_RE.test(runId) ? runId : null;
}

function resolveWorkspace(
  namespaceId: string,
  orgId: string,
  run: RunSummary
): Workspace | null {
  if (run.workspaceId) return getWorkspace(namespaceId, orgId, run.workspaceId);
  if (run.workspacePath) {
    return (
      listWorkspaces(namespaceId, orgId).find((w) => w.path === run.workspacePath) ?? null
    );
  }
  return null;
}

function readRun(runId: string, runsDir = config.runsDir): RunSummary | null {
  const safeRunId = normalizeRunId(runId);
  if (!safeRunId) return null;

  const runJsonPath = join(runsDir, safeRunId, "run.json");
  if (!existsSync(runJsonPath)) return null;
  try {
    return JSON.parse(readFileSync(runJsonPath, "utf-8"));
  } catch {
    return null;
  }
}

export function checkRunAccessForUser(
  namespaceId: string,
  orgId: string,
  userId: string | undefined,
  runId: string,
  runsDir = config.runsDir,
): RunAclResult {
  if (!userId) {
    return { ok: false, reason: "not-authenticated" };
  }

  const run = readRun(runId, runsDir);
  if (!run) {
    return { ok: false, reason: "run-not-found", userId };
  }

  if (!run.workspaceId && !run.workspacePath) {
    return { ok: true, userId };
  }

  const workspace = resolveWorkspace(namespaceId, orgId, run);
  if (!workspace) {
    return {
      ok: true,
      userId,
      workspaceId: run.workspaceId,
    };
  }

  const ok = checkWorkspaceAccess(workspace, userId);
  return {
    ok,
    reason: ok ? undefined : "denied",
    userId,
    workspaceId: workspace.id,
  };
}

/**
 * Check whether the authenticated user has access to a specific run.
 * Caller should short-circuit on !ok.
 */
export async function checkRunAccess(
  request: Request,
  runId: string,
  runsDir = config.runsDir
): Promise<RunAclResult> {
  const session = await getSessionUser(request);
  const userId = session?.id;
  if (!userId) {
    return { ok: false, reason: "not-authenticated" };
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  return checkRunAccessForUser(namespaceId, orgId, userId, runId, runsDir);
}

/**
 * Iterate run IDs and return only the ones the user has access to.
 * Used by list endpoints — list-type routes should filter silently, not
 * throw on denied.
 */
export async function filterRunsByAccess(
  request: Request,
  runIds: string[],
  runsDir = config.runsDir
): Promise<string[]> {
  const session = await getSessionUser(request);
  const userId = session?.id;
  if (!userId) return [];

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const allowed: string[] = [];
  for (const runId of runIds) {
    const safeRunId = normalizeRunId(runId);
    if (!safeRunId) continue;

    const run = readRun(safeRunId, runsDir);
    if (!run) continue;
    if (!run.workspaceId && !run.workspacePath) {
      allowed.push(safeRunId);
      continue;
    }
    const workspace = resolveWorkspace(namespaceId, orgId, run);
    if (!workspace || checkWorkspaceAccess(workspace, userId)) {
      allowed.push(safeRunId);
    }
  }
  return allowed;
}

/** Enumerate all runs on disk (helper for list endpoints that don't already). */
export function listAllRunIds(runsDir = config.runsDir): string[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir).filter((d) => normalizeRunId(d) !== null);
}
