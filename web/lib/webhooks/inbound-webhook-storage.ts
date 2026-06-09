import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { orgPath } from "../config";
import { createHash, randomBytes } from "crypto";

const FILE_NAME = "inbound-webhooks.json";
const TRIGGERS_FILE_NAME = "inbound-webhook-triggers.json";

export type InboundWebhookPayloadMode = "context" | "metadata" | "both";
export type InboundTriggerStatus = "accepted" | "started" | "failed";

export interface InboundWebhookRunDefaults {
  goal?: string;
  workspaceId?: string;
  workspacePath?: string;
  agentProfileId?: string;
  executor?: string;
  payloadMode?: InboundWebhookPayloadMode;
}

export interface InboundWebhookAllowedOverrides {
  goal?: boolean;
  workspace?: boolean;
  profile?: boolean;
  executor?: boolean;
  metadata?: boolean;
}

export interface InboundWebhook {
  id: string;
  name: string;
  tokenHash: string;   // SHA-256 of the token (never store plaintext)
  tokenPreview: string; // first 8 chars of token for display
  chainId?: string;
  scheduleId?: string;
  createdBy?: string;
  runDefaults?: InboundWebhookRunDefaults;
  allowedOverrides?: InboundWebhookAllowedOverrides;
  active: boolean;
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
}

export interface CreateInboundWebhookInput {
  name: string;
  chainId?: string;
  scheduleId?: string;
  createdBy?: string;
  runDefaults?: InboundWebhookRunDefaults;
  allowedOverrides?: InboundWebhookAllowedOverrides;
}

export interface InboundWebhookTrigger {
  id: string;
  webhookId: string;
  chainId?: string;
  scheduleId?: string;
  status: InboundTriggerStatus;
  statusTokenHash: string;
  statusTokenPreview: string;
  acceptedAt: string;
  startedAt?: string;
  failedAt?: string;
  runId?: string;
  payloadPreview?: string;
  headersPreview?: Record<string, string>;
  error?: string;
}

export interface CreateInboundTriggerInput {
  webhookId: string;
  chainId?: string;
  scheduleId?: string;
  status?: InboundTriggerStatus;
  payload?: unknown;
  headers?: Record<string, string>;
}

function getFilePath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, FILE_NAME);
}

function getTriggersFilePath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, TRIGGERS_FILE_NAME);
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJsonArray<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveJsonArray<T>(filePath: string, rows: T[]): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, JSON.stringify(rows, null, 2));
}

function generateStatusToken(): { statusToken: string; statusTokenHash: string; statusTokenPreview: string } {
  const statusToken = `mws_${randomBytes(24).toString("hex")}`;
  return {
    statusToken,
    statusTokenHash: hashToken(statusToken),
    statusTokenPreview: statusToken.slice(0, 12) + "...",
  };
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function normalizeRunDefaults(value: unknown): InboundWebhookRunDefaults | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const payloadMode = input.payloadMode === "metadata" || input.payloadMode === "both"
    ? input.payloadMode
    : input.payloadMode === "context"
      ? "context"
      : undefined;
  const defaults: InboundWebhookRunDefaults = {
    goal: sanitizeString(input.goal, 50000),
    workspaceId: sanitizeString(input.workspaceId, 200),
    workspacePath: sanitizeString(input.workspacePath, 2000),
    agentProfileId: sanitizeString(input.agentProfileId, 200),
    executor: sanitizeString(input.executor, 50),
    payloadMode,
  };
  const cleaned = Object.fromEntries(
    Object.entries(defaults).filter(([, entry]) => entry !== undefined)
  ) as InboundWebhookRunDefaults;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

function normalizeAllowedOverrides(value: unknown): InboundWebhookAllowedOverrides | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const overrides: InboundWebhookAllowedOverrides = {
    goal: input.goal === true,
    workspace: input.workspace === true,
    profile: input.profile === true,
    executor: input.executor === true,
    metadata: input.metadata === true,
  };
  return overrides;
}

export function normalizeInboundRunDefaults(value: unknown): InboundWebhookRunDefaults | undefined {
  return normalizeRunDefaults(value);
}

export function normalizeInboundAllowedOverrides(value: unknown): InboundWebhookAllowedOverrides | undefined {
  return normalizeAllowedOverrides(value);
}

function previewJson(value: unknown, maxLength = 2000): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "authorization" || normalizedKey === "cookie" || normalizedKey === "set-cookie") {
      continue;
    }
    safe[normalizedKey] = String(value).slice(0, 300);
  }
  return Object.keys(safe).length ? safe : undefined;
}

export function listInboundWebhooks(namespaceId: string, orgId: string): InboundWebhook[] {
  return readJsonArray<InboundWebhook>(getFilePath(namespaceId, orgId));
}

export function saveInboundWebhooks(namespaceId: string, orgId: string, hooks: InboundWebhook[]): void {
  saveJsonArray(getFilePath(namespaceId, orgId), hooks);
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

export function createInboundWebhook(
  namespaceId: string,
  orgId: string,
  input: CreateInboundWebhookInput
): { webhook: InboundWebhook; token: string } {
  const { token, tokenHash, tokenPreview } = generateToken();
  const webhook: InboundWebhook = {
    id: crypto.randomUUID(),
    name: input.name,
    tokenHash,
    tokenPreview,
    chainId: input.chainId || undefined,
    scheduleId: input.scheduleId || undefined,
    createdBy: input.createdBy || undefined,
    runDefaults: normalizeRunDefaults(input.runDefaults),
    allowedOverrides: normalizeAllowedOverrides(input.allowedOverrides),
    active: true,
    createdAt: new Date().toISOString(),
    useCount: 0,
  };

  const hooks = listInboundWebhooks(namespaceId, orgId);
  hooks.push(webhook);
  saveInboundWebhooks(namespaceId, orgId, hooks);
  return { webhook, token };
}

export function recordUsage(namespaceId: string, orgId: string, id: string): void {
  const hooks = listInboundWebhooks(namespaceId, orgId);
  const idx = hooks.findIndex((h) => h.id === id);
  if (idx === -1) return;
  hooks[idx] = { ...hooks[idx], lastUsedAt: new Date().toISOString(), useCount: (hooks[idx].useCount || 0) + 1 };
  saveInboundWebhooks(namespaceId, orgId, hooks);
}

export function listInboundTriggers(namespaceId: string, orgId: string): InboundWebhookTrigger[] {
  return readJsonArray<InboundWebhookTrigger>(getTriggersFilePath(namespaceId, orgId));
}

export function saveInboundTriggers(namespaceId: string, orgId: string, triggers: InboundWebhookTrigger[]): void {
  saveJsonArray(getTriggersFilePath(namespaceId, orgId), triggers);
}

export function createInboundTrigger(
  namespaceId: string,
  orgId: string,
  input: CreateInboundTriggerInput
): { trigger: InboundWebhookTrigger; statusToken: string } {
  const { statusToken, statusTokenHash, statusTokenPreview } = generateStatusToken();
  const now = new Date().toISOString();
  const trigger: InboundWebhookTrigger = {
    id: crypto.randomUUID(),
    webhookId: input.webhookId,
    chainId: input.chainId,
    scheduleId: input.scheduleId,
    status: input.status || "accepted",
    statusTokenHash,
    statusTokenPreview,
    acceptedAt: now,
    ...(input.status === "started" ? { startedAt: now } : {}),
    ...(input.status === "failed" ? { failedAt: now } : {}),
    payloadPreview: previewJson(input.payload),
    headersPreview: normalizeHeaders(input.headers),
  };
  const triggers = listInboundTriggers(namespaceId, orgId);
  triggers.push(trigger);
  saveInboundTriggers(namespaceId, orgId, triggers);
  return { trigger, statusToken };
}

export function updateInboundTrigger(
  namespaceId: string,
  orgId: string,
  triggerId: string,
  updates: Partial<Pick<InboundWebhookTrigger, "status" | "runId" | "error">>
): InboundWebhookTrigger | null {
  const triggers = listInboundTriggers(namespaceId, orgId);
  const idx = triggers.findIndex((trigger) => trigger.id === triggerId);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const next: InboundWebhookTrigger = {
    ...triggers[idx],
    ...updates,
    ...(updates.status === "started" ? { startedAt: triggers[idx].startedAt || now } : {}),
    ...(updates.status === "failed" ? { failedAt: triggers[idx].failedAt || now } : {}),
  };
  triggers[idx] = next;
  saveInboundTriggers(namespaceId, orgId, triggers);
  return next;
}

export function findInboundTriggerByStatusToken(
  namespaceId: string,
  orgId: string,
  triggerId: string,
  statusToken: string
): InboundWebhookTrigger | null {
  const hash = hashToken(statusToken);
  return listInboundTriggers(namespaceId, orgId).find(
    (trigger) => trigger.id === triggerId && trigger.statusTokenHash === hash
  ) ?? null;
}
