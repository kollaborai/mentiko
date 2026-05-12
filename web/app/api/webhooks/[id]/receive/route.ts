/**
 * POST /api/webhooks/[id]/receive
 *
 * Incoming webhook receiver. Accepts payloads from GitHub, GitLab,
 * Slack, or any custom source. Verifies HMAC signature when a secret
 * is configured. Emits a mentiko event file so chain-event-watcher
 * picks it up and fires any chain with a matching event_trigger.
 *
 * GitHub webhook URL to configure: https://your-domain/api/webhooks/{subscriptionId}/receive
 */

import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getWebhookById, logWebhookEvent } from "@/lib/webhook-storage";
import type { WebhookEvent, WebhookEventType, WebhookSource } from "@/lib/webhook-types";
import { nsPath } from "@/lib/config";
import { NotFound, Forbidden, Unauthorized } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Map GitHub event header values to our internal event types
const GITHUB_EVENT_MAP: Record<string, WebhookEventType> = {
  push: "push",
  pull_request: "pull_request",
  pull_request_review: "pull_request_review",
  issues: "issues",
  issue_comment: "issue_comment",
  deployment: "deployment",
  deployment_status: "deployment_status",
  release: "release",
  star: "star",
  fork: "fork",
  ping: "ping",
};

function detectSource(request: NextRequest): WebhookSource {
  if (request.headers.get("x-github-event")) return "github";
  if (request.headers.get("x-gitlab-event")) return "gitlab";
  if (request.headers.get("x-slack-signature")) return "slack";
  return "custom";
}

function detectEventType(request: NextRequest, source: WebhookSource, payload: Record<string, unknown>): WebhookEventType {
  if (source === "github") {
    const ghEvent = request.headers.get("x-github-event") || "";
    return GITHUB_EVENT_MAP[ghEvent] ?? "custom";
  }
  if (source === "gitlab") {
    const glEvent = (request.headers.get("x-gitlab-event") || "").toLowerCase();
    if (glEvent.includes("push")) return "push";
    if (glEvent.includes("merge_request")) return "pull_request";
    if (glEvent.includes("issue")) return "issues";
    if (glEvent.includes("deployment")) return "deployment";
  }
  // fall back to payload.type or payload.event
  const payloadType = (payload.type || payload.event || payload.action || "") as string;
  return (GITHUB_EVENT_MAP[payloadType] ?? "custom") as WebhookEventType;
}

async function verifyGithubSignature(
  request: NextRequest,
  body: string,
  secret: string
): Promise<boolean> {
  const sig = request.headers.get("x-hub-signature-256");
  if (!sig) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  // constant-time comparison
  if (sig.length !== expected.length) return false;
  let result = 0;
  for (let i = 0; i < sig.length; i++) {
    result |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}

function matchesFilter(
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
  filter: {
    sources?: string[];
    types?: string[];
    branches?: string[];
    labels?: string[];
    states?: string[];
  },
  source: WebhookSource
): boolean {
  if (filter.sources?.length && !filter.sources.includes(source)) return false;
  if (filter.types?.length && !filter.types.includes(eventType)) return false;

  // branch filter: check payload.ref or payload.pull_request.head.ref
  if (filter.branches?.length) {
    const ref =
      (payload.ref as string) ||
      ((payload.pull_request as Record<string, unknown>)?.head as Record<string, unknown>)?.ref as string ||
      "";
    const branch = ref.replace("refs/heads/", "");
    if (!filter.branches.some((b) => b === branch || b === "*")) return false;
  }

  // state filter: check payload.action or payload.pull_request.state
  if (filter.states?.length) {
    const action = (payload.action as string) || "";
    const state = ((payload.pull_request as Record<string, unknown>)?.state as string) || "";
    if (!filter.states.includes(action) && !filter.states.includes(state)) return false;
  }

  return true;
}

function emitEventFile(namespaceId: string, eventName: string, source: string, data: string): string {
  const eventsDir = nsPath(namespaceId, "events");
  mkdirSync(eventsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `${timestamp}-${eventName}.event`;
  const filePath = join(eventsDir, filename);

  const content = [
    `event: ${eventName}`,
    `source: ${source}`,
    `timestamp: ${new Date().toISOString()}`,
    `processed: false`,
    `data: ${data}`,
  ].join("\n") + "\n";

  writeFileSync(filePath, content, "utf-8");
  return filename;
}

export const POST = withErrorHandling(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;

  // read body as text first (needed for HMAC verification)
  const bodyText = await request.text();

  // parse namespace from query param or header (webhooks come from external, no session)
  const { searchParams } = new URL(request.url);
  const namespaceId = searchParams.get("ns") ||
    request.headers.get("x-namespace-id") ||
    "default";
  const orgId = searchParams.get("org") ||
    request.headers.get("x-org-id") ||
    "default";

  // load subscription
  const subscription = await getWebhookById(namespaceId, orgId, id);

  if (!subscription) {
    throw new NotFound("Webhook subscription", id);
  }

  if (!subscription.enabled) {
    throw new Forbidden("Webhook disabled");
  }

  // verify signature if secret is configured
  if (subscription.secret) {
    const source = detectSource(request);
    if (source === "github" || source === "custom") {
      const valid = await verifyGithubSignature(request, bodyText, subscription.secret);
      if (!valid) {
        throw new Unauthorized("Invalid signature");
      }
    }
  }

  // parse payload
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(bodyText);
  } catch {
    // non-JSON payload — wrap it
    payload = { raw: bodyText };
  }

  const source = detectSource(request);
  const eventType = detectEventType(request, source, payload);

  // check if event matches subscription filter
  if (!matchesFilter(eventType, payload, subscription.eventFilter, source)) {
    // filtered out — acknowledge but don't fire chain
    return apiSuccess({ received: true, filtered: true });
  }

  // log the event
  const webhookEvent: WebhookEvent = {
    id: crypto.randomUUID(),
    source,
    type: eventType,
    payload,
    timestamp: new Date().toISOString(),
    processed: false,
    chainId: subscription.chainId,
  };

  try {
    await logWebhookEvent(namespaceId, orgId, webhookEvent);
  } catch {
    // non-critical — continue even if logging fails
  }

  // emit a mentiko event file for chain-event-watcher to pick up
  // event name format: "webhook:{eventType}" e.g. "webhook:pull_request"
  const mentikEventName = `webhook:${eventType}`;
  const eventData = JSON.stringify({
    webhook_id: id,
    chain_id: subscription.chainId,
    source,
    type: eventType,
    ref: payload.ref || null,
    action: payload.action || null,
  });

  let emittedFile = "";
  try {
    emittedFile = emitEventFile(namespaceId, mentikEventName, `webhook:${source}`, eventData);
  } catch (err) {
    console.error("[webhook/receive] failed to emit event file:", err);
  }

  return apiSuccess({
    received: true,
    eventId: webhookEvent.id,
    eventType,
    source,
    chainId: subscription.chainId,
    emittedEvent: emittedFile || null,
  });
});
