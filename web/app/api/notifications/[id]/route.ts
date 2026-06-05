import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

interface Notification {
  id: string;
  type: "agent_complete" | "agent_error" | "chain_complete" | "chain_failed" |
        "webhook_failed" | "webhook_delivered" | "chain_started" |
        "job_complete" | "job_failed" | "info" | "warning" | "error";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata?: {
    agentId?: string;
    chainId?: string;
    runId?: string;
    webhookUrl?: string;
    httpCode?: number;
    jobId?: string;
    jobType?: string;
    error?: string;
    actionUrl?: string;
    actionLabel?: string;
  };
}

function getNotificationsFile(namespaceId: string): string {
  const notifDir = nsPath(namespaceId, "notifications");
  if (!existsSync(notifDir)) {
    mkdirSync(notifDir, { recursive: true });
  }
  return join(notifDir, "notifications.json");
}

function loadNotifications(namespaceId: string): Notification[] {
  const file = getNotificationsFile(namespaceId);
  if (!existsSync(file)) return [];
  try {
    const content = readFileSync(file, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function saveNotifications(namespaceId: string, notifications: Notification[]): void {
  const file = getNotificationsFile(namespaceId);
  const dir = join(file, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, JSON.stringify(notifications, null, 2));
}

// DELETE /api/notifications/[id] - delete a notification
export const DELETE = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await params;
  const namespaceId = await getNamespaceIdFromRequest(request);

  const notifications = loadNotifications(namespaceId);
  const filtered = notifications.filter((n) => n.id !== id);

  if (filtered.length === notifications.length) {
    throw new NotFound("Notification", id);
  }

  saveNotifications(namespaceId, filtered);
  return apiSuccess({ success: true });
});

// PATCH /api/notifications/[id]/read - mark notification as read
export const PATCH = withErrorHandling(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const { id } = await params;
  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action"); // read, unread

  const notifications = loadNotifications(namespaceId);
  const notification = notifications.find((n) => n.id === id);

  if (!notification) {
    throw new NotFound("Notification", id);
  }

  if (action === "unread") {
    notification.read = false;
  } else {
    // Default to marking as read
    notification.read = true;
  }

  saveNotifications(namespaceId, notifications);

  return apiSuccess({ notification });
});
