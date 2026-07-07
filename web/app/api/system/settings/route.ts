import { NextRequest } from "next/server";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { checkAuth } from "@/lib/auth/api-auth";
import { readSystemSettings, writeSystemSettings as writeSettings, type SystemSettings } from "@/lib/system/system-settings";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";

export const dynamic = "force-dynamic";

export type { SystemSettings };

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  return apiSuccess({ settings: readSystemSettings(namespaceId) });
});

export const PUT = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const namespaceId = await getNamespaceIdFromRequest(request);
  const current = readSystemSettings(namespaceId);
  const updated: SystemSettings = {
    max_concurrent_runs:
      typeof body.max_concurrent_runs === "number"
        ? Math.max(1, Math.min(50, body.max_concurrent_runs))
        : current.max_concurrent_runs,
    auto_run_enabled:
      typeof body.auto_run_enabled === "boolean"
        ? body.auto_run_enabled
        : current.auto_run_enabled,
  };

  writeSettings(updated, namespaceId);
  return apiSuccess({ settings: updated });
});
