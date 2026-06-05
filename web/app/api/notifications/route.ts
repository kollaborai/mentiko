import { NextRequest } from "next/server";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { nsPath } from "@/lib/config";
import { checkAuth } from "@/lib/auth/api-auth";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { Unauthorized, BadRequest } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export interface Notification {
  id: string;
  type: "agent_complete" | "agent_error" | "chain_complete" | "chain_failed" |
        "webhook_failed" | "webhook_delivered" | "chain_started" |
        "job_started" | "job_complete" | "job_failed" | "info" | "warning" | "error";
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
    decisionId?: string;
    actionUrl?: string;
    actionLabel?: string;
  };
}

const MAX_NOTIFICATIONS = 200;

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

/**
 * Derive actionUrl from notification type and metadata if not already set.
 */
function resolveActionUrl(
  type: Notification["type"],
  metadata?: Notification["metadata"],
): { actionUrl?: string; actionLabel?: string } {
  if (metadata?.actionUrl) {
    return { actionUrl: metadata.actionUrl, actionLabel: metadata.actionLabel };
  }

  const runId = metadata?.runId;
  const jobType = metadata?.jobType;
  const decisionId = metadata?.decisionId;

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
        const url = decisionId ? `/decisions?id=${decisionId}` : "/decisions";
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

  let notifications = loadNotifications(namespaceId);

  // sanitize any notifications with non-string message/title/error fields
  let sanitized = false;
  for (const n of notifications) {
    if (typeof n.message !== "string") {
      n.message = typeof n.message === "object" && n.message !== null
        ? (n.message as Record<string, unknown>).message as string || JSON.stringify(n.message)
        : String(n.message);
      sanitized = true;
    }
    if (typeof n.title !== "string") {
      n.title = typeof n.title === "object" ? JSON.stringify(n.title) : String(n.title);
      sanitized = true;
    }
    if (n.metadata?.error && typeof n.metadata.error !== "string") {
      n.metadata.error = typeof n.metadata.error === "object"
        ? (n.metadata.error as Record<string, unknown>).message as string || JSON.stringify(n.metadata.error)
        : String(n.metadata.error);
      sanitized = true;
    }
  }
  if (sanitized) {
    saveNotifications(namespaceId, notifications);
  }

  // If no stored notifications, generate from runs
  if (notifications.length === 0) {
    const generated = generateNotificationsFromRuns(namespaceId);
    // Save generated notifications so they persist
    saveNotifications(namespaceId, generated);
    notifications = generated;
  }

  // Backfill actionUrl for any notifications missing it
  let patched = false;
  for (const n of notifications) {
    if (!n.metadata?.actionUrl) {
      const resolved = resolveActionUrl(n.type, n.metadata);
      if (resolved.actionUrl) {
        if (!n.metadata) n.metadata = {};
        n.metadata.actionUrl = resolved.actionUrl;
        if (!n.metadata.actionLabel) n.metadata.actionLabel = resolved.actionLabel;
        patched = true;
      }
    }
  }
  if (patched) {
    saveNotifications(namespaceId, notifications);
  }

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
    unreadCount: loadNotifications(namespaceId).filter((n) => !n.read).length,
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

  const notifications = loadNotifications(namespaceId);

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

  notifications.unshift(newNotification);

  // Keep only most recent
  if (notifications.length > MAX_NOTIFICATIONS) {
    notifications.splice(MAX_NOTIFICATIONS);
  }

  saveNotifications(namespaceId, notifications);

  return apiSuccess({ notification: newNotification });
});

// PATCH /api/notifications - bulk operations (mark all read, clear all)
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  if (!(await checkAuth(request))) {
    throw new Unauthorized();
  }

  const namespaceId = await getNamespaceIdFromRequest(request);
  const body = await request.json();
  const { action } = body;

  const notifications = loadNotifications(namespaceId);

  if (action === "markAllRead") {
    notifications.forEach((n) => (n.read = true));
    saveNotifications(namespaceId, notifications);
    return apiSuccess({ success: true });
  }

  if (action === "clearAll") {
    saveNotifications(namespaceId, []);
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

  const notifications = loadNotifications(namespaceId);
  const filtered = notifications.filter((n) => n.id !== id);

  saveNotifications(namespaceId, filtered);

  return apiSuccess({ success: true });
});
