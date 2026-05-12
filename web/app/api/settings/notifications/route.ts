import { NextRequest } from "next/server";
import { checkAuth } from "@/lib/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Client-side notification settings format
interface NotificationChannelSetting {
  in_app: boolean;
  push: boolean;
  email: boolean;
  slack: boolean;
  webhook: boolean;
}

interface NotificationPreference {
  category: string;
  channels: NotificationChannelSetting;
}

interface NotificationSettings {
  enabled: boolean;
  preferences: NotificationPreference[];
  email: string;
  slackWebhookUrl?: string;
  webhookUrl?: string;
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  sound_enabled: boolean;
  desktop_enabled: boolean;
}

const defaultPreferences: NotificationPreference[] = [
  { category: "agent", channels: { in_app: true, push: true, email: false, slack: false, webhook: false } },
  { category: "chain", channels: { in_app: true, push: true, email: false, slack: false, webhook: false } },
  { category: "webhook", channels: { in_app: true, push: true, email: true, slack: false, webhook: false } },
  { category: "system", channels: { in_app: true, push: false, email: false, slack: false, webhook: false } },
];

const defaultSettings: NotificationSettings = {
  enabled: true,
  preferences: defaultPreferences,
  email: "",
  quiet_hours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  sound_enabled: true,
  desktop_enabled: false,
};

function getSettingsPath(namespaceId: string): string {
  return join(nsPath(namespaceId, "settings"), "notifications.json");
}

function loadSettings(namespaceId: string): NotificationSettings {
  const path = getSettingsPath(namespaceId);
  if (!existsSync(path)) return defaultSettings;
  try {
    const stored = JSON.parse(readFileSync(path, "utf-8"));
    return { ...defaultSettings, ...stored };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(namespaceId: string, settings: NotificationSettings): void {
  const dir = nsPath(namespaceId, "settings");
  mkdirSync(dir, { recursive: true });
  const path = getSettingsPath(namespaceId);
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
}

// GET /api/settings/notifications
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const settings = loadSettings(namespaceId);
  return apiSuccess(settings);
});

// POST /api/settings/notifications
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);

  const updates = await request.json();
  const current = loadSettings(namespaceId);

  const merged: NotificationSettings = {
    ...current,
    ...updates,
    preferences: updates.preferences ?? current.preferences,
    quiet_hours: updates.quiet_hours
      ? { ...current.quiet_hours, ...updates.quiet_hours }
      : current.quiet_hours,
  };

  saveSettings(namespaceId, merged);
  return apiSuccess(merged);
});
