import { NextRequest } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { join, resolve } from "path";
import config, { orgPath } from "@/lib/config";
import { getNamespaceIdFromRequest, getOrgIdFromRequest } from "@/lib/namespace-config";
import {
  loadWebhooks,
  logWebhookEvent,
} from "@/lib/webhooks/webhook-storage";
import type {
  WebhookEvent,
  WebhookSubscription,
  WebhookEventType,
} from "@/lib/webhooks/webhook-types";
import { buildChildEnv } from "@/lib/runs/child-env";
import { rateLimiters, withRateLimit } from "@/lib/auth/security";
import { apiSuccess, apiError } from "@/lib/api-response";
import { BadRequest, Unauthorized } from "@/lib/api-errors";

export const dynamic = "force-dynamic";

const execAsync = promisify(exec);
const AGENT_CHAIN_BIN = resolve(join(config.binDir, "mentiko"));

type GitHubEvent =
  | "push"
  | "pull_request"
  | "pull_request_review"
  | "issues"
  | "issue_comment"
  | "deployment"
  | "deployment_status"
  | "release"
  | "ping";

interface GitHubPushPayload {
  ref: string;
  repository: { name: string; full_name: string };
  pusher: { name: string };
  commits: { id: string; message: string }[];
}

interface GitHubPullRequestPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    state: string;
    merged: boolean;
    draft: boolean;
    head: { ref: string; sha: string };
    base: { ref: string };
  };
  repository: { name: string; full_name: string };
}

interface GitHubIssuesPayload {
  action: string;
  issue: {
    number: number;
    title: string;
    state: string;
    labels: { name: string }[];
  };
  repository: { name: string; full_name: string };
}

interface GitHubDeploymentPayload {
  action: string;
  deployment: {
    id: number;
    environment: string;
    sha: string;
    ref: string;
  };
  repository: { name: string; full_name: string };
}

interface GitHubDeploymentStatusPayload {
  deployment_status: {
    id: number;
    state: string;
    description: string;
    environment: string;
  };
  deployment: {
    id: number;
    sha: string;
    ref: string;
    environment: string;
  };
  repository: { name: string; full_name: string };
}

type GitHubPayload =
  | GitHubPushPayload
  | GitHubPullRequestPayload
  | GitHubIssuesPayload
  | GitHubDeploymentPayload
  | GitHubDeploymentStatusPayload
  | Record<string, unknown>;

async function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;

  const expectedPrefix = "sha256=";
  if (!signature.startsWith(expectedPrefix)) {
    return false;
  }

  const signatureHash = signature.slice(expectedPrefix.length);

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const payloadData = encoder.encode(payload);
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      payloadData
    );

    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    void hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const signatureBytes = new Uint8Array(
      signatureHash.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    if (signatureBytes.length !== hashArray.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < hashArray.length; i++) {
      result |= signatureBytes[i]! ^ hashArray[i]!;
    }

    return result === 0;
  } catch {
    return false;
  }
}

function mapGitHubEventToWebhookType(
  githubEvent: string
): WebhookEventType {
  switch (githubEvent) {
    case "push":
      return "push";
    case "pull_request":
      return "pull_request";
    case "pull_request_review":
      return "pull_request_review";
    case "issues":
      return "issues";
    case "issue_comment":
      return "issue_comment";
    case "deployment":
      return "deployment";
    case "deployment_status":
      return "deployment_status";
    case "release":
      return "release";
    case "ping":
      return "ping";
    default:
      return "custom";
  }
}

function extractBranchFromRef(ref: string): string {
  return ref.replace("refs/heads/", "").replace("refs/tags/", "");
}

function transformGitHubPayload(
  githubEvent: string,
  payload: GitHubPayload
): Record<string, unknown> {
  const repo = (payload as Record<string, unknown>).repository as { full_name?: string } | undefined;
  const base = {
    github_event: githubEvent,
    repository: repo?.full_name || "unknown",
    timestamp: new Date().toISOString(),
  };

  switch (githubEvent) {
    case "push": {
      const push = payload as GitHubPushPayload;
      return {
        ...base,
        ref: push.ref,
        branch: extractBranchFromRef(push.ref),
        pusher: push.pusher?.name,
        commits: push.commits.map((c) => ({
          id: c.id,
          message: c.message,
        })),
        commit_count: push.commits.length,
      };
    }

    case "pull_request": {
      const pr = payload as GitHubPullRequestPayload;
      return {
        ...base,
        action: pr.action,
        pr_number: pr.pull_request.number,
        title: pr.pull_request.title,
        state: pr.pull_request.state,
        merged: pr.pull_request.merged,
        draft: pr.pull_request.draft,
        head_branch: pr.pull_request.head?.ref,
        base_branch: pr.pull_request.base?.ref,
        head_sha: pr.pull_request.head?.sha,
      };
    }

    case "issues": {
      const issue = payload as GitHubIssuesPayload;
      return {
        ...base,
        action: issue.action,
        issue_number: issue.issue.number,
        title: issue.issue.title,
        state: issue.issue.state,
        labels: issue.issue.labels.map((l) => l.name),
      };
    }

    case "deployment": {
      const deployment = payload as GitHubDeploymentPayload;
      return {
        ...base,
        action: deployment.action,
        deployment_id: deployment.deployment.id,
        environment: deployment.deployment.environment,
        sha: deployment.deployment.sha,
        ref: deployment.deployment.ref,
      };
    }

    case "deployment_status": {
      const status = payload as GitHubDeploymentStatusPayload;
      return {
        ...base,
        deployment_status_id: status.deployment_status.id,
        state: status.deployment_status.state,
        description: status.deployment_status.description,
        environment: status.deployment_status.environment || status.deployment.environment,
        deployment_id: status.deployment.id,
        sha: status.deployment.sha,
        ref: status.deployment.ref,
      };
    }

    default:
      return { ...base, raw_payload: payload };
  }
}

function matchesFilter(
  event: WebhookEvent,
  subscription: WebhookSubscription
): boolean {
  const filter = subscription.eventFilter;

  if (!subscription.enabled) return false;

  if (filter.sources?.length && !filter.sources.includes(event.source)) {
    return false;
  }

  if (filter.types?.length && !filter.types.includes(event.type)) {
    return false;
  }

  const eventData = event.payload as Record<string, unknown>;

  if (filter.branches?.length) {
    const branch = (eventData.branch || eventData.head_branch || eventData.base_branch) as string | undefined;
    if (!branch || !filter.branches.some((b) => branch.includes(b))) {
      return false;
    }
  }

  if (filter.labels?.length && eventData.labels) {
    const labels = eventData.labels as string[];
    const hasLabel = filter.labels.some((l) => labels.includes(l));
    if (!hasLabel) return false;
  }

  if (filter.states?.length) {
    const state = eventData.state || eventData.merged
      ? "merged"
      : eventData.draft
      ? "draft"
      : undefined;
    if (state && !filter.states.includes(state as "open" | "closed" | "merged" | "draft")) {
      return false;
    }
  }

  return true;
}

async function triggerChainForWebhook(
  chainId: string,
  webhookEvent: WebhookEvent,
  namespaceId: string,
  orgId: string
): Promise<void> {
  try {
    const chainPath = orgPath(namespaceId, orgId, "chains", chainId, "chain.json");

    const env = buildChildEnv({
      NAMESPACE_ID: namespaceId,
      MENTIKO_ROOT: config.root,
      WEBHOOK_EVENT_ID: webhookEvent.id,
      WEBHOOK_EVENT_TYPE: webhookEvent.type,
      WEBHOOK_EVENT_SOURCE: webhookEvent.source,
    });

    await execAsync(
      `"${AGENT_CHAIN_BIN}" run "${chainPath}"`,
      {
        cwd: config.root,
        env,
        timeout: 300000,
      }
    );
  } catch (error) {
    console.error(`Failed to trigger chain ${chainId} for webhook:`, error);
  }
}

async function findMatchingSubscriptions(
  webhookEvent: WebhookEvent,
  namespaceId: string,
  orgId: string
): Promise<WebhookSubscription[]> {
  try {
    const subscriptions = await loadWebhooks(namespaceId, orgId);
    return subscriptions.filter((sub) => matchesFilter(webhookEvent, sub));
  } catch {
    return [];
  }
}

export const POST = withRateLimit(rateLimiters.webhook)(
  async (request: NextRequest) => {
    const namespaceId = await getNamespaceIdFromRequest(request);
    const orgId = await getOrgIdFromRequest(request);

    const signature = request.headers.get("x-hub-signature-256");
    const githubEvent = request.headers.get("x-github-event") as GitHubEvent | null;
    const deliveryId = request.headers.get("x-github-delivery");

    if (!githubEvent) {
      return apiError(new BadRequest("Missing X-GitHub-Event header"));
    }

    const rawPayload = await request.text();

    const subscriptions = await loadWebhooks(namespaceId, orgId);

    const githubSubscriptions = subscriptions.filter(
      (s) => s.eventFilter.sources?.includes("github") || !s.eventFilter.sources
    );

    let verifiedSubscription: WebhookSubscription | null = null;

    for (const sub of githubSubscriptions) {
      if (sub.secret && await verifyGitHubSignature(rawPayload, signature, sub.secret)) {
        verifiedSubscription = sub;
        break;
      }
    }

    if (!verifiedSubscription && githubSubscriptions.length > 0) {
      return apiError(new Unauthorized("Invalid signature"));
    }

    if (githubEvent === "ping") {
      return apiSuccess({ message: "pong" });
    }

    let payload: GitHubPayload;
    try {
      payload = JSON.parse(rawPayload) as GitHubPayload;
    } catch {
      return apiError(new BadRequest("Invalid JSON payload"));
    }

    const eventType = mapGitHubEventToWebhookType(githubEvent);
    const transformedPayload = transformGitHubPayload(githubEvent, payload);

    const webhookEvent: WebhookEvent = {
      id: deliveryId || `gh-${Date.now()}`,
      source: "github",
      type: eventType,
      payload: transformedPayload,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    await logWebhookEvent(namespaceId, orgId, webhookEvent);

    const matchingSubscriptions = await findMatchingSubscriptions(
      webhookEvent,
      namespaceId,
      orgId
    );

    for (const sub of matchingSubscriptions) {
      triggerChainForWebhook(sub.chainId, webhookEvent, namespaceId, orgId).catch(
        (err) => console.error("Chain trigger failed:", err)
      );
    }

    webhookEvent.processed = true;
    webhookEvent.chainId = matchingSubscriptions[0]?.chainId;

    return apiSuccess({
      received: true,
      eventId: webhookEvent.id,
      eventType: webhookEvent.type,
      chainsTriggered: matchingSubscriptions.map((s) => s.chainId),
    });
  }
);

export async function GET() {
  return apiSuccess({
    endpoint: "/api/webhooks/github",
    version: "1.0",
    methods: ["POST"],
    supported_events: [
      "push",
      "pull_request",
      "pull_request_review",
      "issues",
      "issue_comment",
      "deployment",
      "deployment_status",
      "release",
    ],
    headers: {
      "X-GitHub-Event": "event type",
      "X-Hub-Signature-256": "sha256 signature for verification",
      "X-GitHub-Delivery": "unique delivery id",
    },
  });
}
