import { existsSync, readFileSync, statSync } from "fs";
import { basename, extname, join, resolve } from "path";
import { NextRequest } from "next/server";
import { checkRunAccess } from "@/lib/auth/run-acl";
import { BadRequest, NotFound, Unauthorized } from "@/lib/api-errors";
import { apiSuccess, withErrorHandling } from "@/lib/api-response";
import { resolveLinkRunsDir } from "@/lib/links/link-run-runtime";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

const MAX_PREVIEW_BYTES = 256 * 1024;

function languageFor(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "javascript";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  if (ext === ".txt" || ext === ".log") return "text";
  return ext.replace(".", "") || "text";
}

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

  const requestedPath = request.nextUrl.searchParams.get("path");
  if (!requestedPath) {
    throw new BadRequest("Missing artifact path");
  }

  const artifactsRoot = resolve(join(runsDir, runId, "artifacts"));
  const resolvedPath = requestedPath.startsWith("/")
    ? resolve(requestedPath)
    : resolve(artifactsRoot, requestedPath);

  if (resolvedPath !== artifactsRoot && !resolvedPath.startsWith(`${artifactsRoot}/`)) {
    throw new BadRequest("Artifact path is outside this run");
  }

  if (!existsSync(resolvedPath)) {
    throw new NotFound("Artifact", basename(requestedPath));
  }

  const stats = statSync(resolvedPath);
  const raw = readFileSync(resolvedPath);
  const truncated = raw.byteLength > MAX_PREVIEW_BYTES;
  const preview = truncated ? raw.subarray(0, MAX_PREVIEW_BYTES) : raw;

  return apiSuccess({
    name: basename(resolvedPath),
    path: resolvedPath,
    size: stats.size,
    language: languageFor(resolvedPath),
    truncated,
    content: preview.toString("utf-8"),
  });
});
