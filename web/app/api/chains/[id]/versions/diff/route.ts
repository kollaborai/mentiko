import { NextRequest } from "next/server";
import { readFileSync, existsSync } from "fs";
import { orgPath } from "@/lib/config";
import { Unauthorized, BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

interface DiffChange {
  path: string;
  type: "added" | "removed" | "modified" | "unchanged";
  oldValue?: unknown;
  newValue?: unknown;
}

interface DiffResult {
  fromVersion: string;
  toVersion: string;
  changes: DiffChange[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

function getObjectDiff(obj1: Record<string, unknown> | null, obj2: Record<string, unknown> | null, path = ""): DiffChange[] {
  const changes: DiffChange[] = [];
  const keys1 = obj1 ? Object.keys(obj1) : [];
  const keys2 = obj2 ? Object.keys(obj2) : [];
  const allKeys = new Set([...keys1, ...keys2]);

  for (const key of allKeys) {
    const currentPath = path ? `${path}.${key}` : key;
    const val1 = obj1?.[key];
    const val2 = obj2?.[key];

    if (!obj1 || !(key in obj1)) {
      changes.push({ path: currentPath, type: "added", newValue: val2 });
    } else if (!obj2 || !(key in obj2)) {
      changes.push({ path: currentPath, type: "removed", oldValue: val1 });
    } else if (JSON.stringify(val1) !== JSON.stringify(val2)) {
      if (typeof val1 === "object" && typeof val2 === "object" && val1 !== null && val2 !== null) {
        if (!Array.isArray(val1) && !Array.isArray(val2)) {
          changes.push(...getObjectDiff(val1 as Record<string, unknown> | null, val2 as Record<string, unknown> | null, currentPath));
        } else {
          changes.push({ path: currentPath, type: "modified", oldValue: val1, newValue: val2 });
        }
      } else {
        changes.push({ path: currentPath, type: "modified", oldValue: val1, newValue: val2 });
      }
    } else {
      changes.push({ path: currentPath, type: "unchanged", oldValue: val1 });
    }
  }

  return changes;
}

export const GET = withErrorHandling(async (
  request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await _context.params;
  const chainId = decodeURIComponent(id);
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);

  const { searchParams } = new URL(request.url);
  const fromVersion = searchParams.get("from");
  const toVersion = searchParams.get("to");

  if (!fromVersion || !toVersion) {
    throw new BadRequest("from and to versions required");
  }

  const fromPath = orgPath(namespaceId, orgId, "agents", "versions", chainId, `${fromVersion}.json`);
  const toPath = orgPath(namespaceId, orgId, "agents", "versions", chainId, `${toVersion}.json`);

  if (!existsSync(fromPath) || !existsSync(toPath)) {
    throw new NotFound("One or both versions not found");
  }

  const fromChain = JSON.parse(readFileSync(fromPath, "utf-8"));
  const toChain = JSON.parse(readFileSync(toPath, "utf-8"));

  const changes = getObjectDiff(fromChain, toChain);

  const summary = {
    added: changes.filter((c) => c.type === "added").length,
    removed: changes.filter((c) => c.type === "removed").length,
    modified: changes.filter((c) => c.type === "modified").length,
    unchanged: changes.filter((c) => c.type === "unchanged").length,
  };

  const result: DiffResult = {
    fromVersion,
    toVersion,
    changes,
    summary,
  };

  return apiSuccess(result);
});
