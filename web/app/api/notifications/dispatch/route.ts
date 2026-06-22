/**
 * POST /api/notifications/dispatch
 *
 * Internal endpoint called by chain-runner (via curl) or other services
 * to dispatch notifications based on user preferences.
 *
 * Body: {
 *   event: "chain-completed" | "chain-stopped" | "agent-completed" |
 *          "approval-requested" | "budget-threshold",
 *   chainId?: string,
 *   runId?: string,
 *   agentId?: string,
 *   message?: string,
 *   namespaceId?: string,
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { readdirSync, existsSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { sendEmail } from "@/lib/email/email";
import { nsPath } from "@/lib/config";
import { getOrgIdFromRequest } from "@/lib/namespace-config";
import { loadPrefs, isInQuietHours } from "@/lib/notifications/notification-prefs";
import { Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import { hasInternalAuth } from "@/lib/auth/internal-api-auth";

export const dynamic = "force-dynamic";

type NotificationEvent =
  | "chain-completed"
  | "chain-stopped"
  | "chain-failed"
  | "chain-stalled"
  | "agent-completed"
  | "agent-failed"
  | "approval-requested"
  | "budget-threshold";

type InAppNotification = {
  id: string;
  type: ReturnType<typeof eventToType>;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  metadata: {
    chainId?: string;
    runId?: string;
    agentId?: string;
    actionUrl?: string;
    actionLabel?: string;
  };
};

type PushSubscriptionRecord = {
  endpoint: string;
};

function eventToCategory(event: NotificationEvent): string {
  if (event.startsWith("chain")) return "chain";
  if (event.startsWith("agent")) return "agent";
  if (event.startsWith("approval")) return "approval";
  if (event === "budget-threshold") return "budget";
  return "system";
}

function eventToType(event: NotificationEvent): "agent_complete" | "agent_error" | "chain_complete" | "chain_failed" | "webhook_failed" | "webhook_delivered" | "chain_started" | "job_started" | "job_complete" | "job_failed" {
  switch (event) {
    case "chain-completed": return "chain_complete";
    case "chain-stopped": return "chain_failed";
    case "chain-failed": return "chain_failed";
    case "chain-stalled": return "chain_failed";
    case "agent-completed": return "agent_complete";
    case "agent-failed": return "agent_error";
    default: return "chain_complete";
  }
}

function eventToActionUrl(
  event: NotificationEvent,
  runId?: string,
): { actionUrl?: string; actionLabel?: string } {
  switch (event) {
    case "chain-completed":
    case "chain-stopped":
    case "chain-failed":
    case "chain-stalled":
    case "agent-completed":
    case "agent-failed":
      if (runId) return { actionUrl: `/runs?runId=${runId}`, actionLabel: "View Run" };
      return { actionUrl: "/runs", actionLabel: "View Runs" };
    case "approval-requested":
      return { actionUrl: "/tasks?type=decision", actionLabel: "View Decisions" };
    case "budget-threshold":
      return { actionUrl: "/settings", actionLabel: "View Settings" };
    default:
      return {};
  }
}

function buildSubject(event: NotificationEvent, chainId?: string): string {
  const chain = chainId ? `'${chainId}'` : "unknown chain";
  switch (event) {
    case "chain-completed": return `[mentiko] Chain ${chain} completed`;
    case "chain-stopped": return `[mentiko] Chain ${chain} stopped`;
    case "chain-failed": return `[mentiko] Chain ${chain} failed`;
    case "chain-stalled": return `[mentiko] Chain ${chain} stalled`;
    case "agent-completed": return `[mentiko] Agent completed in ${chain}`;
    case "agent-failed": return `[mentiko] Agent failed in ${chain}`;
    case "approval-requested": return `[mentiko] Approval needed for ${chain}`;
    case "budget-threshold": return `[mentiko] Budget alert for ${chain}`;
    default: return `[mentiko] Event in ${chain}`;
  }
}

function buildText(event: NotificationEvent, chainId?: string, runId?: string, message?: string): string {
  const chain = chainId || "unknown";
  const run = runId ? ` (run: ${runId})` : "";
  if (message) return message;
  switch (event) {
    case "chain-completed": return `Chain '${chain}' completed successfully${run}.`;
    case "chain-stopped": return `Chain '${chain}' stopped${run}. Check the runs page for details.`;
    case "chain-failed": return `Chain '${chain}' failed${run}. Check the logs for error details.`;
    case "chain-stalled": return `Chain '${chain}' appears to be stalled${run}. Watchdog detected no activity.`;
    case "agent-completed": return `An agent in chain '${chain}' finished${run}.`;
    case "agent-failed": return `An agent in chain '${chain}' failed${run}. Check the logs for details.`;
    case "approval-requested": return `Chain '${chain}' is waiting for your approval${run}. Visit the Approvals page.`;
    case "budget-threshold": return `Chain '${chain}' has exceeded its budget threshold${run}.`;
    default: return `Event '${event}' in chain '${chain}'${run}.`;
  }
}

export const POST = withErrorHandling(async (request: NextRequest): Promise<NextResponse> => {
  if (!hasInternalAuth(request, "notifications-dispatch")) {
    throw new Unauthorized();
  }

  const body = await request.json();
  const {
    event,
    chainId,
    runId,
    agentId,
    message,
    namespaceId: nsId,
  } = body as {
    event: NotificationEvent;
    chainId?: string;
    runId?: string;
    agentId?: string;
    message?: string;
    namespaceId?: string;
  };

  const namespaceId = nsId || process.env.NAMESPACE_ID || "default";
  const orgId = await getOrgIdFromRequest(request);
  const category = eventToCategory(event);
  const notifType = eventToType(event);

  // find all users with preferences in this namespace
  const prefsDir = nsPath(namespaceId, "notifications");
  const dispatched: string[] = [];
  const inAppNotifications: Array<{ userId: string; notif: InAppNotification }> = [];

  if (existsSync(prefsDir)) {
    const files = readdirSync(prefsDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const userId = file.replace(".json", "");
      const prefs = loadPrefs(namespaceId, orgId, userId);

      if (!prefs.enabled) continue;
      if (isInQuietHours(prefs)) continue;

      const catConfig = prefs.categories.find((c) => c.category === category);
      if (!catConfig) continue;

      const subject = buildSubject(event, chainId);
      const text = buildText(event, chainId, runId, message);

      // dispatch email
      if (catConfig.channels.email && prefs.email) {
        try {
          await sendEmail({ to: prefs.email, subject, text, html: `<p>${text}</p>` });
          dispatched.push(`email:${userId}`);
        } catch {
          // non-critical
        }
      }

      // dispatch slack
      if (catConfig.channels.slack && prefs.slackWebhookUrl) {
        try {
          await fetch(prefs.slackWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `${subject}\n${text}` }),
          });
          dispatched.push(`slack:${userId}`);
        } catch {
          // non-critical
        }
      }

      // dispatch generic webhook
      if (catConfig.channels.webhook && prefs.webhookUrl) {
        try {
          await fetch(prefs.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event,
              chainId,
              runId,
              agentId,
              message: text,
              timestamp: new Date().toISOString(),
            }),
          });
          dispatched.push(`webhook:${userId}`);
        } catch {
          // non-critical
        }
      }

      // queue in-app notification (write to notifications dir)
      if (catConfig.channels.in_app) {
        const { actionUrl, actionLabel } = eventToActionUrl(event, runId);
        const notif = {
          id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          type: notifType,
          title: subject,
          message: text,
          timestamp: new Date().toISOString(),
          read: false,
          metadata: {
            chainId,
            runId,
            agentId,
            ...(actionUrl ? { actionUrl, actionLabel } : {}),
          },
        };
        inAppNotifications.push({ userId, notif });
      }

      // dispatch push notification (to subscribed devices)
      if (catConfig.channels.push) {
        try {
          // get user's push subscriptions
          const subsDir = join(nsPath(namespaceId), "push-subscriptions");
          if (existsSync(subsDir)) {
            const subsFile = join(subsDir, `${userId}.json`);
            if (existsSync(subsFile)) {
              const { default: fs } = await import("fs");
              const subsData = JSON.parse(fs.readFileSync(subsFile, "utf-8"));

              if (subsData.subscriptions && Array.isArray(subsData.subscriptions)) {
                for (const sub of subsData.subscriptions as PushSubscriptionRecord[]) {
                  try {
                    const pushRequest: RequestInit & {
                      vapid: {
                        subject: string;
                        publicKey?: string;
                        privateKey?: string;
                      };
                    } = {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `key=${process.env.NEXT_PUBLIC_VAPID_KEY || ""}`,
                      },
                      body: JSON.stringify({
                        notification: {
                          title: subject,
                          body: text,
                          icon: "/icon-192.png",
                          badge: "/badge-72.png",
                          data: { chainId, runId, agentId, event },
                        },
                      }),
                      vapid: {
                        subject: "mailto:support@mentiko.com",
                        publicKey: process.env.NEXT_PUBLIC_VAPID_KEY,
                        privateKey: process.env.VAPID_PRIVATE_KEY,
                      },
                    };
                    await fetch(sub.endpoint, pushRequest);
                    dispatched.push(`push:${userId}`);
                  } catch {
                    // subscription might be expired
                  }
                }
              }
            }
          }
        } catch {
          // non-critical
        }
      }
    }
  }

  // write in-app notifications to disk (for UI polling)
  for (const { userId, notif } of inAppNotifications) {
    try {
      const notifDir = join(nsPath(namespaceId), "notifications");
      await mkdir(notifDir, { recursive: true });

      const notifFile = join(notifDir, `${userId}.jsonl`);
      const notifLine = JSON.stringify(notif) + "\n";

      // append to file
      await writeFile(notifFile, notifLine, { flag: "a" as const });
      dispatched.push(`in_app:${userId}`);
    } catch {
      // non-critical
    }
  }

  return apiSuccess({ dispatched, event, chainId });
});
