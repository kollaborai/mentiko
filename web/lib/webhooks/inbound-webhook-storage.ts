import { closeSync, existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, openSync, unlinkSync } from "fs";
import path from "path";
import { orgPath } from "../config";
import { createHash, randomBytes } from "crypto";
import type { OrgRole } from "../orgs/org-types";

const FILE_NAME = "inbound-webhooks.json";
// Trigger ledger is append-only JSONL (one full snapshot per write); the
// latest state per trigger id is reconstructed by folding. The legacy
// `.json` array file is still read as a fallback during migration.
const TRIGGERS_FILE_NAME = "inbound-webhook-triggers.jsonl";
const LEGACY_TRIGGERS_FILE_NAME = "inbound-webhook-triggers.json";
const IDEMPOTENCY_FILE_NAME = "inbound-webhook-idempotency.jsonl";
const IDEMPOTENCY_CLAIMS_DIR = "inbound-webhook-idempotency-claims";
// Retention/compaction bounds so the append-only logs stay bounded.
const MAX_RETAINED_TRIGGERS = 500;
const TRIGGER_COMPACT_THRESHOLD = 2000;
const MAX_IDEMPOTENCY_RECORDS = 2000;
const IDEMPOTENCY_COMPACT_THRESHOLD = 4000;
const IDEMPOTENCY_CLAIM_TTL_MS = 30 * 60 * 1000;

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
  createdByRole?: OrgRole;
  runDefaults?: InboundWebhookRunDefaults;
  allowedOverrides?: InboundWebhookAllowedOverrides;
  // Optional payload path (e.g. "delivery.id" or "head_commit.id") used to
  // derive an idempotency key when the request has no Idempotency-Key header.
  idempotencyKeyPath?: string;
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
  createdByRole?: OrgRole;
  runDefaults?: InboundWebhookRunDefaults;
  allowedOverrides?: InboundWebhookAllowedOverrides;
  idempotencyKeyPath?: string;
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
  id?: string;
  webhookId: string;
  chainId?: string;
  scheduleId?: string;
  status?: InboundTriggerStatus;
  payload?: unknown;
  headers?: Record<string, string>;
}

export interface InboundIdempotencyRecord {
  webhookId: string;
  idempotencyKey: string;
  triggerId: string;
  runId?: string;
  createdAt: string;
}

export interface InboundIdempotencyClaimResult {
  claimed: boolean;
  record: InboundIdempotencyRecord;
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

// --- append-only JSONL helpers (used by the trigger ledger + idempotency log) ---

function readJsonlRecords<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const out: T[] = [];
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed rows
    }
  }
  return out;
}

function appendJsonlRecord<T>(filePath: string, record: T): void {
  ensureParentDir(filePath);
  appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function rewriteJsonlRecords<T>(filePath: string, records: T[]): void {
  ensureParentDir(filePath);
  writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
}

function countJsonlLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, "utf-8").split("\n").filter((line) => line.trim()).length;
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
    createdByRole: input.createdByRole,
    runDefaults: normalizeRunDefaults(input.runDefaults),
    allowedOverrides: normalizeAllowedOverrides(input.allowedOverrides),
    idempotencyKeyPath: sanitizeString(input.idempotencyKeyPath, 200),
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

function getIdempotencyFilePath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, IDEMPOTENCY_FILE_NAME);
}

function getIdempotencyClaimsDir(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, IDEMPOTENCY_CLAIMS_DIR);
}

function getIdempotencyClaimPath(
  namespaceId: string,
  orgId: string,
  webhookId: string,
  idempotencyKey: string
): string {
  const keyHash = createHash("sha256").update(`${webhookId}\n${idempotencyKey}`).digest("hex");
  return path.join(getIdempotencyClaimsDir(namespaceId, orgId), `${keyHash}.json`);
}

function readIdempotencyClaimFile(filePath: string): InboundIdempotencyRecord | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as InboundIdempotencyRecord : null;
  } catch {
    return null;
  }
}

function isStaleIdempotencyClaim(record: InboundIdempotencyRecord): boolean {
  const createdAt = Date.parse(record.createdAt);
  return Number.isFinite(createdAt) && Date.now() - createdAt > IDEMPOTENCY_CLAIM_TTL_MS;
}

function removeFileIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // another process may already have released the claim
  }
}

// Fold the append-only trigger ledger into the latest snapshot per trigger id.
// Falls back to the legacy `.json` array file when the JSONL ledger is absent.
function foldTriggerSnapshots(namespaceId: string, orgId: string): Map<string, InboundWebhookTrigger> {
  const map = new Map<string, InboundWebhookTrigger>();
  const filePath = getTriggersFilePath(namespaceId, orgId);
  const source = existsSync(filePath)
    ? readJsonlRecords<InboundWebhookTrigger>(filePath)
    : readJsonArray<InboundWebhookTrigger>(orgPath(namespaceId, orgId, LEGACY_TRIGGERS_FILE_NAME));
  for (const snapshot of source) {
    if (snapshot && typeof snapshot.id === "string") map.set(snapshot.id, snapshot);
  }
  return map;
}

function compactInboundTriggers(namespaceId: string, orgId: string): void {
  const retained = Array.from(foldTriggerSnapshots(namespaceId, orgId).values())
    .sort((a, b) => (a.acceptedAt < b.acceptedAt ? 1 : a.acceptedAt > b.acceptedAt ? -1 : 0))
    .slice(0, MAX_RETAINED_TRIGGERS)
    .reverse();
  rewriteJsonlRecords(getTriggersFilePath(namespaceId, orgId), retained);
}

function appendTriggerSnapshot(namespaceId: string, orgId: string, trigger: InboundWebhookTrigger): void {
  const filePath = getTriggersFilePath(namespaceId, orgId);
  appendJsonlRecord(filePath, trigger);
  if (countJsonlLines(filePath) > TRIGGER_COMPACT_THRESHOLD) {
    compactInboundTriggers(namespaceId, orgId);
  }
}

export function listInboundTriggers(namespaceId: string, orgId: string): InboundWebhookTrigger[] {
  return Array.from(foldTriggerSnapshots(namespaceId, orgId).values())
    .sort((a, b) => (a.acceptedAt < b.acceptedAt ? -1 : a.acceptedAt > b.acceptedAt ? 1 : 0));
}

// Compaction primitive: rewrite the ledger as one snapshot line per trigger.
export function saveInboundTriggers(namespaceId: string, orgId: string, triggers: InboundWebhookTrigger[]): void {
  rewriteJsonlRecords(getTriggersFilePath(namespaceId, orgId), triggers);
}

export function createInboundTrigger(
  namespaceId: string,
  orgId: string,
  input: CreateInboundTriggerInput
): { trigger: InboundWebhookTrigger; statusToken: string } {
  const { statusToken, statusTokenHash, statusTokenPreview } = generateStatusToken();
  const now = new Date().toISOString();
  const trigger: InboundWebhookTrigger = {
    id: input.id || crypto.randomUUID(),
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
  appendTriggerSnapshot(namespaceId, orgId, trigger);
  return { trigger, statusToken };
}

export function updateInboundTrigger(
  namespaceId: string,
  orgId: string,
  triggerId: string,
  updates: Partial<Pick<InboundWebhookTrigger, "status" | "runId" | "error">>
): InboundWebhookTrigger | null {
  const current = foldTriggerSnapshots(namespaceId, orgId).get(triggerId);
  if (!current) return null;

  const now = new Date().toISOString();
  const next: InboundWebhookTrigger = {
    ...current,
    ...updates,
    ...(updates.status === "started" ? { startedAt: current.startedAt || now } : {}),
    ...(updates.status === "failed" ? { failedAt: current.failedAt || now } : {}),
  };
  appendTriggerSnapshot(namespaceId, orgId, next);
  return next;
}

export function getInboundTriggerById(
  namespaceId: string,
  orgId: string,
  triggerId: string
): InboundWebhookTrigger | null {
  return foldTriggerSnapshots(namespaceId, orgId).get(triggerId) ?? null;
}

export function findInboundTriggerByStatusToken(
  namespaceId: string,
  orgId: string,
  triggerId: string,
  statusToken: string
): InboundWebhookTrigger | null {
  const hash = hashToken(statusToken);
  const trigger = foldTriggerSnapshots(namespaceId, orgId).get(triggerId);
  return trigger && trigger.statusTokenHash === hash ? trigger : null;
}

// --- inbound idempotency (dedupe repeated source deliveries) ---

export function findInboundIdempotency(
  namespaceId: string,
  orgId: string,
  webhookId: string,
  idempotencyKey: string
): InboundIdempotencyRecord | null {
  let found: InboundIdempotencyRecord | null = null;
  for (const record of readJsonlRecords<InboundIdempotencyRecord>(getIdempotencyFilePath(namespaceId, orgId))) {
    if (record && record.webhookId === webhookId && record.idempotencyKey === idempotencyKey) {
      found = record; // last write wins
    }
  }
  if (found) return found;

  const claimPath = getIdempotencyClaimPath(namespaceId, orgId, webhookId, idempotencyKey);
  const claim = readIdempotencyClaimFile(claimPath);
  if (!claim || claim.webhookId !== webhookId || claim.idempotencyKey !== idempotencyKey) {
    removeFileIfExists(claimPath);
    return null;
  }
  if (isStaleIdempotencyClaim(claim)) {
    removeFileIfExists(claimPath);
    return null;
  }
  return claim;
}

function compactInboundIdempotency(namespaceId: string, orgId: string): void {
  const map = new Map<string, InboundIdempotencyRecord>();
  for (const record of readJsonlRecords<InboundIdempotencyRecord>(getIdempotencyFilePath(namespaceId, orgId))) {
    if (record && record.webhookId && record.idempotencyKey) {
      map.set(`${record.webhookId}::${record.idempotencyKey}`, record);
    }
  }
  const retained = Array.from(map.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, MAX_IDEMPOTENCY_RECORDS)
    .reverse();
  rewriteJsonlRecords(getIdempotencyFilePath(namespaceId, orgId), retained);
}

export function claimInboundIdempotency(
  namespaceId: string,
  orgId: string,
  input: { webhookId: string; idempotencyKey: string; triggerId: string }
): InboundIdempotencyClaimResult {
  const existing = findInboundIdempotency(namespaceId, orgId, input.webhookId, input.idempotencyKey);
  if (existing) return { claimed: false, record: existing };

  const record: InboundIdempotencyRecord = {
    webhookId: input.webhookId,
    idempotencyKey: input.idempotencyKey,
    triggerId: input.triggerId,
    createdAt: new Date().toISOString(),
  };
  const filePath = getIdempotencyClaimPath(namespaceId, orgId, input.webhookId, input.idempotencyKey);
  ensureParentDir(filePath);
  try {
    const fd = openSync(filePath, "wx");
    try {
      writeFileSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    return { claimed: true, record };
  } catch {
    const claimed = findInboundIdempotency(namespaceId, orgId, input.webhookId, input.idempotencyKey);
    if (claimed) return { claimed: false, record: claimed };
    throw new Error("failed to claim idempotency key");
  }
}

export function releaseInboundIdempotencyClaim(
  namespaceId: string,
  orgId: string,
  webhookId: string,
  idempotencyKey: string
): void {
  removeFileIfExists(getIdempotencyClaimPath(namespaceId, orgId, webhookId, idempotencyKey));
}

export function finalizeInboundIdempotency(
  namespaceId: string,
  orgId: string,
  input: { webhookId: string; idempotencyKey: string; triggerId: string; runId?: string }
): InboundIdempotencyRecord {
  const record: InboundIdempotencyRecord = {
    webhookId: input.webhookId,
    idempotencyKey: input.idempotencyKey,
    triggerId: input.triggerId,
    ...(input.runId ? { runId: input.runId } : {}),
    createdAt: new Date().toISOString(),
  };
  const filePath = getIdempotencyFilePath(namespaceId, orgId);
  appendJsonlRecord(filePath, record);
  if (countJsonlLines(filePath) > IDEMPOTENCY_COMPACT_THRESHOLD) {
    compactInboundIdempotency(namespaceId, orgId);
  }
  releaseInboundIdempotencyClaim(namespaceId, orgId, input.webhookId, input.idempotencyKey);
  return record;
}

export function recordInboundIdempotency(
  namespaceId: string,
  orgId: string,
  input: { webhookId: string; idempotencyKey: string; triggerId: string; runId?: string }
): InboundIdempotencyRecord {
  return finalizeInboundIdempotency(namespaceId, orgId, input);
}
