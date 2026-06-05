import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

interface DataRetentionSettings {
  run_history: string;
  event_logs: string;
  audit_logs: string;
}

const defaultSettings: DataRetentionSettings = {
  run_history: "indefinitely",
  event_logs: "30d",
  audit_logs: "90d",
};

function getSettingsPath(namespaceId: string): string {
  return join(nsPath(namespaceId, "settings"), "data.json");
}

function loadSettings(namespaceId: string): DataRetentionSettings {
  const path = getSettingsPath(namespaceId);
  if (!existsSync(path)) return defaultSettings;
  try {
    return { ...defaultSettings, ...JSON.parse(readFileSync(path, "utf-8")) };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(namespaceId: string, settings: DataRetentionSettings): void {
  const dir = nsPath(namespaceId, "settings");
  mkdirSync(dir, { recursive: true });
  writeFileSync(getSettingsPath(namespaceId), JSON.stringify(settings, null, 2), "utf-8");
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  return apiSuccess({ settings: loadSettings(namespaceId) });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }
  const namespaceId = await getNamespaceIdFromRequest(request);
  const updates = await request.json();
  const current = loadSettings(namespaceId);
  const merged: DataRetentionSettings = { ...current, ...updates };
  saveSettings(namespaceId, merged);
  return apiSuccess({ settings: merged });
});
