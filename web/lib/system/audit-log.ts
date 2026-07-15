import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import config, { nsPath } from "@/lib/config";

export interface AuditEntry {
  id: string;
  timestamp: string;
  event_type: string;
  description: string;
  user: string;
  source: string;
  ip: string;
  hostname: string;
  metadata: Record<string, string>;
}

export interface AuditLogMetadata {
  [key: string]: string | number | boolean | null | undefined;
}

export interface AuditPaths {
  dir: string;
  logFile: string;
  indexFile: string;
}

const INDEX_LIMIT = 1_001;
const MAX_EVENT_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 16_000;
const PII_KEYS = new Set(["email", "name", "user_email", "user_name", "username"]);

export function resolveAuditPaths(namespaceId = config.namespaceId): AuditPaths {
  const dir = nsPath(namespaceId, "audit");
  return { dir, logFile: join(dir, "audit.log"), indexFile: join(dir, "index.json") };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEntry(value: unknown): AuditEntry {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.timestamp !== "string"
    || typeof value.event_type !== "string"
    || typeof value.description !== "string"
    || typeof value.user !== "string"
    || typeof value.source !== "string"
    || typeof value.ip !== "string"
    || typeof value.hostname !== "string"
    || !isRecord(value.metadata)) {
    throw new Error("Invalid audit entry");
  }
  const metadata: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value.metadata)) {
    if (typeof entry !== "string") throw new Error("Invalid audit metadata value");
    metadata[key] = entry;
  }
  return { id: value.id, timestamp: value.timestamp, event_type: value.event_type, description: value.description, user: value.user, source: value.source, ip: value.ip, hostname: value.hostname, metadata };
}

function readIndex(paths: AuditPaths): AuditEntry[] {
  if (!existsSync(paths.indexFile)) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(paths.indexFile, "utf8")); } catch { throw new Error(`Invalid audit index: ${paths.indexFile}`); }
  if (!Array.isArray(parsed)) throw new Error(`Invalid audit index: ${paths.indexFile}`);
  return parsed.map(parseEntry);
}

function readLog(paths: AuditPaths): AuditEntry[] {
  if (!existsSync(paths.logFile)) return [];
  const entries: AuditEntry[] = [];
  for (const line of readFileSync(paths.logFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(parseEntry(JSON.parse(line))); } catch { throw new Error(`Invalid audit log entry in ${paths.logFile}`); }
  }
  return entries;
}

function writeIndex(paths: AuditPaths, entries: AuditEntry[]): void {
  const temp = `${paths.indexFile}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(entries.slice(0, INDEX_LIMIT), null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, paths.indexFile);
}

function sanitizeMetadata(metadata: AuditLogMetadata): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(metadata)) {
    if (raw === null || raw === undefined || raw === "") continue;
    if (PII_KEYS.has(key.toLowerCase())) continue;
    const value = String(raw);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function sanitizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f]/.test(normalized)) throw new Error(`Invalid audit ${field}`);
  return normalized;
}

function currentUser(): string {
  return process.env.AUDIT_USER || process.env.LOGNAME || process.env.USER || "unknown";
}

function currentHost(): string {
  return process.env.HOSTNAME || "unknown";
}

/** Write the append-only record and its bounded query index as one typed mutation. */
export function writeAuditLog(input: {
  namespaceId?: string;
  eventType: string;
  description: string;
  metadata?: AuditLogMetadata;
  source?: string;
  ip?: string;
}): AuditEntry {
  const paths = resolveAuditPaths(input.namespaceId);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const entry: AuditEntry = {
    // Retain the public audit ID grammar used by existing index/log records:
    // epoch-like nanoseconds plus PID. The high-resolution suffix preserves the
    // same shape without changing CLI/API consumers that parse the numeric form.
    id: `audit_${Date.now()}${String(process.hrtime()[1] % 1_000_000).padStart(6, "0")}_${process.pid}`,
    timestamp: new Date().toISOString(),
    event_type: sanitizeText(input.eventType, "event type", MAX_EVENT_LENGTH),
    description: sanitizeText(input.description, "description", MAX_DESCRIPTION_LENGTH),
    user: currentUser(),
    source: input.source || "system",
    ip: input.ip || "",
    hostname: currentHost(),
    metadata: sanitizeMetadata(input.metadata ?? {}),
  };
  const serialized = JSON.stringify(entry);
  appendFileSync(paths.logFile, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
  writeIndex(paths, [entry, ...readIndex(paths)]);
  // Remote shipping is optional and detached from the local audit commit. A
  // missing entrypoint or spawn failure must never become an unhandled
  // rejection in the request that already persisted this record.
  void shipAuditEntry(serialized, paths, input.namespaceId ?? config.namespaceId).catch(() => undefined);
  return entry;
}

export type AuditFilterType = "all" | "event_type" | "user" | "chain" | "run_id" | "auth";

export function queryAuditLog(input: {
  namespaceId?: string;
  filterType?: AuditFilterType;
  filterValue?: string;
  since?: string;
  limit?: number;
}): AuditEntry[] {
  const filterType = input.filterType ?? "all";
  if (!["all", "event_type", "user", "chain", "run_id", "auth"].includes(filterType)) throw new Error("Invalid audit filter type");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > INDEX_LIMIT) throw new Error("Invalid audit query limit");
  const since = input.since ? Date.parse(input.since) : undefined;
  if (input.since && Number.isNaN(since)) throw new Error("Invalid audit since timestamp");
  const filterValue = input.filterValue ?? "";
  return readIndex(resolveAuditPaths(input.namespaceId)).filter((entry) => {
    if (since !== undefined && Date.parse(entry.timestamp) < since) return false;
    if (filterType === "event_type") return entry.event_type === filterValue;
    if (filterType === "user") return entry.user === filterValue;
    if (filterType === "chain") return (entry.event_type === "chain_start" || entry.event_type === "chain_complete") && entry.metadata.chain_name === filterValue;
    if (filterType === "run_id") return entry.metadata.run_id === filterValue;
    if (filterType === "auth") return entry.event_type === "auth";
    return true;
  }).slice(0, limit);
}

export function exportAuditLog(input: { namespaceId?: string; since?: string; eventType?: string }): AuditEntry[] {
  const since = input.since ? Date.parse(input.since) : undefined;
  if (input.since && Number.isNaN(since)) throw new Error("Invalid audit since timestamp");
  return readLog(resolveAuditPaths(input.namespaceId)).filter((entry) =>
    (!input.eventType || entry.event_type === input.eventType)
    && (since === undefined || Date.parse(entry.timestamp) >= since),
  );
}

export function auditCsv(entries: AuditEntry[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = "id,timestamp,event_type,description,user,source,ip,hostname,metadata";
  return [header, ...entries.map((entry) => [entry.id, entry.timestamp, entry.event_type, entry.description, entry.user, entry.source, entry.ip, entry.hostname, JSON.stringify(entry.metadata)].map(quote).join(","))].join("\n") + "\n";
}

export function summarizeAuditLog(namespaceId = config.namespaceId): { paths: AuditPaths; entries: AuditEntry[]; authCount: number; eventCounts: Map<string, number> } {
  const paths = resolveAuditPaths(namespaceId);
  const entries = readIndex(paths);
  const eventCounts = new Map<string, number>();
  for (const entry of entries) eventCounts.set(entry.event_type, (eventCounts.get(entry.event_type) ?? 0) + 1);
  return { paths, entries, authCount: entries.filter((entry) => entry.event_type === "auth").length, eventCounts };
}

export function archiveAuditLog(input: { namespaceId?: string; days: number; now?: Date }): { archiveFile?: string; archived: number } {
  if (!Number.isInteger(input.days) || input.days < 0 || input.days > 36500) throw new Error("Invalid audit archive days");
  const paths = resolveAuditPaths(input.namespaceId);
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - input.days * 86_400_000;
  const entries = readLog(paths);
  const archived = entries.filter((entry) => Date.parse(entry.timestamp) < cutoff);
  const retained = entries.filter((entry) => Date.parse(entry.timestamp) >= cutoff);
  if (!archived.length) return { archived: 0 };
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const archiveFile = join(paths.dir, `archive-${datePart}.jsonl.gz`);
  writeFileSync(archiveFile, gzipSync(Buffer.from(archived.map((entry) => JSON.stringify(entry)).join("\n") + "\n")), { mode: 0o600 });
  writeFileSync(paths.logFile, retained.map((entry) => JSON.stringify(entry)).join("\n") + (retained.length ? "\n" : ""), { mode: 0o600 });
  writeIndex(paths, retained.slice().reverse());
  return { archiveFile, archived: archived.length };
}

export function clearAuditLog(namespaceId = config.namespaceId): void {
  const paths = resolveAuditPaths(namespaceId);
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  writeFileSync(paths.logFile, "", { mode: 0o600 });
  writeIndex(paths, []);
}

function shipAuditEntry(entry: string, paths: AuditPaths, namespaceId: string): Promise<void> {
  if (!process.env.AUDIT_REMOTE_URL) return Promise.resolve();
  const shipper = join(config.codeRoot, "lib", "audit-ship.sh");
  if (!existsSync(shipper)) return Promise.reject(new Error(`Audit shipper is missing: ${shipper}`));
  const child = spawn("bash", [shipper], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: {
      ...process.env,
      MENTIKO_CODE_ROOT: config.codeRoot,
      AUDIT_DIR: paths.dir,
      NAMESPACE_ID: namespaceId,
    },
  });
  child.stdin.write(`${entry}\n`);
  child.stdin.end();
  child.unref();
  return Promise.resolve();
}
