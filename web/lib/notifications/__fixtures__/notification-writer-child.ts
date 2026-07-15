import { createNotification } from "@/lib/notifications/notification-server";

const namespaceId = process.argv[2];
const idempotencyKey = process.argv[3];

if (!namespaceId || !idempotencyKey) {
  throw new Error("usage: notification-writer-child <namespace-id> <idempotency-key>");
}

createNotification(namespaceId, {
  type: "info",
  title: `Notification ${idempotencyKey}`,
  message: "concurrent writer fixture",
  idempotencyKey,
});
