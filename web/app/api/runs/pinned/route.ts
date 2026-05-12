import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/api-auth";
import { checkRunAccess, filterRunsByAccess } from "@/lib/run-acl";
import { BadRequest, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { resolveLinkRunsDir } from "@/lib/link-run-runtime";

export const dynamic = "force-dynamic";

function getPinnedFile(namespaceId: string): string {
  const settingsDir = nsPath(namespaceId, "settings");
  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }
  return join(settingsDir, "pinned-runs.json");
}

function loadPinned(namespaceId: string): string[] {
  const file = getPinnedFile(namespaceId);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function savePinned(namespaceId: string, ids: string[]): void {
  writeFileSync(getPinnedFile(namespaceId), JSON.stringify(ids, null, 2));
}

// GET /api/runs/pinned
// NOTE: the pinned-runs list is namespace-wide storage, but the response is
// filtered to only runs the user can access via filterRunsByAccess.
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(nsId, orgId);
  const rawPinned = loadPinned(nsId);
  const pinned = await filterRunsByAccess(request, rawPinned, runsDir);
  return apiSuccess({ pinned });
});

// POST /api/runs/pinned  { id: string }
// User can only pin runs they have access to.
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const nsId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(nsId, orgId);
  const { id } = await request.json();
  if (!id) throw new BadRequest("id required", { field: "id" });

  const acl = await checkRunAccess(request, id, runsDir);
  if (!acl.ok) {
    throw new Unauthorized();
  }

  const pinned = loadPinned(nsId);
  if (!pinned.includes(id)) {
    pinned.unshift(id);
    savePinned(nsId, pinned);
  }
  return apiSuccess({ pinned });
});

// DELETE /api/runs/pinned  { id: string }
// NOTE: no workspace ACL needed — unpinning is idempotent and never reveals
// information about the run. worst case, a user unpins a run they can't see.
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const nsId = await getNamespaceIdFromRequest(request);
  const { id } = await request.json();
  if (!id) throw new BadRequest("id required", { field: "id" });

  const pinned = loadPinned(nsId).filter((p) => p !== id);
  savePinned(nsId, pinned);
  return apiSuccess({ pinned });
});
