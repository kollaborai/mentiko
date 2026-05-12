/**
 * Notification preferences — per-user, per-namespace, file-based persistence.
 * Stored in: namespaces/{ns}/notifications/{userId}.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { orgPath } from "@/lib/config";

export type NotificationChannel = "in_app" | "email" | "slack" | "webhook" | "push";

export interface NotificationChannelConfig {
  in_app: boolean;
  email: boolean;
  slack: boolean;
  webhook: boolean;
  push: boolean;
}

export interface NotificationCategory {
  category: "chain" | "agent" | "approval" | "budget" | "system";
  label: string;
  channels: NotificationChannelConfig;
}

export interface NotificationPreferences {
  userId: string;
  enabled: boolean;
  categories: NotificationCategory[];
  /** email for notification delivery */
  email?: string;
  /** Slack webhook URL for notification delivery */
  slackWebhookUrl?: string;
  /** Generic webhook URL for notification delivery */
  webhookUrl?: string;
  /** Budget threshold in USD cents; 0 = disabled */
  budgetAlertThresholdCents: number;
  quietHours: {
    enabled: boolean;
    start: string; // HH:MM
    end: string;   // HH:MM
    timezone: string;
  };
  updatedAt: string;
}

export const DEFAULT_CATEGORIES: NotificationCategory[] = [
  {
    category: "chain",
    label: "Chain events",
    channels: { in_app: true, email: false, slack: false, webhook: false, push: false },
  },
  {
    category: "agent",
    label: "Agent events",
    channels: { in_app: true, email: false, slack: false, webhook: false, push: false },
  },
  {
    category: "approval",
    label: "Approval requests",
    channels: { in_app: true, email: true, slack: false, webhook: false, push: false },
  },
  {
    category: "budget",
    label: "Budget alerts",
    channels: { in_app: true, email: true, slack: false, webhook: false, push: false },
  },
  {
    category: "system",
    label: "System alerts",
    channels: { in_app: true, email: false, slack: false, webhook: false, push: false },
  },
];

export function defaultPrefs(userId: string): NotificationPreferences {
  return {
    userId,
    enabled: true,
    categories: DEFAULT_CATEGORIES,
    budgetAlertThresholdCents: 0,
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "08:00",
      timezone: "UTC",
    },
    updatedAt: new Date().toISOString(),
  };
}

function getPrefsDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "notifications");
}

function getPrefsPath(namespaceId: string, orgId: string, userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getPrefsDir(namespaceId, orgId), `${safe}.json`);
}

export function loadPrefs(namespaceId: string, orgId: string, userId: string): NotificationPreferences {
  const path = getPrefsPath(namespaceId, orgId, userId);
  if (!existsSync(path)) return defaultPrefs(userId);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as NotificationPreferences;
  } catch {
    return defaultPrefs(userId);
  }
}

export function savePrefs(namespaceId: string, orgId: string, prefs: NotificationPreferences): void {
  const dir = getPrefsDir(namespaceId, orgId);
  mkdirSync(dir, { recursive: true });
  const path = getPrefsPath(namespaceId, orgId, prefs.userId);
  prefs.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(prefs, null, 2), "utf-8");
}

/**
 * isInQuietHours: check if current time is in quiet hours for given prefs.
 */
export function isInQuietHours(prefs: NotificationPreferences): boolean {
  if (!prefs.quietHours.enabled) return false;
  const now = new Date();
  const [startH, startM] = prefs.quietHours.start.split(":").map(Number);
  const [endH, endM] = prefs.quietHours.end.split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = startH * 60 + startM;
  const endMins = endH * 60 + endM;
  if (startMins < endMins) {
    return nowMins >= startMins && nowMins < endMins;
  }
  // wraps midnight
  return nowMins >= startMins || nowMins < endMins;
}
