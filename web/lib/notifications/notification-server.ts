/**
 * Server-side notification creation utility.
 * Used by API routes to create notifications without HTTP round-trips.
 */
import {
  addNotification,
  type NotificationMetadata,
  type PersistedNotification,
} from "@/lib/notifications/notification-persistence";

export type ServerNotification = PersistedNotification;

/**
 * Create a notification and persist it to the namespace store. Persistence
 * failures intentionally propagate so callers cannot report a false success.
 */
export function createNotification(
  namespaceId: string,
  opts: {
    type: string;
    title: string;
    message: string;
    metadata?: NotificationMetadata;
    idempotencyKey?: string;
  }
): ServerNotification {
  return addNotification(namespaceId, opts);
}
