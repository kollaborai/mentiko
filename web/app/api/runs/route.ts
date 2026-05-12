import { NextRequest } from "next/server";
import { readdirSync, readFileSync, existsSync, rmdirSync } from "fs";
import { join } from "path";
import { checkAuth } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth-bridge";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { listWorkspaces, checkWorkspaceAccess } from "@/lib/workspace-storage";
import { getRunTokenUsage } from "@/lib/token-store";
import { checkRunAccess, normalizeRunId } from "@/lib/run-acl";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";

export const dynamic = "force-dynamic";

interface RunAgent {
  id: string;
  name?: string;
  status: string;
  session: string;
}

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: RunAgent[];
  sessions: string[];
  totalCostCents?: number;
  totalCostDisplay?: string;
}

// GET /api/runs - list all runs
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { searchParams } = new URL(request.url);
  const chainId = searchParams.get("chain");
  const workspace = searchParams.get("workspace");
  const taskId = searchParams.get("task");
  const runIdFilter = searchParams.get("runId");
  const statusFilter = searchParams.get("status");
  const type = searchParams.get("type"); // "link" or "chain"
  const linkId = searchParams.get("linkId");
  const limit = parseInt(searchParams.get("limit") || "50");

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);

  // workspace ACL filter: resolve the current user and build a cache of
  // workspace access decisions so we don't reload each workspace per-run.
  // handles legacy runs with only workspacePath (not workspaceId) too.
  const session = await getSessionUser(request);
  const userId = session?.id;
  const allWorkspaces = listWorkspaces(namespaceId, orgId);
  const workspaceAccessCache = new Map<string, boolean>();
  function canSeeRun(run: { workspaceId?: string; workspacePath?: string }): boolean {
    if (!run.workspaceId && !run.workspacePath) return true; // legacy permissive
    if (!userId) return false;
    // resolve workspace record by id or by path
    const ws = run.workspaceId
      ? allWorkspaces.find((w) => w.id === run.workspaceId)
      : allWorkspaces.find((w) => w.path === run.workspacePath);
    if (!ws) return true; // workspace deleted/missing — permissive (same as checkRunAccess)
    const cacheKey = ws.id;
    const cached = workspaceAccessCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const ok = checkWorkspaceAccess(ws, userId);
    workspaceAccessCache.set(cacheKey, ok);
    return ok;
  }

  if (!existsSync(runsDir)) {
    return apiSuccess({ runs: [] });
  }

  const runs: Run[] = [];

  const entries = readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && normalizeRunId(d.name) !== null)
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  const hasFilters = !!(chainId || workspace || statusFilter || taskId || runIdFilter || type || linkId);

  for (const entry of entries) {
    // stop early if we have enough and no filters need full scan
    if (!hasFilters && runs.length >= limit) break;

    const runFile = join(runsDir, entry.name, "run.json");
    if (!existsSync(runFile)) continue;

    try {
      const content = readFileSync(runFile, "utf-8");
      const run: Run = JSON.parse(content);
      // ensure id is always set before filtering (some old run.json files omit it)
      if (!run.id) run.id = entry.name;

      if (runIdFilter && run.id !== runIdFilter && entry.name !== runIdFilter) {
        continue;
      }

      // workspace ACL: silently skip runs the user can't see
      const runAclInput = {
        workspaceId: (run as unknown as Record<string, unknown>).workspaceId as string | undefined,
        workspacePath: (run as unknown as Record<string, unknown>).workspacePath as string | undefined,
      };
      if (!canSeeRun(runAclInput)) continue;

      // filter by chain if specified
      if (chainId) {
        const runChainId = (run.chainId || run.chain.toLowerCase().replace(/\s+/g, "-"));
        if (runChainId !== chainId && run.chain !== chainId) {
          continue;
        }
      }

      // filter by workspace if specified
      if (workspace && !runIdFilter) {
        const runWs = (run as unknown as Record<string, unknown>).workspacePath as string | undefined;
        if (!runWs || runWs !== workspace) {
          continue;
        }
      }

      // filter by status if specified
      if (statusFilter && run.status !== statusFilter) {
        continue;
      }

      // filter by taskId if specified
      if (taskId) {
        const runTaskId = (run as unknown as Record<string, unknown>).taskId as string | undefined;
        if (runTaskId !== taskId) {
          continue;
        }
      }

      // filter by type if specified ("link" or "chain")
      if (type) {
        const runType = (run as unknown as Record<string, unknown>).type as string | undefined;
        if (runType !== type) {
          continue;
        }
      }

      // filter by linkId if specified
      if (linkId) {
        const runLinkId = (run as unknown as Record<string, unknown>).linkId as string | undefined;
        if (runLinkId !== linkId) {
          continue;
        }
      }

      // add cost data if available
      try {
        const costSummary = getRunTokenUsage(namespaceId, run.id);
        if (costSummary) {
          run.totalCostCents = costSummary.totalCostCents;
          run.totalCostDisplay = `$${(costSummary.totalCostCents / 100).toFixed(2)}`;
        }
      } catch {
        // ignore cost lookup failures
      }

      runs.push(run);

      // apply limit after filtering
      if (runs.length >= limit) break;
    } catch {
      // skip invalid json
    }
  }

  return apiSuccess({ runs });
});

// DELETE /api/runs - bulk delete runs
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json() as { ids?: string[] };
  const ids = body.ids || [];

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new BadRequest("No ids provided");
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  let deleted = 0;
  let denied = 0;

  for (const id of ids) {
    const runId = normalizeRunId(id, { allowBare: true });
    if (!runId) {
      denied++;
      continue;
    }

    // workspace ACL: user must have access to each run's workspace
    const acl = await checkRunAccess(request, runId, runsDir);
    if (!acl.ok) {
      if (acl.reason !== "run-not-found") denied++;
      continue;
    }

    const runDir = join(runsDir, runId);
    if (existsSync(runDir)) {
      rmdirSync(runDir, { recursive: true });
      deleted++;
    }
  }

  return apiSuccess({ deleted, denied });
});
