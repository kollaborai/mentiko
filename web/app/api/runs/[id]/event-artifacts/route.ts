import { existsSync, readFileSync } from "fs";
import { basename, join, resolve } from "path";
import { NextRequest } from "next/server";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { readExecutionRecords } from "@/lib/event-artifacts/event-artifact-ledger";
import { NotFound, Unauthorized } from "@/lib/api-errors";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const { id: runId } = await context.params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const runsDir = resolveLinkRunsDir(namespaceId, orgId);
  const acl = await checkRunAccess(request, runId, runsDir);
  if (!acl.ok) {
    if (acl.reason === "run-not-found") throw new NotFound("Run", runId);
    throw new Unauthorized();
  }

  const artifactsDir = join(runsDir, runId, "artifacts");
  const root = resolve(artifactsDir);
  const records = readExecutionRecords(artifactsDir);
  const latest = latestById(records).map((record) => ({
    id: record.id,
    mappingId: record.mappingId,
    event: record.event,
    status: record.status,
    artifactName: record.artifactPath ? basename(record.artifactPath) : null,
    draftTaskName: record.draftTaskPath ? basename(record.draftTaskPath) : null,
    artifact: readJsonUnderRoot(record.artifactPath, root),
    draftTask: readJsonUnderRoot(record.draftTaskPath, root),
    actionResults: record.actionResults || [],
    error: record.error || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }));

  return apiSuccess({ executions: latest });
});

function latestById<T extends { id: string }>(records: T[]): T[] {
  return Array.from(new Map(records.map((record) => [record.id, record])).values());
}

function readJsonUnderRoot(path: string | undefined, root: string): unknown | null {
  if (!path) return null;
  const resolved = resolve(path);
  if (!resolved.startsWith(`${root}/`)) return null;
  if (!existsSync(resolved)) return null;
  try {
    return JSON.parse(readFileSync(resolved, "utf8")) as unknown;
  } catch {
    return null;
  }
}
