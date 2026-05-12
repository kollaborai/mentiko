/**
 * email bounce handling
 * processes bounces from haraka DSN, updates outbound-sent records,
 * writes suppressions, emits events, tracks reputation
 */

import { mkdirSync, promises as fs } from "fs";
import { join } from "path";
import { createHmac } from "crypto";
import config from "./config";
import Database from "better-sqlite3";
import type {
  BouncePayload,
  BounceRecord,
  SuppressionEntry,
  OutboundSentEntry,
  BounceType,
} from "./email-types";
import { resolveAppSecret } from "./dev-secret";

const EMAIL_BASE = "emails";
const SOFT_BOUNCE_DAYS = 30;
const BOUNCE_DB = "email-bounces.db";

// ---------------------------------------------------------------------------
// path helpers
// ---------------------------------------------------------------------------

function getEmailBase(namespaceId: string): string {
  return join(config.namespacesBase, namespaceId, EMAIL_BASE);
}

function getBounceDbPath(namespaceId: string): string {
  const baseDir = getEmailBase(namespaceId);
  mkdirSync(baseDir, { recursive: true });
  return join(baseDir, "config", BOUNCE_DB);
}

function getBounceDb(namespaceId: string): Database.Database {
  const dbPath = getBounceDbPath(namespaceId);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

function initBounceSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bounce_hashes (
      namespace_id TEXT NOT NULL,
      outbound_id TEXT NOT NULL,
      recipient_hash TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY (namespace_id, outbound_id, recipient_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_bounce_hashes_outbound
      ON bounce_hashes(outbound_id);

    CREATE INDEX IF NOT EXISTS idx_bounce_hashes_processed
      ON bounce_hashes(processed_at);
  `);
}

function getOutboundSentDir(namespaceId: string): string {
  return join(getEmailBase(namespaceId), "outbound-sent");
}

function getSuppressionsDir(namespaceId: string): string {
  return join(getEmailBase(namespaceId), "suppressions");
}

function getBouncesDir(namespaceId: string): string {
  return join(getEmailBase(namespaceId), "bounces");
}

function getUnmatchedBouncesDir(namespaceId: string): string {
  return join(getBouncesDir(namespaceId), "unmatched");
}

// ---------------------------------------------------------------------------
// duplicate detection (idempotent, atomic)
// ---------------------------------------------------------------------------

function bounceHash(namespaceId: string, recipient: string): string {
  const secret = resolveAppSecret("email-bounce");
  const normalizedRecipient = recipient.toLowerCase().trim();
  return createHmac("sha256", secret)
    .update(`${namespaceId}:${normalizedRecipient}`)
    .digest("hex");
}

/**
 * atomic duplicate check using SQLite.
 * returns true if this (outboundId, recipient) was already processed.
 */
export function isDuplicate(
  namespaceId: string,
  outboundId: string,
  recipient: string
): boolean {
  const db = getBounceDb(namespaceId);
  try {
    initBounceSchema(db);

    const recipientHash = bounceHash(namespaceId, recipient);

    const row = db
      .prepare(
        `
        SELECT 1 FROM bounce_hashes
        WHERE namespace_id = ? AND outbound_id = ? AND recipient_hash = ?
        LIMIT 1
      `
      )
      .get(namespaceId, outboundId, recipientHash) as { 1: number } | undefined;

    return !!row;
  } finally {
    db.close();
  }
}

/**
 * mark bounce as processed. atomic INSERT OR IGNORE.
 * returns true if inserted (new), false if duplicate (already existed).
 */
function markProcessed(
  namespaceId: string,
  outboundId: string,
  recipient: string
): boolean {
  const db = getBounceDb(namespaceId);
  try {
    initBounceSchema(db);

    const recipientHash = bounceHash(namespaceId, recipient);
    const processedAt = new Date().toISOString();

    const result = db
      .prepare(
        `
        INSERT OR IGNORE INTO bounce_hashes
          (namespace_id, outbound_id, recipient_hash, processed_at)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(namespaceId, outboundId, recipientHash, processedAt);

    return result.changes > 0;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// outbound-sent record lookup
// ---------------------------------------------------------------------------

export async function findOutboundSent(
  namespaceId: string,
  outboundId: string
): Promise<OutboundSentEntry | null> {
  const path = join(getOutboundSentDir(namespaceId), `${outboundId}.json`);
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as OutboundSentEntry;
  } catch {
    return null;
  }
}

async function updateOutboundSentAsBounced(
  namespaceId: string,
  outboundId: string,
  bounceType: BounceType,
  status: string,
  diagnosticCode?: string
): Promise<void> {
  const path = join(getOutboundSentDir(namespaceId), `${outboundId}.json`);
  const data = await fs.readFile(path, "utf-8");
  const entry = JSON.parse(data) as OutboundSentEntry;

  entry.status = "bounced";
  entry.bouncedAt = new Date().toISOString();
  entry.updatedAt = entry.bouncedAt;
  entry.bounceInfo = {
    bounceType,
    status,
    diagnosticCode,
  };

  await fs.writeFile(path, JSON.stringify(entry, null, 2));
}

// ---------------------------------------------------------------------------
// suppressions
// ---------------------------------------------------------------------------

function softBounceExpiry(): string {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + SOFT_BOUNCE_DAYS);
  return expiry.toISOString();
}

/**
 * write suppression with error handling.
 * returns true on success, false on failure.
 */
export async function writeSuppression(
  namespaceId: string,
  recipient: string,
  bounceType: BounceType,
  reason: string
): Promise<boolean> {
  try {
    await fs.mkdir(getSuppressionsDir(namespaceId), { recursive: true });

    // filename is sanitized recipient
    const sanitized = recipient.replace(/[^a-zA-Z0-9@._-]/g, "_");
    const path = join(getSuppressionsDir(namespaceId), `${sanitized}.json`);

    const entry: SuppressionEntry = {
      recipient,
      bounceType,
      suppressedAt: new Date().toISOString(),
      expiresAt: bounceType === "soft" ? softBounceExpiry() : null,
      reason,
    };

    await fs.writeFile(path, JSON.stringify(entry, null, 2));
    return true;
  } catch (error) {
    // log but don't throw - caller can decide whether to rollback
    console.error("[email-bounce] writeSuppression failed:", {
      namespaceId,
      recipient,
      bounceType,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function isSuppressed(
  namespaceId: string,
  recipient: string
): Promise<SuppressionEntry | null> {
  const sanitized = recipient.replace(/[^a-zA-Z0-9@._-]/g, "_");
  const path = join(getSuppressionsDir(namespaceId), `${sanitized}.json`);
  try {
    const data = await fs.readFile(path, "utf-8");
    const entry = JSON.parse(data) as SuppressionEntry;

    // check expiry for soft bounces
    if (entry.expiresAt) {
      const expiry = new Date(entry.expiresAt);
      if (expiry < new Date()) {
        // expired, delete and return null
        await fs.unlink(path);
        return null;
      }
    }

    return entry;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// unmatched bounces storage
// ---------------------------------------------------------------------------

async function writeUnmatchedBounce(
  namespaceId: string,
  payload: BouncePayload
): Promise<void> {
  await fs.mkdir(getUnmatchedBouncesDir(namespaceId), { recursive: true });
  const timestamp = Date.now();
  const path = join(
    getUnmatchedBouncesDir(namespaceId),
    `${timestamp}-${crypto.randomUUID()}.json`
  );
  await fs.writeFile(path, JSON.stringify(payload, null, 2));
}

// ---------------------------------------------------------------------------
// bounce record storage (audit trail)
// ---------------------------------------------------------------------------

async function writeBounceRecord(
  namespaceId: string,
  record: BounceRecord
): Promise<void> {
  await fs.mkdir(getBouncesDir(namespaceId), { recursive: true });
  const path = join(getBouncesDir(namespaceId), `${record.id}.json`);
  await fs.writeFile(path, JSON.stringify(record, null, 2));
}

// ---------------------------------------------------------------------------
// reputation tracking
// ---------------------------------------------------------------------------

interface ReputationStats {
  hardBounces: number;
  softBounces: number;
  totalSent: number;
  lastUpdated: string;
}

const REPUTATION_FILE = "reputation.json";

async function getReputation(namespaceId: string): Promise<ReputationStats> {
  const path = join(getEmailBase(namespaceId), REPUTATION_FILE);
  try {
    const data = await fs.readFile(path, "utf-8");
    return JSON.parse(data) as ReputationStats;
  } catch {
    return {
      hardBounces: 0,
      softBounces: 0,
      totalSent: 0,
      lastUpdated: new Date().toISOString(),
    };
  }
}

async function updateReputation(
  namespaceId: string,
  bounceType: BounceType
): Promise<ReputationStats> {
  const stats = await getReputation(namespaceId);

  if (bounceType === "hard") {
    stats.hardBounces++;
  } else if (bounceType === "soft") {
    stats.softBounces++;
  }

  stats.lastUpdated = new Date().toISOString();

  await fs.mkdir(getEmailBase(namespaceId), { recursive: true });
  const path = join(getEmailBase(namespaceId), REPUTATION_FILE);
  await fs.writeFile(path, JSON.stringify(stats, null, 2));

  return stats;
}

export async function getReputationScore(
  namespaceId: string
): Promise<{ score: number; stats: ReputationStats }> {
  const stats = await getReputation(namespaceId);

  // simple score: 100 - (hardBounces * 10 + softBounces * 2)
  // min 0, max 100
  const penalty = stats.hardBounces * 10 + stats.softBounces * 2;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { score, stats };
}

// ---------------------------------------------------------------------------
// main bounce processor
// ---------------------------------------------------------------------------

export interface ProcessBounceResult {
  processed: boolean;
  duplicate: boolean;
  unmatched: boolean;
  autoReplyDiscarded: boolean;
  suppressionWritten: boolean;
  recordId?: string;
  reason?: string;
}

export async function processBounce(
  namespaceId: string,
  payload: BouncePayload
): Promise<ProcessBounceResult> {
  // 1. validate required fields
  if (!payload.outboundId || !payload.recipient) {
    return {
      processed: false,
      duplicate: false,
      unmatched: false,
      autoReplyDiscarded: false,
      suppressionWritten: false,
      reason: "missing_required_fields",
    };
  }

  // 2. check for duplicate (idempotent, atomic)
  if (isDuplicate(namespaceId, payload.outboundId, payload.recipient)) {
    return {
      processed: true,
      duplicate: true,
      unmatched: false,
      autoReplyDiscarded: false,
      suppressionWritten: false,
      reason: "duplicate_bounce",
    };
  }

  // 3. handle auto_reply/vacation (discard, no suppression)
  if (payload.bounceType === "auto_reply" || payload.bounceType === "vacation") {
    // mark as processed first, then return (atomic, no rollback needed)
    markProcessed(namespaceId, payload.outboundId, payload.recipient);
    return {
      processed: true,
      duplicate: false,
      unmatched: false,
      autoReplyDiscarded: true,
      suppressionWritten: false,
      reason: "auto_reply_discarded",
    };
  }

  // 4. find outbound-sent record
  const sentEntry = await findOutboundSent(namespaceId, payload.outboundId);
  if (!sentEntry) {
    // unmatched bounce - save for investigation
    // DO NOT mark as processed - we want to retry if outbound record appears later
    await writeUnmatchedBounce(namespaceId, payload);
    return {
      processed: false,
      duplicate: false,
      unmatched: true,
      autoReplyDiscarded: false,
      suppressionWritten: false,
      reason: "outbound_not_found",
    };
  }

  // 5-7. perform all writes (order matters for rollback on failure)
  let suppressionSuccess = false;
  let bounceRecordId: string | undefined;

  try {
    // 5. update outbound-sent record
    await updateOutboundSentAsBounced(
      namespaceId,
      payload.outboundId,
      payload.bounceType,
      payload.status,
      payload.diagnosticCode
    );

    // 6. write suppression (hard = permanent, soft = 30 day)
    suppressionSuccess = await writeSuppression(
      namespaceId,
      payload.recipient,
      payload.bounceType,
      payload.diagnosticCode || payload.status
    );

    // 7. create bounce record (audit trail)
    bounceRecordId = crypto.randomUUID();
    const record: BounceRecord = {
      id: bounceRecordId,
      outboundId: payload.outboundId,
      recipient: payload.recipient,
      bounceType: payload.bounceType,
      action: payload.action,
      status: payload.status,
      diagnosticCode: payload.diagnosticCode,
      processedAt: new Date().toISOString(),
      namespaceId,
    };
    await writeBounceRecord(namespaceId, record);

    // 8. update reputation
    await updateReputation(namespaceId, payload.bounceType);

    // 9. CRITICAL: mark as processed LAST after all writes succeed
    // this ensures idempotency - if any step fails, we'll retry
    markProcessed(namespaceId, payload.outboundId, payload.recipient);

    return {
      processed: true,
      duplicate: false,
      unmatched: false,
      autoReplyDiscarded: false,
      suppressionWritten: suppressionSuccess,
      recordId: bounceRecordId,
    };
  } catch (error) {
    // if we failed after updating outbound-sent, the hash wasn't saved
    // so next retry will process again. this is intentional.
    console.error("[email-bounce] processBounce failed:", {
      namespaceId,
      outboundId: payload.outboundId,
      recipient: payload.recipient,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      processed: false,
      duplicate: false,
      unmatched: false,
      autoReplyDiscarded: false,
      suppressionWritten: false,
      reason: "processing_failed",
    };
  }
}

// ---------------------------------------------------------------------------
// event emission helper
// ---------------------------------------------------------------------------

export async function emitBounceEvent(
  namespaceId: string,
  payload: BouncePayload,
  result: ProcessBounceResult
): Promise<void> {
  try {
    const { getEventBus } = await import("./event-bus");
    const bus = getEventBus();

    bus.eventEmitted("email_bounced", {
      namespaceId,
      outboundId: payload.outboundId,
      recipient: payload.recipient,
      bounceType: payload.bounceType,
      status: payload.status,
      result: {
        processed: result.processed,
        duplicate: result.duplicate,
        unmatched: result.unmatched,
        autoReplyDiscarded: result.autoReplyDiscarded,
        suppressionWritten: result.suppressionWritten,
      },
    });
  } catch {
    // event bus not available, skip
  }
}

// ---------------------------------------------------------------------------
// auth helper (bounce scope)
// ---------------------------------------------------------------------------

// re-export deriveInboundSecret as deriveBounceSecret for bounce scope
export { deriveInboundSecret as deriveBounceSecret } from "./email-storage";

// ---------------------------------------------------------------------------
// list unmatched bounces
// ---------------------------------------------------------------------------

export async function listUnmatchedBounces(
  namespaceId: string,
  limit = 100
): Promise<BouncePayload[]> {
  const dir = getUnmatchedBouncesDir(namespaceId);
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).slice(-limit);

    const bounces: BouncePayload[] = [];
    await Promise.all(
      jsonFiles.map(async (file) => {
        try {
          const data = await fs.readFile(join(dir, file), "utf-8");
          bounces.push(JSON.parse(data) as BouncePayload);
        } catch {
          // skip malformed
        }
      })
    );

    return bounces;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// list suppressions
// ---------------------------------------------------------------------------

export async function listSuppressions(
  namespaceId: string
): Promise<SuppressionEntry[]> {
  const dir = getSuppressionsDir(namespaceId);
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== ".bounce-hashes.json");

    const suppressions: SuppressionEntry[] = [];
    await Promise.all(
      jsonFiles.map(async (file) => {
        try {
          const path = join(dir, file);
          const data = await fs.readFile(path, "utf-8");
          const entry = JSON.parse(data) as SuppressionEntry;

          // skip expired soft bounces
          if (entry.expiresAt) {
            const expiry = new Date(entry.expiresAt);
            if (expiry < new Date()) {
              await fs.unlink(path);
              return;
            }
          }

          suppressions.push(entry);
        } catch {
          // skip malformed
        }
      })
    );

    return suppressions;
  } catch {
    return [];
  }
}
