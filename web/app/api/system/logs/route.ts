import { NextRequest } from "next/server";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import { readLogs, writeLog } from "@/lib/system-logger";
import type { LogLevel } from "@/lib/system-logger";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") || "200", 10);
  const level = searchParams.get("level") as LogLevel | null;
  const source = searchParams.get("source");

  let entries = readLogs(namespaceId, orgId, limit);
  if (level) entries = entries.filter((e) => e.level === level);
  if (source) entries = entries.filter((e) => e.source === source);

  return apiSuccess({ logs: entries });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const orgId = await getOrgIdFromRequest(request);
  const { level, source, message, detail } = await request.json();
  if (!level || !source || !message) {
    throw new BadRequest("level, source, message required");
  }
  writeLog(namespaceId, orgId, level as LogLevel, source, message, detail);
  return apiSuccess({ ok: true });
});
