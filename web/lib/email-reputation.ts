/**
 * email reputation tracking
 * SQLite-based daily metrics for bounce/complaint rates
 * automatic suspension when thresholds exceeded
 */

import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { orgPath } from "./config";
import { getDb } from "./auth-server";
import { loadOrg, saveOrg } from "./org-storage";
import { appendAuditLog } from "./email-storage";
import { loadOutboundQueue, updateOutboundEntry } from "./email-storage";

// ============================================================================
// types
// ============================================================================

export type ReputationStatus =
  | "active"
  | "warning"
  | "paused"
  | "suspended";

export interface DailyMetrics {
  date: string; // YYYY-MM-DD UTC
  sent: number;
  hardBounces: number;
  softBounces: number;
  complaints: number;
  unsubscribes: number;
  dkimFails: number;
}

export interface ReputationEvaluation {
  status: ReputationStatus;
  bounceRate: number; // 7-day rolling
  complaintRate: number; // 7-day rolling
  sentLast7Days: number;
  sentLast30Days: number;
  suspendedReason?: string;
}

// increment field names
export type MetricField =
  | "sent"
  | "hardBounces"
  | "softBounces"
  | "complaints"
  | "unsubscribes"
  | "dkimFails";

// ============================================================================
// thresholds
// ============================================================================

const BOUNCE_WARNING = 0.02; // 2%
const BOUNCE_PAUSED = 0.05; // 5%
const BOUNCE_SUSPENDED = 0.10; // 10%

const COMPLAINT_WARNING = 0.001; // 0.1%
const COMPLAINT_PAUSED = 0.003; // 0.3%

// ============================================================================
// sqlite database helpers
// ============================================================================

const REPUTATION_DB = "reputation.db";

function getReputationDbPath(namespaceId: string, orgId: string): string {
  return orgPath(namespaceId, orgId, "emails", "config", REPUTATION_DB);
}

async function getReputationDb(namespaceId: string, orgId: string) {
  const mainDb = await getDb();
  if (mainDb) {
    // reuse better-sqlite3 from auth
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const dbPath = getReputationDbPath(namespaceId, orgId);
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    const repDb = new Database(dbPath);
    repDb.pragma("journal_mode = WAL");
    return repDb;
  }
  return null;
}

function initSchema(db: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).prepare(`
    CREATE TABLE IF NOT EXISTS email_reputation_daily (
      namespace_id TEXT NOT NULL,
      date TEXT NOT NULL,
      sent INTEGER DEFAULT 0,
      hard_bounces INTEGER DEFAULT 0,
      soft_bounces INTEGER DEFAULT 0,
      complaints INTEGER DEFAULT 0,
      unsubscribes INTEGER DEFAULT 0,
      dkim_fails INTEGER DEFAULT 0,
      PRIMARY KEY (namespace_id, date)
    )
  `).run();
}

// ============================================================================
// public api
// ============================================================================

/**
 * atomically increment a metric field for today
 * creates row if not exists, updates if exists
 */
export async function increment(
  namespaceId: string,
  orgId: string,
  field: MetricField,
  by: number = 1
): Promise<void> {
  const db = await getReputationDb(namespaceId, orgId);
  if (!db) return;

  try {
    initSchema(db);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

    const columnMap: Record<MetricField, string> = {
      sent: "sent",
      hardBounces: "hard_bounces",
      softBounces: "soft_bounces",
      complaints: "complaints",
      unsubscribes: "unsubscribes",
      dkimFails: "dkim_fails",
    };

    const column = columnMap[field];

    // INSERT OR REPLACE with coalesce for atomic increment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).prepare(`
      INSERT INTO email_reputation_daily (namespace_id, date, ${column})
      VALUES (?, ?, ?)
      ON CONFLICT (namespace_id, date) DO UPDATE SET
        ${column} = coalesce(email_reputation_daily.${column}, 0) + ?
    `).run(namespaceId, today, by, by);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).close();
  }
}

/**
 * compute 7-day rolling metrics and evaluate reputation status
 */
export async function evaluate(namespaceId: string, orgId: string): Promise<ReputationEvaluation> {
  const db = await getReputationDb(namespaceId, orgId);
  if (!db) {
    return {
      status: "active",
      bounceRate: 0,
      complaintRate: 0,
      sentLast7Days: 0,
      sentLast30Days: 0,
    };
  }

  try {
    initSchema(db);

    // get last 30 days of data
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().slice(0, 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (db as any).prepare(`
      SELECT date, sent, hard_bounces, complaints
      FROM email_reputation_daily
      WHERE namespace_id = ? AND date >= ?
      ORDER BY date DESC
    `).all(namespaceId, startDate) as Array<{
      date: string;
      sent: number;
      hard_bounces: number;
      complaints: number;
    }>;

    // sum up last 7 and 30 days
    let sent7 = 0;
    let bounces7 = 0;
    let complaints7 = 0;
    let sent30 = 0;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysDate = sevenDaysAgo.toISOString().slice(0, 10);

    for (const row of rows) {
      sent30 += row.sent || 0;
      if (row.date >= sevenDaysDate) {
        sent7 += row.sent || 0;
        bounces7 += row.hard_bounces || 0;
        complaints7 += row.complaints || 0;
      }
    }

    const bounceRate = sent7 > 0 ? bounces7 / sent7 : 0;
    const complaintRate = sent7 > 0 ? complaints7 / sent7 : 0;

    // determine status
    let status: ReputationStatus = "active";
    let suspendedReason: string | undefined;

    if (bounceRate >= BOUNCE_SUSPENDED) {
      status = "suspended";
      suspendedReason = `bounce rate ${(bounceRate * 100).toFixed(1)}% exceeds threshold`;
    } else if (complaintRate >= COMPLAINT_PAUSED) {
      status = "paused";
      suspendedReason = `complaint rate ${(complaintRate * 100).toFixed(2)}% exceeds threshold`;
    } else if (bounceRate >= BOUNCE_PAUSED) {
      status = "paused";
      suspendedReason = `bounce rate ${(bounceRate * 100).toFixed(1)}% exceeds threshold`;
    } else if (complaintRate >= COMPLAINT_WARNING || bounceRate >= BOUNCE_WARNING) {
      status = "warning";
    }

    return {
      status,
      bounceRate,
      complaintRate,
      sentLast7Days: sent7,
      sentLast30Days: sent30,
      suspendedReason,
    };
  } finally {
    db.close();
  }
}

/**
 * apply suspension: cancel pending sends, update org config, log audit
 */
export async function applySuspension(
  namespaceId: string,
  orgId: string,
  reason: string
): Promise<void> {
  // 1. cancel all pending outbound queue entries
  const queue = await loadOutboundQueue(namespaceId, orgId, "pending");
  for (const entry of queue) {
    await updateOutboundEntry(namespaceId, orgId, entry.id, {
      status: "cancelled_suspended",
    });
  }

  // 2. update org config emailSendStatus
  const org = await loadOrg(namespaceId);
  if (org) {
    org.settings = org.settings || {};
    (org.settings as Record<string, unknown>).emailSendStatus = "suspended";
    (org.settings as Record<string, unknown>).emailSuspendedReason = reason;
    (org.settings as Record<string, unknown>).emailSuspendedAt = new Date().toISOString();
    await saveOrg(namespaceId, org);
  }

  // 3. log audit
  await appendAuditLog(namespaceId, orgId, {
    timestamp: new Date().toISOString(),
    event: "email_send_suspended",
    namespaceId,
    details: { reason, pendingCancelled: queue.length },
  });

  // 4. TODO: emit email_send_suspended event via event-bus if needed
}

/**
 * get daily metrics history
 */
export async function getHistory(
  namespaceId: string,
  orgId: string,
  days: number = 30
): Promise<DailyMetrics[]> {
  const db = await getReputationDb(namespaceId, orgId);
  if (!db) return [];

  const maxDays = Math.min(days, 90);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - maxDays);
  const dateStr = startDate.toISOString().slice(0, 10);

  try {
    initSchema(db);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (db as any).prepare(`
      SELECT date, sent, hard_bounces, soft_bounces, complaints, unsubscribes, dkim_fails
      FROM email_reputation_daily
      WHERE namespace_id = ? AND date >= ?
      ORDER BY date DESC
    `).all(namespaceId, dateStr) as Array<{
      date: string;
      sent: number;
      hard_bounces: number;
      soft_bounces: number;
      complaints: number;
      unsubscribes: number;
      dkim_fails: number;
    }>;

    return rows.map((r) => ({
      date: r.date,
      sent: r.sent || 0,
      hardBounces: r.hard_bounces || 0,
      softBounces: r.soft_bounces || 0,
      complaints: r.complaints || 0,
      unsubscribes: r.unsubscribes || 0,
      dkimFails: r.dkim_fails || 0,
    }));
  } finally {
    db.close();
  }
}

/**
 * check if email sending is allowed for this namespace
 * returns true if active or warning, false if paused or suspended
 */
export async function canSend(namespaceId: string, orgId: string): Promise<boolean> {
  const evalResult = await evaluate(namespaceId, orgId);
  return evalResult.status === "active" || evalResult.status === "warning";
}

/**
 * get current suspension status from org config
 */
export async function getSuspensionStatus(
  namespaceId: string,
  _orgId: string
): Promise<{ suspended: boolean; reason?: string } | null> {
  const org = await loadOrg(namespaceId);
  if (!org?.settings) return null;

  const settings = org.settings as Record<string, unknown>;
  const status = settings.emailSendStatus as string | undefined;
  if (status === "suspended") {
    return {
      suspended: true,
      reason: settings.emailSuspendedReason as string | undefined,
    };
  }
  return { suspended: false };
}

// re-export thresholds for API/docs
export const THRESHOLDS = {
  bounceWarning: BOUNCE_WARNING,
  bouncePaused: BOUNCE_PAUSED,
  bounceSuspended: BOUNCE_SUSPENDED,
  complaintWarning: COMPLAINT_WARNING,
  complaintPaused: COMPLAINT_PAUSED,
};
