/**
 * email suppression layer
 * prevents sending to bounced/complained/unsubscribed addresses
 * uses SQLite with per-namespace salted email hashes for privacy
 */

import { createHash, createHmac, randomBytes } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { orgPath } from "./config";
import { resolveAppSecret } from "./dev-secret";

const DB_NAME = "email-suppressions.db";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type SuppressionReason =
  | "hard_bounce"
  | "soft_bounce"
  | "complaint"
  | "manual"
  | "unsubscribe";

export interface SuppressionEntry {
  id: string;
  namespaceId: string;
  emailHash: string;
  emailDomain: string;
  email: string;  // full email (hashed), kept separate from emailDomain which is for display
  reason: SuppressionReason;
  bounceCode?: string;
  bounceType?: string;
  suppressedAt: string;
  expiresAt: string | null;
  suppressedBy: string;
}

export interface SuppressionListOptions {
  limit?: number;
  offset?: number;
  reason?: SuppressionReason;
}

export interface SuppressionListResult {
  entries: Omit<SuppressionEntry, "emailHash" | "email">[];
  total: number;
}

// ---------------------------------------------------------------------------
// db helpers
// ---------------------------------------------------------------------------

function getDbPath(namespaceId: string, orgId: string): string {
  const baseDir = orgPath(namespaceId, orgId, "emails");
  mkdirSync(baseDir, { recursive: true });
  return join(baseDir, DB_NAME);
}

function getDb(namespaceId: string, orgId: string): Database.Database {
  const dbPath = getDbPath(namespaceId, orgId);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_suppressions (
      id TEXT PRIMARY KEY,
      namespace_id TEXT NOT NULL,
      email_hash TEXT NOT NULL,
      email_domain TEXT NOT NULL,
      reason TEXT NOT NULL,
      bounce_code TEXT,
      bounce_type TEXT,
      suppressed_at TEXT NOT NULL,
      expires_at TEXT,
      suppressed_by TEXT NOT NULL,
      UNIQUE(namespace_id, email_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_suppressions_reason
      ON email_suppressions(reason);

    CREATE INDEX IF NOT EXISTS idx_suppressions_expires
      ON email_suppressions(expires_at);
  `);
}

// ---------------------------------------------------------------------------
// salt derivation
// ---------------------------------------------------------------------------

/**
 * derive per-namespace salt for hashing emails.
 * uses HMAC with BETTER_AUTH_SECRET so salt is deterministic per namespace
 * but not reversible without the secret.
 */
export function getSalt(namespaceId: string): string {
  const BETTER_AUTH_SECRET = resolveAppSecret("email-suppression");
  return createHmac("sha256", BETTER_AUTH_SECRET)
    .update(`suppression-salt:v1:${namespaceId}`)
    .digest("hex");
}

/**
 * hash email for storage. never store plain emails.
 */
function hashEmail(email: string, salt: string): string {
  const normalized = email.toLowerCase().trim();
  return createHash("sha256")
    .update(`${normalized}:${salt}`)
    .digest("hex");
}

/**
 * extract domain from email for display/debugging.
 */
function extractDomain(email: string): string {
  const match = email.toLowerCase().trim().match(/@([^\s@]+)$/);
  return match ? match[1] : "unknown";
}

// ---------------------------------------------------------------------------
// core operations
// ---------------------------------------------------------------------------

/**
 * check if an email is suppressed. respects expires_at.
 */
export function isSuppressed(namespaceId: string, orgId: string, email: string): boolean {
  const db = getDb(namespaceId, orgId);
  try {
    initSchema(db);

    const salt = getSalt(namespaceId);
    const emailHash = hashEmail(email, salt);
    const now = new Date().toISOString();

    const row = db
      .prepare(
        `
        SELECT 1 FROM email_suppressions
        WHERE email_hash = ? AND namespace_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
        LIMIT 1
      `
      )
      .get(emailHash, namespaceId, now) as { 1: number } | undefined;

    return !!row;
  } finally {
    db.close();
  }
}

/**
 * add a suppression entry. idempotent via INSERT OR IGNORE.
 * entry.email is the full email address (will be hashed).
 * entry.emailDomain is extracted for display/debugging only.
 */
export function suppress(
  namespaceId: string,
  orgId: string,
  entry: Omit<SuppressionEntry, "id" | "namespaceId" | "emailHash">
): void {
  const db = getDb(namespaceId, orgId);
  try {
    initSchema(db);

    const salt = getSalt(namespaceId);
    const emailHash = hashEmail(entry.email, salt);

    db.prepare(
      `
      INSERT OR IGNORE INTO email_suppressions
        (id, namespace_id, email_hash, email_domain, reason,
         bounce_code, bounce_type, suppressed_at, expires_at, suppressed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      cryptoId(),
      namespaceId,
      emailHash,
      entry.emailDomain,
      entry.reason,
      entry.bounceCode || null,
      entry.bounceType || null,
      entry.suppressedAt,
      entry.expiresAt || null,
      entry.suppressedBy
    );
  } finally {
    db.close();
  }
}

/**
 * remove suppression if allowed by reason whitelist.
 * hard_bounce and complaint cannot be removed (permanent).
 *
 * SECURITY: validates reason values against allowed enum to prevent SQL injection.
 * better-sqlite3 doesn't support parameterized IN clauses with arrays,
 * so we validate the allowlist and use crosstab instead.
 */
export function unsuppress(
  namespaceId: string,
  orgId: string,
  email: string,
  allowedReasons: SuppressionReason[] = ["soft_bounce", "unsubscribe", "manual"]
): boolean {
  // validate all reasons are legitimate enum values
  const validReasons: SuppressionReason[] = ["hard_bounce", "soft_bounce", "complaint", "manual", "unsubscribe"];
  const sanitizedReasons = allowedReasons.filter((r) => validReasons.includes(r as SuppressionReason));

  if (sanitizedReasons.length === 0) {
    return false; // nothing to delete
  }

  const db = getDb(namespaceId, orgId);
  try {
    initSchema(db);

    const salt = getSalt(namespaceId);
    const emailHash = hashEmail(email, salt);

    // build crosstab WHERE clauses for each allowed reason
    // e.g. "(reason = ? OR reason = ? OR reason = ?)"
    const reasonClause = sanitizedReasons.map(() => "reason = ?").join(" OR ");

    const result = db
      .prepare(
        `
        DELETE FROM email_suppressions
        WHERE email_hash = ? AND namespace_id = ? AND (${reasonClause})
      `
      )
      .run(emailHash, namespaceId, ...sanitizedReasons);

    return result.changes > 0;
  } finally {
    db.close();
  }
}

/**
 * list suppressed entries. never returns full emails.
 */
export function listSuppressed(
  namespaceId: string,
  orgId: string,
  options: SuppressionListOptions = {}
): SuppressionListResult {
  const { limit = 50, offset = 0, reason } = options;

  const db = getDb(namespaceId, orgId);
  try {
    initSchema(db);

    let whereClause = "WHERE namespace_id = ?";
    const params: (string | number)[] = [namespaceId];

    if (reason) {
      whereClause += " AND reason = ?";
      params.push(reason);
    }

    // get total
    const totalRow = db
      .prepare(`SELECT COUNT(*) as count FROM email_suppressions ${whereClause}`)
      .get(...params) as { count: number };
    const total = totalRow.count;

    // get entries (exclude email_hash for privacy)
    const entries = db
      .prepare(
        `
        SELECT id, namespace_id, email_domain, reason,
               bounce_code, bounce_type, suppressed_at,
               expires_at, suppressed_by
        FROM email_suppressions
        ${whereClause}
        ORDER BY suppressed_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset) as Omit<SuppressionEntry, "emailHash">[];

    return { entries, total };
  } finally {
    db.close();
  }
}

/**
 * create a deterministic id for entries.
 */
function cryptoId(): string {
  return `sup_${Date.now()}_${randomBytes(6).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// convenience helpers
// ---------------------------------------------------------------------------

/**
 * suppress for bounce. called by email processor.
 */
export function suppressForBounce(
  namespaceId: string,
  orgId: string,
  email: string,
  bounceCode: string,
  bounceType: string,
  isHard: boolean
): void {
  suppress(namespaceId, orgId, {
    email,          // full email gets hashed
    emailDomain: extractDomain(email),  // domain for display only
    reason: isHard ? "hard_bounce" : "soft_bounce",
    bounceCode,
    bounceType,
    suppressedAt: new Date().toISOString(),
    expiresAt: isHard ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days for soft
    suppressedBy: "system",
  });
}

/**
 * suppress for complaint. called by webhook handler.
 */
export function suppressForComplaint(
  namespaceId: string,
  orgId: string,
  email: string
): void {
  suppress(namespaceId, orgId, {
    email,          // full email gets hashed
    emailDomain: extractDomain(email),  // domain for display only
    reason: "complaint",
    suppressedAt: new Date().toISOString(),
    expiresAt: null, // permanent
    suppressedBy: "system",
  });
}

/**
 * suppress for unsubscribe. called by unsubscribe link handler.
 * stores full email hash (not just domain) for precise suppression.
 */
export function suppressForUnsubscribe(
  namespaceId: string,
  orgId: string,
  email: string
): void {
  const db = getDb(namespaceId, orgId);
  try {
    initSchema(db);

    const salt = getSalt(namespaceId);
    const normalizedEmail = email.toLowerCase().trim();
    const emailHash = hashEmail(normalizedEmail, salt);
    const emailDomain = extractDomain(normalizedEmail);
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT OR IGNORE INTO email_suppressions
        (id, namespace_id, email_hash, email_domain, reason,
         bounce_code, bounce_type, suppressed_at, expires_at, suppressed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      cryptoId(),
      namespaceId,
      emailHash,
      emailDomain,  // store only domain, not plaintext email
      "unsubscribe",
      null,
      null,
      now,
      null, // permanent
      "system"
    );
  } finally {
    db.close();
  }
}

/**
 * manual suppress by admin. called via API.
 */
export function suppressManually(
  namespaceId: string,
  orgId: string,
  email: string,
  suppressedBy: string,
  reason: SuppressionReason = "manual",
  expiresAt: string | null = null
): void {
  suppress(namespaceId, orgId, {
    email,          // full email gets hashed
    emailDomain: extractDomain(email),  // domain for display only
    reason,
    suppressedAt: new Date().toISOString(),
    expiresAt,
    suppressedBy,
  });
}

/**
 * check batch of emails and return suppressed ones.
 */
export function filterSuppressed(
  namespaceId: string,
  orgId: string,
  emails: string[]
): string[] {
  const db = getDb(namespaceId, orgId);
  try {
    initSchema(db);

    const salt = getSalt(namespaceId);
    const now = new Date().toISOString();

    const hashes = emails.map((e) => hashEmail(e, salt));

    // build crosstab WHERE clause for IN clause
    // better-sqlite3 doesn't support parameterized IN with arrays
    const hashClause = hashes.map(() => "email_hash = ?").join(" OR ");

    const rows = db
      .prepare(
        `
        SELECT DISTINCT email_hash FROM email_suppressions
        WHERE (${hashClause})
          AND namespace_id = ?
          AND (expires_at IS NULL OR expires_at > ?)
      `
      )
      .all(...hashes, namespaceId, now) as { email_hash: string }[];

    const suppressedHashes = new Set(rows.map((r) => r.email_hash));

    return emails.filter((e) => suppressedHashes.has(hashEmail(e, salt)));
  } finally {
    db.close();
  }
}
