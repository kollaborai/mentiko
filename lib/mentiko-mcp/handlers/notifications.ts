/**
 * notifications.ts
 *
 * MCP handlers for notification preferences management.
 */

import { opsGet, opsPost } from "./ops-client.js";
import { NotificationPreferences } from "@/lib/notification-prefs";

export async function getNotificationPrefs(): Promise<NotificationPreferences> {
  return await opsGet("/api/mentiko-mcp/ops/notifications/prefs");
}

export async function setNotificationPrefs(
  updates: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  return await opsPost("/api/mentiko-mcp/ops/notifications/prefs", updates);
}
