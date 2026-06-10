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
import { getWebhookById, logWebhookEvent } from "@/lib/webhooks/webhook-storage";
import type { WebhookEvent, WebhookEventType, WebhookSource } from "@/lib/webhooks/webhook-types";
import { nsPath } from "@/lib/config";
import { timingSafeEqual } from "@/lib/auth/security";
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

// github + custom: HMAC-SHA256 of the raw body, x-hub-signature-256 header
function verifyHmacSha256(request: NextRequest, body: string, secret: string): boolean {
  const sig = request.headers.get("x-hub-signature-256");
  if (!sig) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEqual(sig, expected); // constant-time; length folded in
}

// gitlab: shared secret token sent verbatim in x-gitlab-token
function verifyGitlabToken(request: NextRequest, secret: string): boolean {
  const token = request.headers.get("x-gitlab-token");
  if (!token) return false;
  return timingSafeEqual(token, secret);
}

// slack: v0 signature over `v0:{ts}:{body}`, with a 5-minute replay window
function verifySlackSignature(request: NextRequest, body: string, secret: string): boolean {
  const sig = request.headers.get("x-slack-signature");
  const ts = request.headers.get("x-slack-request-timestamp");
  if (!sig || !ts) return false;
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  const expected = "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  return timingSafeEqual(sig, expected);
}

// dispatch verification by source; every source must present a valid signature
function verifySignature(
  request: NextRequest,
  body: string,
  secret: string,
  source: WebhookSource
): boolean {
  switch (source) {
    case "gitlab":
      return verifyGitlabToken(request, secret);
    case "slack":
      return verifySlackSignature(request, body, secret);
    case "github":
    case "custom":
    default:
      return verifyHmacSha256(request, body, secret);
  }
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

  // Every chain-triggering webhook must authenticate its sender. A webhook with
  // no secret can be fired by anyone who learns the (UUID) receive URL, so
  // reject those outright; with a secret, verify per source (github/custom HMAC,
  // gitlab token, slack signature) — not just github/custom as before.
  const source = detectSource(request);
  if (!subscription.secret) {
    throw new Unauthorized("This webhook has no secret configured; set one to receive events");
  }
  if (!verifySignature(request, bodyText, subscription.secret, source)) {
    throw new Unauthorized("Invalid signature");
  }

  // parse payload
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(bodyText);
  } catch {
    // non-JSON payload — wrap it
    payload = { raw: bodyText };
  }

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
