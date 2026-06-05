import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { orgPath } from "../config";
import { createHash, randomBytes } from "crypto";

const FILE_NAME = "inbound-webhooks.json";

export interface InboundWebhook {
  id: string;
  name: string;
  tokenHash: string;   // SHA-256 of the token (never store plaintext)
  tokenPreview: string; // first 8 chars of token for display
  chainId?: string;
  scheduleId?: string;
  active: boolean;
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}

function getFilePath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, FILE_NAME);
}

export function listInboundWebhooks(namespaceId: string, orgId: string): InboundWebhook[] {
  const fp = getFilePath(namespaceId, orgId);
  if (!existsSync(fp)) return [];
  try { return JSON.parse(readFileSync(fp, "utf-8")); } catch { return []; }
}

export function saveInboundWebhooks(namespaceId: string, orgId: string, hooks: InboundWebhook[]): void {
  const fp = getFilePath(namespaceId, orgId);
  const dir = path.dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fp, JSON.stringify(hooks, null, 2));
}

export function generateToken(): { token: string; tokenHash: string; tokenPreview: string } {
  const token = `mwh_${randomBytes(24).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const tokenPreview = token.slice(0, 12) + "...";
  return { token, tokenHash, tokenPreview };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findWebhookByToken(namespaceId: string, orgId: string, token: string): InboundWebhook | null {
  const hash = hashToken(token);
  return listInboundWebhooks(namespaceId, orgId).find((h) => h.tokenHash === hash && h.active) ?? null;
}

export function recordUsage(namespaceId: string, orgId: string, id: string): void {
  const hooks = listInboundWebhooks(namespaceId, orgId);
  const idx = hooks.findIndex((h) => h.id === id);
  if (idx === -1) return;
  hooks[idx] = { ...hooks[idx], lastUsedAt: new Date().toISOString(), useCount: (hooks[idx].useCount || 0) + 1 };
  saveInboundWebhooks(namespaceId, orgId, hooks);
}
