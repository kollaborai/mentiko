/**
 * webhook utilities for chain events
 * fire-and-forget webhook delivery for chain lifecycle events
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { orgPath } from "./config";

export type WebhookEvent = "started" | "completed" | "failed";

export interface ChainWebhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  headers?: Record<string, string>;
  secret?: string;
  enabled: boolean;
}

export interface WebhookPayload {
  event: WebhookEvent;
  chainId: string;
  runId?: string;
  timestamp: string;
  chain: {
    name: string;
    version?: string;
    description?: string;
  };
  data?: Record<string, unknown>;
}

/**
 * read webhooks from chain.json metadata.webhooks array
 * returns empty array if none configured
 */
export function getChainWebhooks(
  namespaceId: string,
  orgId: string,
  chainId: string
): ChainWebhook[] {
  const chainPath = join(orgPath(namespaceId, orgId, "chains"), chainId, "chain.json");

  if (!existsSync(chainPath)) {
    return [];
  }

  try {
    const content = readFileSync(chainPath, "utf-8");
    const chain = JSON.parse(content);
    return chain.metadata?.webhooks || [];
  } catch {
    return [];
  }
}

/**
 * write webhooks to chain.json metadata.webhooks array
 */
export function saveChainWebhooks(
  namespaceId: string,
  orgId: string,
  chainId: string,
  webhooks: ChainWebhook[]
): { success: boolean; error?: string } {
  const chainPath = join(orgPath(namespaceId, orgId, "chains"), chainId, "chain.json");

  if (!existsSync(chainPath)) {
    return { success: false, error: "Chain not found" };
  }

  try {
    const content = readFileSync(chainPath, "utf-8");
    const chain = JSON.parse(content);

    // preserve other metadata, add webhooks
    chain.metadata = {
      ...chain.metadata,
      webhooks,
    };

    // write back using fs operations
    writeFileSync(chainPath, JSON.stringify(chain, null, 2), "utf-8");

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * fire webhooks for a specific chain event
 * fire-and-forget: logs errors but doesn't block
 *
 * usage:
 *   fireWebhooks("my-chain", "completed", { runId: "run-123" })
 */
export async function fireWebhooks(
  namespaceId: string,
  orgId: string,
  chainId: string,
  event: WebhookEvent,
  data?: { runId?: string; [key: string]: unknown }
): Promise<void> {
  const chainPath = join(orgPath(namespaceId, orgId, "chains"), chainId, "chain.json");

  if (!existsSync(chainPath)) {
    console.warn(`[webhook] chain not found: ${chainId}`);
    return;
  }

  let chain: { name?: string; version?: string; description?: string; metadata?: { webhooks?: ChainWebhook[] } };

  try {
    const content = readFileSync(chainPath, "utf-8");
    chain = JSON.parse(content);
  } catch {
    console.warn(`[webhook] failed to read chain: ${chainId}`);
    return;
  }

  const webhooks = chain.metadata?.webhooks || [];
  const matchingWebhooks = webhooks.filter(
    (w: ChainWebhook) => w.enabled && w.events.includes(event)
  );

  if (matchingWebhooks.length === 0) {
    return; // no webhooks to fire
  }

  const payload: WebhookPayload = {
    event,
    chainId,
    runId: data?.runId as string | undefined,
    timestamp: new Date().toISOString(),
    chain: {
      name: chain.name || chainId,
      version: chain.version,
      description: chain.description,
    },
    data,
  };

  // fire all webhooks in parallel, don't wait
  matchingWebhooks.forEach((webhook: ChainWebhook) => {
    fireSingleWebhook(webhook, payload).catch((err) => {
      console.error(`[webhook] failed to fire ${webhook.url}:`, err);
    });
  });
}

/**
 * fire a single webhook with optional signature
 */
async function fireSingleWebhook(
  webhook: ChainWebhook,
  payload: WebhookPayload
): Promise<void> {
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": payload.event,
    "X-Webhook-Chain": payload.chainId,
    "X-Webhook-Timestamp": payload.timestamp,
    "User-Agent": "mentiko/1.0",
    ...webhook.headers,
  };

  // add signature if secret provided
  if (webhook.secret) {
    const crypto = await import("crypto");
    const signature = crypto
      .createHmac("sha256", webhook.secret)
      .update(body)
      .digest("hex");
    headers["X-Webhook-Signature"] = `sha256=${signature}`;
  }

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    console.log(`[webhook] delivered ${payload.event} to ${webhook.url}`);
  } catch (error) {
    console.error(
      `[webhook] failed ${webhook.url}:`,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
