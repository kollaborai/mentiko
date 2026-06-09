import { createHmac } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import path from "path";
import { orgPath } from "@/lib/config";
import { encrypt, decrypt } from "@/lib/secrets/secrets-store";
import { normalizeOutboundWebhookUrl } from "./outbound-webhook-security";

export type OutboundWebhookEvent =
  | "started"
  | "completed"
  | "failed"
  | "chain_started"
  | "chain_complete"
  | "chain_failed"
  | "agent_started"
  | "agent_complete"
  | "agent_error"
  | "run_started"
  | "run_complete"
  | "run_failed"
  | "schedule_triggered";

export type OutboundDeliveryStatus = "delivered" | "failed" | "pending";

// Scope controls which chains an org-level outbound webhook fires for.
// Default is all chains; "chains" restricts to an explicit chain-id allowlist.
export type OutboundWebhookScope =
  | { type: "all" }
  | { type: "chains"; chainIds: string[] };

const ALL_CHAINS_SCOPE: OutboundWebhookScope = { type: "all" };

export interface OutboundWebhookConfig {
  id: string;
  name: string;
  url: string;
  events: OutboundWebhookEvent[];
  scope?: OutboundWebhookScope;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  secretEncrypted?: string;
  secret?: string;
  headers?: Record<string, string>;
}

export interface OutboundWebhookClientConfig {
  id: string;
  name: string;
  url: string;
  events: OutboundWebhookEvent[];
  scope: OutboundWebhookScope;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  hasSecret: boolean;
  headers?: Record<string, string>;
  recentDeliveries?: OutboundWebhookDelivery[];
}

export interface OutboundWebhookDelivery {
  id: string;
  webhookId: string;
  status: OutboundDeliveryStatus;
  event: string;
  chainId?: string;
  runId?: string;
  httpCode?: number;
  timestamp: string;
  error?: string;
}

const CONFIG_FILE = "mentiko-webhooks.json";
const DELIVERIES_FILE = "mentiko-webhook-deliveries.jsonl";

function getConfigPath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, CONFIG_FILE);
}

function getDeliveriesPath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, DELIVERIES_FILE);
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

function normalizeUrl(value: unknown): string | undefined {
  return normalizeOutboundWebhookUrl(value);
}

export function normalizeOutboundEvent(event: string): OutboundWebhookEvent | null {
  const normalized = event.trim() as OutboundWebhookEvent;
  const allowed: OutboundWebhookEvent[] = [
    "started", "completed", "failed",
    "chain_started", "chain_complete", "chain_failed",
    "agent_started", "agent_complete", "agent_error",
    "run_started", "run_complete", "run_failed",
    "schedule_triggered",
  ];
  return allowed.includes(normalized) ? normalized : null;
}

export function eventAliases(event: string): OutboundWebhookEvent[] {
  if (event === "started") return ["started", "chain_started", "run_started"];
  if (event === "completed") return ["completed", "chain_complete", "run_complete"];
  if (event === "failed") return ["failed", "chain_failed", "run_failed", "agent_error"];
  const normalized = normalizeOutboundEvent(event);
  return normalized ? [normalized] : [];
}

function normalizeEvents(value: unknown): OutboundWebhookEvent[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((event) => typeof event === "string" ? normalizeOutboundEvent(event) : null)
    .filter((event): event is OutboundWebhookEvent => Boolean(event))));
}

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "cookie" || lower === "set-cookie") continue;
    if (typeof headerValue === "string" && headerValue.trim()) {
      headers[key] = headerValue.slice(0, 500);
    }
  }
  return Object.keys(headers).length ? headers : undefined;
}

function normalizeScope(value: unknown): OutboundWebhookScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ALL_CHAINS_SCOPE;
  const input = value as Record<string, unknown>;
  if (input.type !== "chains") return ALL_CHAINS_SCOPE;
  const chainIds = Array.isArray(input.chainIds)
    ? Array.from(new Set(input.chainIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
        .map((id) => id.slice(0, 200))))
        .slice(0, 200)
    : [];
  // Keep an explicit "chains" scope even when empty so it fails CLOSED (fires
  // for nothing) rather than silently widening to all chains. Callers validate
  // and reject an empty selection so the misconfiguration surfaces to the user.
  return { type: "chains", chainIds };
}

function assertValidScope(scope: OutboundWebhookScope): void {
  if (scope.type === "chains" && scope.chainIds.length === 0) {
    throw new Error("selected-chains scope requires at least one chain id");
  }
}

export function resolveOutboundScope(config: OutboundWebhookConfig): OutboundWebhookScope {
  return config.scope ?? ALL_CHAINS_SCOPE;
}

export function outboundWebhookFiresForChain(config: OutboundWebhookConfig, chainId?: string): boolean {
  const scope = resolveOutboundScope(config);
  if (scope.type === "all") return true;
  return Boolean(chainId) && scope.chainIds.includes(chainId as string);
}

function normalizeStoredConfig(config: OutboundWebhookConfig): OutboundWebhookConfig {
  if (config.secret && !config.secretEncrypted) {
    const { secret, ...rest } = config;
    return { ...rest, secretEncrypted: encrypt(secret) };
  }
  return config;
}

export function listOutboundWebhooks(namespaceId: string, orgId: string): OutboundWebhookConfig[] {
  return readJsonArray<OutboundWebhookConfig>(getConfigPath(namespaceId, orgId))
    .map(normalizeStoredConfig);
}

export function saveOutboundWebhooks(namespaceId: string, orgId: string, configs: OutboundWebhookConfig[]): void {
  saveJsonArray(getConfigPath(namespaceId, orgId), configs.map(normalizeStoredConfig));
}

export function toOutboundClientConfig(
  config: OutboundWebhookConfig,
  recentDeliveries?: OutboundWebhookDelivery[]
): OutboundWebhookClientConfig {
  const { secret, secretEncrypted, ...safe } = normalizeStoredConfig(config);
  return {
    ...safe,
    scope: resolveOutboundScope(config),
    hasSecret: Boolean(secretEncrypted || secret),
    ...(recentDeliveries ? { recentDeliveries } : {}),
  };
}

export function createOutboundWebhook(
  namespaceId: string,
  orgId: string,
  input: {
    name: unknown;
    url: unknown;
    events: unknown;
    scope?: unknown;
    secret?: unknown;
    active?: unknown;
    headers?: unknown;
  }
): OutboundWebhookConfig {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const url = normalizeUrl(input.url);
  const events = normalizeEvents(input.events);
  if (!name || !url || events.length === 0) {
    throw new Error("name, url, and events required");
  }
  const scope = normalizeScope(input.scope);
  assertValidScope(scope);
  const now = new Date().toISOString();
  const config: OutboundWebhookConfig = {
    id: crypto.randomUUID(),
    name,
    url,
    events,
    scope,
    active: input.active !== false,
    createdAt: now,
    updatedAt: now,
    ...(typeof input.secret === "string" && input.secret ? { secretEncrypted: encrypt(input.secret) } : {}),
    headers: normalizeHeaders(input.headers),
  };
  const configs = listOutboundWebhooks(namespaceId, orgId);
  configs.push(config);
  saveOutboundWebhooks(namespaceId, orgId, configs);
  return config;
}

export function updateOutboundWebhook(
  namespaceId: string,
  orgId: string,
  id: string,
  input: Partial<{
    name: unknown;
    url: unknown;
    events: unknown;
    scope: unknown;
    secret: unknown;
    active: unknown;
    headers: unknown;
  }>
): OutboundWebhookConfig | null {
  const configs = listOutboundWebhooks(namespaceId, orgId);
  const idx = configs.findIndex((config) => config.id === id);
  if (idx === -1) return null;
  const current = configs[idx];
  const normalizedUrl = input.url !== undefined ? normalizeUrl(input.url) : undefined;
  if (input.url !== undefined && !normalizedUrl) {
    throw new Error("valid url required");
  }
  if (input.scope !== undefined) {
    assertValidScope(normalizeScope(input.scope));
  }
  const next: OutboundWebhookConfig = {
    ...current,
    ...(input.name !== undefined && typeof input.name === "string" ? { name: input.name.trim() } : {}),
    ...(normalizedUrl ? { url: normalizedUrl } : {}),
    ...(input.events !== undefined ? { events: normalizeEvents(input.events) } : {}),
    ...(input.scope !== undefined ? { scope: normalizeScope(input.scope) } : {}),
    ...(input.active !== undefined ? { active: Boolean(input.active) } : {}),
    ...(input.headers !== undefined ? { headers: normalizeHeaders(input.headers) } : {}),
    ...(typeof input.secret === "string" && input.secret ? { secretEncrypted: encrypt(input.secret) } : {}),
    updatedAt: new Date().toISOString(),
  };
  const normalized = normalizeStoredConfig(next);
  configs[idx] = normalized;
  saveOutboundWebhooks(namespaceId, orgId, configs);
  return normalized;
}

export function deleteOutboundWebhook(namespaceId: string, orgId: string, id: string): boolean {
  const configs = listOutboundWebhooks(namespaceId, orgId);
  const filtered = configs.filter((config) => config.id !== id);
  if (filtered.length === configs.length) return false;
  saveOutboundWebhooks(namespaceId, orgId, filtered);
  return true;
}

export function getOutboundWebhookSecret(config: OutboundWebhookConfig): string | undefined {
  if (config.secretEncrypted) return decrypt(config.secretEncrypted) || undefined;
  return config.secret;
}

export function listOutboundWebhooksForEvent(
  namespaceId: string,
  orgId: string,
  event: string,
  chainId?: string
): OutboundWebhookConfig[] {
  const aliases = eventAliases(event);
  return listOutboundWebhooks(namespaceId, orgId).filter((config) =>
    config.active &&
    config.events.some((candidate) => aliases.includes(candidate)) &&
    outboundWebhookFiresForChain(config, chainId)
  );
}

export function appendOutboundDelivery(
  namespaceId: string,
  orgId: string,
  delivery: OutboundWebhookDelivery
): void {
  const filePath = getDeliveriesPath(namespaceId, orgId);
  ensureParentDir(filePath);
  appendFileSync(filePath, `${JSON.stringify(delivery)}\n`);
}

export function listOutboundDeliveries(
  namespaceId: string,
  orgId: string,
  webhookId: string,
  limit = 10
): OutboundWebhookDelivery[] {
  const filePath = getDeliveriesPath(namespaceId, orgId);
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
  const deliveries: OutboundWebhookDelivery[] = [];
  for (let i = lines.length - 1; i >= 0 && deliveries.length < limit; i--) {
    try {
      const delivery = JSON.parse(lines[i]) as OutboundWebhookDelivery;
      if (delivery.webhookId === webhookId) deliveries.push(delivery);
    } catch {
      // skip malformed rows
    }
  }
  return deliveries;
}

export function signOutboundPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
