/**
 * webhook storage layer
 * file-based persistence for webhook subscriptions and event logs
 * stored in namespaces/{namespaceId}/webhooks/
 */

import { promises as fs } from "fs";
import { join } from "path";
import { orgPath } from "./config";
import type { WebhookSubscription, WebhookEvent } from "./webhook-types";
import { encrypt, decrypt } from "./secrets-store";

// disk representation — secret stored encrypted, never plaintext
interface StoredWebhookSubscription extends Omit<WebhookSubscription, "secret"> {
  encryptedSecret?: string;
}

const WEBHOOK_DIR = "webhooks";

function getWebhookDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, WEBHOOK_DIR);
}

function getSubscriptionsPath(namespaceId: string, orgId: string): string {
  return join(getWebhookDir(namespaceId, orgId), "subscriptions.json");
}

function getEventsPath(namespaceId: string, orgId: string): string {
  return join(getWebhookDir(namespaceId, orgId), "events.jsonl");
}

async function ensureDir(namespaceId: string, orgId: string): Promise<void> {
  const dir = getWebhookDir(namespaceId, orgId);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore if already exists
  }
}

export async function loadWebhooks(
  namespaceId: string,
  orgId: string
): Promise<WebhookSubscription[]> {
  const path = getSubscriptionsPath(namespaceId, orgId);

  try {
    const data = await fs.readFile(path, "utf-8");
    const stored = JSON.parse(data) as StoredWebhookSubscription[];
    return stored.map((w) => {
      const { encryptedSecret, ...rest } = w;
      const sub: WebhookSubscription = rest;
      if (encryptedSecret) {
        try {
          const decrypted = decrypt(encryptedSecret);
          if (decrypted) sub.secret = decrypted;
        } catch {
          // corrupted — omit secret rather than crash
        }
      }
      return sub;
    });
  } catch {
    return [];
  }
}

export async function saveWebhooks(
  namespaceId: string,
  orgId: string,
  webhooks: WebhookSubscription[]
): Promise<void> {
  await ensureDir(namespaceId, orgId);
  const path = getSubscriptionsPath(namespaceId, orgId);
  const stored: StoredWebhookSubscription[] = webhooks.map((w) => {
    const { secret, ...rest } = w;
    const rec: StoredWebhookSubscription = rest;
    if (secret) {
      rec.encryptedSecret = encrypt(secret);
    }
    return rec;
  });
  await fs.writeFile(path, JSON.stringify(stored, null, 2));
}

export async function logWebhookEvent(
  namespaceId: string,
  orgId: string,
  event: WebhookEvent
): Promise<void> {
  await ensureDir(namespaceId, orgId);
  const path = getEventsPath(namespaceId, orgId);

  // append to jsonl file (one json object per line)
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(path, line);
}

export async function getWebhookLogs(
  namespaceId: string,
  orgId: string,
  limit: number = 100
): Promise<WebhookEvent[]> {
  const path = getEventsPath(namespaceId, orgId);

  try {
    const data = await fs.readFile(path, "utf-8");
    const lines = data.trim().split("\n").filter(Boolean);

    // parse from newest to oldest, apply limit
    const events: WebhookEvent[] = [];
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      try {
        events.push(JSON.parse(lines[i]) as WebhookEvent);
      } catch {
        // skip malformed lines
      }
    }

    return events;
  } catch {
    return [];
  }
}

export async function deleteWebhook(
  namespaceId: string,
  orgId: string,
  webhookId: string
): Promise<boolean> {
  const webhooks = await loadWebhooks(namespaceId, orgId);
  const filtered = webhooks.filter((w) => w.id !== webhookId);

  if (filtered.length === webhooks.length) {
    return false; // not found
  }

  await saveWebhooks(namespaceId, orgId, filtered);
  return true;
}

export async function getWebhookById(
  namespaceId: string,
  orgId: string,
  webhookId: string
): Promise<WebhookSubscription | null> {
  const webhooks = await loadWebhooks(namespaceId, orgId);
  return webhooks.find((w) => w.id === webhookId) || null;
}
