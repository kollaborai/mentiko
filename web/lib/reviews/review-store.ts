// Native in-process SQLite review store.

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import config from "../config";
import type {
  ReviewRecord,
  ReviewAssignment,
  ReviewComment,
  ReviewListFilter,
  ReviewCreateInput,
  ReviewUpdateFields,
  ReviewChecklistItem,
} from "./review-store-types";

export type {
  ReviewRecord,
  ReviewAssignment,
  ReviewComment,
  ReviewListFilter,
  ReviewCreateInput,
  ReviewUpdateFields,
  ReviewChecklistItem,
};
export { ASSIGNMENT_STATUSES } from "./review-store-types";
export type { AssignmentStatus } from "./review-store-types";

/** Values this store pushes into parameterized queries (no blob/bigint columns here). */
type SqlParam = string | number | null;
/** A raw review_comments row, where the boolean `resolved` is still 0/1. */
type ReviewCommentRow = Omit<ReviewComment, "resolved"> & { resolved: number };

// ---------- connection management ----------

const connections = new Map<string, Database.Database>();

function getDb(namespaceId: string = "default"): Database.Database {
  let db = connections.get(namespaceId);
  if (db) return db;

  const dbPath = join(
    config.globalRoot,
    "namespaces",
    namespaceId,
    "data",
    "reviews.db"
  );
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  runMigrations(db);
  connections.set(namespaceId, db);
  return db;
}

export function _getDb(namespaceId?: string): Database.Database {
  return getDb(namespaceId);
}

export function closeAll(): void {
  for (const db of connections.values()) {
    try { db.close(); } catch { /* already closed */ }
  }
  connections.clear();
}

// ---------- schema migrations ----------

function runMigrations(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)");
  const row = db.prepare("SELECT MAX(version) as v FROM _migrations").get() as { v: number | null } | undefined;
  const current = row?.v ?? 0;

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS id_counters (
        org_id TEXT NOT NULL,
        prefix TEXT NOT NULL,
        next_val INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (org_id, prefix)
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        workspace_id TEXT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        source_branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'medium',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        due_date TEXT,
        labels TEXT DEFAULT '[]',
        checklist TEXT DEFAULT '[]',
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS review_assignments (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        reviewer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS review_comments (
        id TEXT PRIMARY KEY,
        review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        line_number INTEGER,
        commenter_id TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved BOOLEAN NOT NULL DEFAULT 0,
        resolved_at TEXT,
        resolved_by TEXT
      );

      CREATE INDEX IF NOT EXISTS reviews_org_idx ON reviews(org_id);
      CREATE INDEX IF NOT EXISTS reviews_workspace_idx ON reviews(workspace_id);
      CREATE INDEX IF NOT EXISTS reviews_status_idx ON reviews(status);
      CREATE INDEX IF NOT EXISTS reviews_created_by_idx ON reviews(created_by);
      CREATE INDEX IF NOT EXISTS review_assignments_review_idx ON review_assignments(review_id);
      CREATE INDEX IF NOT EXISTS review_assignments_reviewer_idx ON review_assignments(reviewer_id);
      CREATE INDEX IF NOT EXISTS review_comments_review_idx ON review_comments(review_id);
    `);

    db.prepare("INSERT INTO _migrations (version) VALUES (1)").run();
  }
}

// ---------- ID generation ----------

function generateId(orgId: string, prefix: string): string {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO id_counters (org_id, prefix, next_val) VALUES (?, ?, 1) ON CONFLICT(org_id, prefix) DO UPDATE SET next_val = next_val + 1"
  );
  stmt.run(orgId, prefix);
  
  const row = db.prepare(
    "SELECT next_val FROM id_counters WHERE org_id = ? AND prefix = ?"
  ).get(orgId, prefix) as { next_val: number } | undefined;
  
  const seq = row?.next_val ?? 1;
  return `${prefix}-${seq.toString().padStart(6, '0')}`;
}

// ---------- Review CRUD operations ----------

export function createReview(
  orgId: string,
  input: ReviewCreateInput,
  createdBy: string,
  workspaceId?: string
): ReviewRecord {
  const db = getDb();
  const id = generateId(orgId, "rev");
  const now = new Date().toISOString();
  
  const checklist = JSON.stringify(input.checklist || []);
  const labels = JSON.stringify(input.labels || []);
  
  db.prepare(`
    INSERT INTO reviews (id, org_id, workspace_id, title, description, source_branch, target_branch, 
                         status, priority, created_by, created_at, due_date, labels, checklist, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId, workspaceId || null, input.title, input.description || "",
    input.source_branch, input.target_branch, "pending", input.priority || "medium",
    createdBy, now, input.due_date || null, labels, checklist, now
  );
  
  // Create assignments if reviewers provided
  if (input.reviewers && input.reviewers.length > 0) {
    for (const reviewerId of input.reviewers) {
      _createAssignment(db, id, reviewerId);
    }
  }

  return getReview(id, orgId)!;
}

export function getReview(id: string, orgId?: string): ReviewRecord | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT r.*,
           (SELECT COUNT(*) FROM review_assignments WHERE review_id = r.id) as reviewer_count,
           (SELECT COUNT(*) FROM review_comments WHERE review_id = r.id) as comment_count,
           (SELECT COUNT(*) FROM review_assignments WHERE review_id = r.id AND status IN ('approved', 'changes_requested')) as completed_reviewer_count
    FROM reviews r
    WHERE r.id = ?${orgId !== undefined ? " AND r.org_id = ?" : ""}
  `).get(...(orgId !== undefined ? [id, orgId] : [id])) as ReviewRecord | undefined;

  return row || null;
}

export function listReviews(filter: ReviewListFilter = {}): ReviewRecord[] {
  const db = getDb();
  let sql = `
    SELECT r.*,
           (SELECT COUNT(*) FROM review_assignments WHERE review_id = r.id) as reviewer_count,
           (SELECT COUNT(*) FROM review_comments WHERE review_id = r.id) as comment_count,
           (SELECT COUNT(*) FROM review_assignments WHERE review_id = r.id AND status IN ('approved', 'changes_requested')) as completed_reviewer_count
    FROM reviews r
    WHERE 1=1
  `;
  const params: SqlParam[] = [];

  if (filter.org_id) {
    sql += " AND r.org_id = ?";
    params.push(filter.org_id);
  }

  if (filter.status) {
    sql += " AND r.status = ?";
    params.push(filter.status);
  }
  
  if (filter.reviewer_id) {
    sql += " AND EXISTS (SELECT 1 FROM review_assignments WHERE review_id = r.id AND reviewer_id = ?)";
    params.push(filter.reviewer_id);
  }
  
  if (filter.created_by) {
    sql += " AND r.created_by = ?";
    params.push(filter.created_by);
  }
  
  if (filter.workspace_id) {
    sql += " AND r.workspace_id = ?";
    params.push(filter.workspace_id);
  }
  
  sql += " ORDER BY r.created_at DESC";
  
  if (filter.limit) {
    sql += " LIMIT ?";
    params.push(filter.limit);
  }
  
  if (filter.offset) {
    sql += " OFFSET ?";
    params.push(filter.offset);
  }
  
  return db.prepare(sql).all(...params) as ReviewRecord[];
}

export function updateReview(id: string, fields: ReviewUpdateFields, orgId?: string): ReviewRecord | null {
  const db = getDb();
  const existing = getReview(id, orgId);
  if (!existing) return null;
  
  const updates: string[] = [];
  const params: SqlParam[] = [];
  
  if (fields.title !== undefined) {
    updates.push("title = ?");
    params.push(fields.title);
  }
  
  if (fields.description !== undefined) {
    updates.push("description = ?");
    params.push(fields.description);
  }
  
  if (fields.status !== undefined) {
    updates.push("status = ?");
    params.push(fields.status);
    if (fields.status === "completed" || fields.status === "cancelled") {
      updates.push("closed_at = ?");
      params.push(new Date().toISOString());
    }
  }
  
  if (fields.due_date !== undefined) {
    updates.push("due_date = ?");
    params.push(fields.due_date);
  }
  
  if (fields.labels !== undefined) {
    updates.push("labels = ?");
    params.push(JSON.stringify(fields.labels));
  }
  
  if (fields.checklist !== undefined) {
    updates.push("checklist = ?");
    params.push(JSON.stringify(fields.checklist));
  }
  
  if (fields.priority !== undefined) {
    updates.push("priority = ?");
    params.push(fields.priority);
  }
  
  updates.push("updated_at = ?");
  params.push(new Date().toISOString());
  
  params.push(id);
  
  db.prepare(`UPDATE reviews SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  return getReview(id, orgId);
}

export function deleteReview(id: string, orgId?: string): boolean {
  const db = getDb();
  const result =
    orgId !== undefined
      ? db.prepare("DELETE FROM reviews WHERE id = ? AND org_id = ?").run(id, orgId)
      : db.prepare("DELETE FROM reviews WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------- Assignment operations ----------

export function createAssignment(reviewId: string, reviewerId: string): ReviewAssignment {
  return _createAssignment(getDb(), reviewId, reviewerId);
}

function _createAssignment(db: Database.Database, reviewId: string, reviewerId: string): ReviewAssignment {
  const id = generateId("global", "asn");
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO review_assignments (id, review_id, reviewer_id, status, assigned_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(id, reviewId, reviewerId, now);
  
  return getAssignment(id)!;
}

export function getAssignment(id: string): ReviewAssignment | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM review_assignments WHERE id = ?").get(id) as ReviewAssignment | undefined;
  return row || null;
}

export function listAssignments(reviewId: string): ReviewAssignment[] {
  const db = getDb();
  return db.prepare("SELECT * FROM review_assignments WHERE review_id = ? ORDER BY assigned_at ASC").all(reviewId) as ReviewAssignment[];
}

export function updateAssignmentStatus(id: string, status: string): ReviewAssignment | null {
  const db = getDb();
  const updates: string[] = ["status = ?"];
  const params: SqlParam[] = [status];

  // approved / changes_requested are terminal — stamp completion; a move back
  // to pending clears it.
  if (status === "approved" || status === "changes_requested") {
    updates.push("completed_at = ?");
    params.push(new Date().toISOString());
  } else {
    updates.push("completed_at = NULL");
  }

  params.push(id);

  db.prepare(`UPDATE review_assignments SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  return getAssignment(id);
}

export function deleteAssignment(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM review_assignments WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------- Comment operations ----------

export function createComment(
  reviewId: string,
  filePath: string,
  lineNumber: number | null,
  commenterId: string,
  comment: string
): ReviewComment {
  const db = getDb();
  const id = generateId("global", "cmt");
  const now = new Date().toISOString();
  
  db.prepare(`
    INSERT INTO review_comments (id, review_id, file_path, line_number, commenter_id, comment, created_at, updated_at, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(id, reviewId, filePath, lineNumber, commenterId, comment, now, now);
  
  return getComment(id)!;
}

export function getComment(id: string): ReviewComment | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM review_comments WHERE id = ?").get(id) as ReviewCommentRow | undefined;
  if (!row) return null;
  
  // Convert SQLite boolean (0/1) to JavaScript boolean
  return {
    ...row,
    resolved: row.resolved === 1,
  };
}

export function listComments(reviewId: string): ReviewComment[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM review_comments WHERE review_id = ? ORDER BY created_at ASC").all(reviewId) as ReviewCommentRow[];
  
  // Convert SQLite boolean (0/1) to JavaScript boolean
  return rows.map(row => ({
    ...row,
    resolved: row.resolved === 1,
  }));
}

export function updateComment(id: string, comment: string): ReviewComment | null {
  const db = getDb();
  const now = new Date().toISOString();
  
  db.prepare("UPDATE review_comments SET comment = ?, updated_at = ? WHERE id = ?").run(comment, now, id);
  
  return getComment(id);
}

export function resolveComment(id: string, resolvedBy: string): ReviewComment | null {
  const db = getDb();
  const now = new Date().toISOString();
  
  db.prepare("UPDATE review_comments SET resolved = 1, resolved_at = ?, resolved_by = ? WHERE id = ?").run(now, resolvedBy, id);
  
  return getComment(id);
}

export function deleteComment(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM review_comments WHERE id = ?").run(id);
  return result.changes > 0;
}