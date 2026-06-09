/**
 * webhook utilities for chain events
 * fire-and-forget webhook delivery for chain lifecycle events
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { orgPath } from "../config";
import {
  appendOutboundDelivery,
  getOutboundWebhookSecret,
  listOutboundWebhooksForEvent,
  signOutboundPayload,
  type OutboundWebhookConfig,
} from "@/lib/webhooks/outbound-webhook-storage";
import { postOutboundWebhook } from "@/lib/webhooks/outbound-webhook-delivery";

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

  const chainWebhooks = chain.metadata?.webhooks || [];
  const matchingChainWebhooks = chainWebhooks.filter(
    (w: ChainWebhook) => w.enabled && w.events.includes(event)
  );
  const matchingOrgWebhooks = listOutboundWebhooksForEvent(namespaceId, orgId, event, chainId);

  if (matchingChainWebhooks.length === 0 && matchingOrgWebhooks.length === 0) {
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
  matchingChainWebhooks.forEach((webhook: ChainWebhook) => {
    fireSingleWebhook(webhook, payload).catch((err) => {
      console.error(`[webhook] failed to fire ${webhook.url}:`, err);
    });
  });
  matchingOrgWebhooks.forEach((webhook) => {
    fireOutboundWebhook(namespaceId, orgId, webhook, payload).catch((err) => {
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
    const response = await postOutboundWebhook(webhook.url, {
      method: "POST",
      headers,
      body,
      timeoutMs: 10_000,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`HTTP ${response.statusCode}`);
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

export async function fireOutboundWebhook(
  namespaceId: string,
  orgId: string,
  webhook: OutboundWebhookConfig,
  payload: WebhookPayload
): Promise<{ ok: boolean; httpCode?: number; error?: string }> {
  const body = JSON.stringify(payload);
  const secret = getOutboundWebhookSecret(webhook);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Webhook-Event": payload.event,
    "X-Webhook-Chain": payload.chainId,
    "X-Webhook-Timestamp": payload.timestamp,
    "User-Agent": "mentiko/1.0",
    ...webhook.headers,
  };
  if (secret) {
    headers["X-Webhook-Signature"] = signOutboundPayload(secret, body);
  }

  const deliveryBase = {
    id: crypto.randomUUID(),
    webhookId: webhook.id,
    event: payload.event,
    chainId: payload.chainId,
    runId: payload.runId,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await postOutboundWebhook(webhook.url, {
      method: "POST",
      headers,
      body,
      timeoutMs: 10_000,
    });
    const ok = response.statusCode >= 200 && response.statusCode < 300;
    appendOutboundDelivery(namespaceId, orgId, {
      ...deliveryBase,
      status: ok ? "delivered" : "failed",
      httpCode: response.statusCode,
      ...(ok ? {} : { error: `HTTP ${response.statusCode}` }),
    });
    return ok
      ? { ok: true, httpCode: response.statusCode }
      : { ok: false, httpCode: response.statusCode, error: `HTTP ${response.statusCode}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendOutboundDelivery(namespaceId, orgId, {
      ...deliveryBase,
      status: "failed",
      error: message,
    });
    return { ok: false, error: message };
  }
}
