/**
 * notifications.ts
 *
 * MCP handlers for notification preferences management.
 */

import { opsGet, opsPost } from "./ops-client.js";

// Notification preference shape — mirrors web/lib/notification-prefs.ts.
// Kept local so this package has no cross-project alias dependencies.
// Source of truth is the platform's HTTP API; this type is a structural
// contract for the handler signatures only.
interface NotificationChannelConfig {
  in_app: boolean;
  email: boolean;
  slack: boolean;
  webhook: boolean;
  push: boolean;
}
interface NotificationCategory {
  category: "chain" | "agent" | "approval" | "budget" | "system";
  label: string;
  channels: NotificationChannelConfig;
}
interface NotificationPreferences {
  userId: string;
  enabled: boolean;
  categories: NotificationCategory[];
  email?: string;
  slackWebhookUrl?: string;
  webhookUrl?: string;
  budgetAlertThresholdCents: number;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
  updatedAt: string;
}

export async function getNotificationPrefs(): Promise<NotificationPreferences> {
  return await opsGet("/api/mentiko-mcp/ops/notifications/prefs");
}

export async function setNotificationPrefs(
  updates: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  return await opsPost("/api/mentiko-mcp/ops/notifications/prefs", updates);
}
