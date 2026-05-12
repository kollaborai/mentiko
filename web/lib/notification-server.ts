/**
 * Server-side notification creation utility.
 * Used by API routes to create notifications without HTTP round-trips.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";

export interface ServerNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata?: Record<string, unknown>;
}

const MAX_NOTIFICATIONS = 200;

function getNotificationsFile(namespaceId: string): string {
  const notifDir = nsPath(namespaceId, "notifications");
  if (!existsSync(notifDir)) {
    mkdirSync(notifDir, { recursive: true });
  }
  return join(notifDir, "notifications.json");
}

function loadNotifications(namespaceId: string): ServerNotification[] {
  const file = getNotificationsFile(namespaceId);
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function saveNotifications(namespaceId: string, notifications: ServerNotification[]): void {
  const file = getNotificationsFile(namespaceId);
  const dir = join(file, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, JSON.stringify(notifications, null, 2));
}

/**
 * Create a notification and persist it to the namespace store.
 * Fire-and-forget safe - catches all errors internally.
 */
export function createNotification(
  namespaceId: string,
  opts: {
    type: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }
): void {
  try {
    const notifications = loadNotifications(namespaceId);
    const notification: ServerNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: opts.type,
      title: opts.title,
      message: opts.message,
      timestamp: new Date().toISOString(),
      read: false,
      metadata: opts.metadata,
    };
    notifications.unshift(notification);
    if (notifications.length > MAX_NOTIFICATIONS) {
      notifications.splice(MAX_NOTIFICATIONS);
    }
    saveNotifications(namespaceId, notifications);
  } catch {
    // notification creation should never break the calling code
  }
}
