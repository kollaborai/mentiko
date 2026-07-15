import { NextRequest } from "next/server";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import {
  addNotification,
  mutateNotifications,
  type NotificationMetadata,
  type PersistedNotification,
} from "@/lib/notifications/notification-persistence";

export const dynamic = "force-dynamic";

export type Notification = PersistedNotification;

/**
 * Derive actionUrl from notification type and metadata if not already set.
 */
function resolveActionUrl(
  type: string,
  metadata?: NotificationMetadata,
): { actionUrl?: string; actionLabel?: string } {
  if (metadata?.actionUrl) {
    return { actionUrl: metadata.actionUrl, actionLabel: metadata.actionLabel };
  }

  const runId = metadata?.runId;
  const jobType = metadata?.jobType;
  const taskId = metadata?.taskId;

  switch (type) {
    case "agent_complete":
    case "agent_error":
    case "chain_complete":
    case "chain_failed":
    case "chain_started":
      if (runId) {
        return { actionUrl: `/runs?runId=${runId}`, actionLabel: "View Run" };
      }
      return {};

    case "job_complete":
    case "job_started":
    case "job_failed": {
      // route based on jobType
      if (
        jobType === "decision_research" ||
        jobType === "decision_steering" ||
        jobType === "decision_retrospective" ||
        (jobType && jobType.startsWith("decision_guided"))
      ) {
        const url = taskId
          ? `/tasks?type=decision&task=${encodeURIComponent(taskId)}`
          : "/tasks?type=decision";
        return { actionUrl: url, actionLabel: "View Decision" };
      }
      if (jobType === "generate" || jobType === "recommend") {
        return { actionUrl: "/chains", actionLabel: "View Chains" };
      }
      if (jobType === "task") {
        return { actionUrl: "/tasks", actionLabel: "View Tasks" };
      }
      if (jobType === "agent" || jobType === "agent_edit") {
        return { actionUrl: "/agents", actionLabel: "View Agents" };
      }
      if (jobType === "webhook_inbound" || jobType === "webhook_outbound") {
        return { actionUrl: "/webhooks", actionLabel: "View Webhooks" };
      }
      if (runId) {
        return { actionUrl: `/runs?runId=${runId}`, actionLabel: "View Run" };
      }
      return { actionUrl: "/runs", actionLabel: "View Runs" };
    }

    case "webhook_failed":
    case "webhook_delivered":
      return { actionUrl: "/webhooks", actionLabel: "View Webhooks" };

    case "info":
    case "warning":
    case "error":
      // system alerts don't need a link
      return {};

    default:
      return {};
  }
}

function generateNotificationsFromRuns(namespaceId: string): Notification[] {
  const runsDir = nsPath(namespaceId, "runs");
  if (!existsSync(runsDir)) return [];

  const notifications: Notification[] = [];

  try {
    const entries = readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("run-"))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 20);

    for (const entry of entries) {
      const runFile = join(runsDir, entry.name, "run.json");
      if (!existsSync(runFile)) continue;

      try {
        const run = JSON.parse(readFileSync(runFile, "utf-8"));
        const runId = entry.name;

        // Skip if already have notification for this run
        if (notifications.some((n) => n.metadata?.runId === runId)) continue;

        const started = run.started || new Date().toISOString();
        const status = run.status || "unknown";

        if (status === "complete") {
          notifications.push({
            id: `notif_${runId}_complete`,
            type: "chain_complete",
            title: `Chain completed: ${run.chain || "Unknown"}`,
            message: run.goal?.split("\n")[0]?.slice(0, 100) || "Run completed successfully",
            timestamp: run.completed || started,
            read: false,
            metadata: {
              runId,
              chainId: run.chainId,
              actionUrl: `/runs?runId=${runId}`,
              actionLabel: "View Run",
            },
          });
        } else if (status === "error" || status === "failed") {
          notifications.push({
            id: `notif_${runId}_error`,
            type: "chain_failed",
            title: `Chain failed: ${run.chain || "Unknown"}`,
            message: run.goal?.split("\n")[0]?.slice(0, 100) || "Run encountered an error",
            timestamp: started,
            read: false,
            metadata: {
              runId,
              chainId: run.chainId,
              actionUrl: `/runs?runId=${runId}`,
              actionLabel: "View Run",
            },
          });
        } else if (status === "running") {
          const runningTime = Date.now() - new Date(started).getTime();
          // Only show running notifications for runs started in last hour
          if (runningTime < 3600000) {
            notifications.push({
              id: `notif_${runId}_running`,
              type: "chain_started",
              title: `Chain running: ${run.chain || "Unknown"}`,
              message: run.goal?.split("\n")[0]?.slice(0, 100) || "Run is in progress",
              timestamp: started,
              read: false,
              metadata: {
                runId,
                chainId: run.chainId,
                actionUrl: `/runs?runId=${runId}`,
                actionLabel: "Monitor",
              },
            });
          }
        }
      } catch {
        // Skip invalid runs
      }
    }
  } catch {
    // Ignore errors reading runs dir
  }

  return notifications;
}

// GET /api/notifications - list all notifications
export const GET = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter"); // all, unread, runs, system

  const snapshot = mutateNotifications(namespaceId, (stored) => {
    let notifications = stored;
    let write = false;

    // Sanitize historical records with non-string display fields.
    for (const notification of notifications) {
      if (typeof notification.message !== "string") {
        notification.message = typeof notification.message === "object" && notification.message !== null
          ? (notification.message as Record<string, unknown>).message as string
            || JSON.stringify(notification.message)
          : String(notification.message);
        write = true;
      }
      if (typeof notification.title !== "string") {
        notification.title = typeof notification.title === "object"
          ? JSON.stringify(notification.title)
          : String(notification.title);
        write = true;
      }
      if (notification.metadata?.error && typeof notification.metadata.error !== "string") {
        notification.metadata.error = typeof notification.metadata.error === "object"
          ? (notification.metadata.error as Record<string, unknown>).message as string
            || JSON.stringify(notification.metadata.error)
          : String(notification.metadata.error);
        write = true;
      }
    }

    if (notifications.length === 0) {
      notifications = generateNotificationsFromRuns(namespaceId);
      write = true;
    }

    for (const notification of notifications) {
      if (!notification.metadata?.actionUrl) {
        const resolved = resolveActionUrl(notification.type, notification.metadata);
        if (resolved.actionUrl) {
          if (!notification.metadata) notification.metadata = {};
          notification.metadata.actionUrl = resolved.actionUrl;
          if (!notification.metadata.actionLabel) {
            notification.metadata.actionLabel = resolved.actionLabel;
          }
          write = true;
        }
      }
    }

    return {
      notifications,
      result: {
        notifications,
        unreadCount: notifications.filter((notification) => !notification.read).length,
      },
      write,
    };
  });

  let notifications = [...snapshot.notifications];

  // Apply filters
  if (filter === "unread") {
    notifications = notifications.filter((n) => !n.read);
  } else if (filter === "runs") {
    notifications = notifications.filter((n) =>
      n.type.includes("chain") || n.type.includes("agent") || n.type.includes("job")
    );
  } else if (filter === "system") {
    notifications = notifications.filter((n) =>
      n.type === "info" || n.type === "warning" || n.type === "error" ||
      n.type.includes("webhook")
    );
  }

  // Sort by timestamp descending
  notifications.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return apiSuccess({
    notifications,
    unreadCount: snapshot.unreadCount,
  });
});

// POST /api/notifications - create a notification
export const POST = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const body = await request.json();
  const { type, title, message, metadata } = body;

  if (!title || !message) {
    throw new BadRequest("title and message required");
  }

  // coerce non-string message/title to strings (prevents React rendering crashes)
  const safeTitle = typeof title === "string" ? title : JSON.stringify(title);
  const safeMessage = typeof message === "string" ? message : JSON.stringify(message);

  const notifType = type || "info";

  // resolve actionUrl if the client didn't provide one
  const resolved = resolveActionUrl(notifType, metadata);
  const enrichedMetadata = {
    ...metadata,
    actionUrl: metadata?.actionUrl || resolved.actionUrl,
    actionLabel: metadata?.actionLabel || resolved.actionLabel,
  };
  // strip undefined values
  if (!enrichedMetadata.actionUrl) delete enrichedMetadata.actionUrl;
  if (!enrichedMetadata.actionLabel) delete enrichedMetadata.actionLabel;

  // coerce metadata.error to string as well
  if (enrichedMetadata.error && typeof enrichedMetadata.error !== "string") {
    enrichedMetadata.error = typeof enrichedMetadata.error === "object"
      ? (enrichedMetadata.error as Record<string, unknown>).message as string || JSON.stringify(enrichedMetadata.error)
      : String(enrichedMetadata.error);
  }

  const newNotification: Notification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: notifType,
    title: safeTitle,
    message: safeMessage,
    timestamp: new Date().toISOString(),
    read: false,
    metadata: Object.keys(enrichedMetadata).length > 0 ? enrichedMetadata : undefined,
  };

  const notification = addNotification(namespaceId, newNotification);

  return apiSuccess({ notification });
});

// PATCH /api/notifications - bulk operations (mark all read, clear all)
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const body = await request.json();
  const { action } = body;

  if (action === "markAllRead") {
    mutateNotifications(namespaceId, (notifications) => {
      notifications.forEach((notification) => (notification.read = true));
      return { notifications, result: undefined, write: true };
    });
    return apiSuccess({ success: true });
  }

  if (action === "clearAll") {
    mutateNotifications(namespaceId, () => ({
      notifications: [],
      result: undefined,
      write: true,
    }));
    return apiSuccess({ success: true });
  }

  throw new BadRequest("Unknown action");
});

// DELETE /api/notifications - delete a notification
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    throw new BadRequest("id required");
  }

  mutateNotifications(namespaceId, (notifications) => ({
    notifications: notifications.filter((notification) => notification.id !== id),
    result: undefined,
    write: true,
  }));

  return apiSuccess({ success: true });
});
