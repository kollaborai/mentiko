/**
 * SQLite-backed rate limiter for the session token refresh endpoint.
 *
 * Uses better-sqlite3 (already available via getDb) so limits survive
 * across Node.js worker processes — globalThis Map is unreliable in
 * production Next.js which may spin up multiple workers.
 *
 * Table: refresh_rate_limit(session_id TEXT PRIMARY KEY, window_start INTEGER, count INTEGER)
 * Limit: max 10 refreshes per session per 60-second window.
 */

import { getDb } from "@/lib/auth-server";

const WINDOW_MS  = 60_000; // 60 seconds
const MAX_COUNT  = 10;

let tableCreated = false;

function ensureTable(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): void {
  if (tableCreated) return;
  db.exec(
    `CREATE TABLE IF NOT EXISTS refresh_rate_limit (
       session_id   TEXT    PRIMARY KEY,
       window_start INTEGER NOT NULL,
       count        INTEGER NOT NULL
     )`
  );
  tableCreated = true;
}

/**
 * Check whether the given session is within the rate limit, and increment
 * its counter atomically.
 *
 * Returns true  — request is allowed (counter was incremented).
 * Returns false — over limit, or db unavailable (fail closed).
 */
export async function checkAndIncrementRateLimit(sessionId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    // No database configured (dev bypass) — fail closed on the security path.
    return false;
  }

  ensureTable(db);

  const now = Date.now();

  const allowed = db.transaction(() => {
    const row = db
      .prepare("SELECT window_start, count FROM refresh_rate_limit WHERE session_id = ?")
      .get(sessionId) as { window_start: number; count: number } | undefined;

    if (!row || now - row.window_start >= WINDOW_MS) {
      // No row yet, or window has expired — reset to 1.
      db.prepare(
        `INSERT INTO refresh_rate_limit (session_id, window_start, count)
         VALUES (?, ?, 1)
         ON CONFLICT(session_id) DO UPDATE SET window_start = excluded.window_start, count = 1`
      ).run(sessionId, now);
      return true;
    }

    if (row.count >= MAX_COUNT) {
      return false;
    }

    db.prepare(
      "UPDATE refresh_rate_limit SET count = count + 1 WHERE session_id = ?"
    ).run(sessionId);
    return true;
  })() as boolean;

  return allowed;
}
