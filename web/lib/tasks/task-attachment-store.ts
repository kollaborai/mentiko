/**
 * Task attachment store (FEAT-001/TASK-004).
 *
 * One proven upload path for task image attachments:
 *   POST /api/tasks/[id]/attachments -> taskAttachmentCreate()
 *
 * Storage contract (types in task-attachment-types.ts):
 *   row     -> task_attachments table in the namespace tasks.db
 *   blob    -> {namespaceRoot}/data/task-attachments/{orgId}/{taskId}/{attachmentId}{ext}
 *
 * Binding rules: stored filename and sha256 checksum are computed here,
 * server-side, from the received bytes. Client input never reaches the
 * stored name or the hash. Blob paths always come from attachmentBlobPath().
 *
 * Lifecycle cleanup (delete/cascade) is deliberately NOT here -- it belongs
 * to TASK-005, which must reuse attachmentTaskBlobDir().
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, rmSync } from "fs";
import { dirname, join } from "path";
import type Database from "better-sqlite3";
import config from "../config";
import { BadRequest, NotFound } from "../api-errors";
import { _getDb, sweepOrphanAttachmentBlobsOnce, validateTaskId } from "./task-store";
import {
  attachmentBlobPath,
  attachmentTaskBlobDir,
  newTaskAttachmentId,
  taskAttachmentStoredFilename,
  type TaskAttachment,
} from "./task-attachment-types";
import {
  sanitizeTaskAttachmentFilename,
  taskAttachmentExtForMime,
  validateTaskAttachmentFile,
} from "./task-attachment-validation";

// ---------- migration (idempotent, versioned in _migrations) ----------

const TASK_ATTACHMENTS_MIGRATION_VERSION = 2;

function ensureAttachmentTables(db: Database.Database, namespaceId = "default"): void {
  const row = db.prepare("SELECT MAX(version) as v FROM _migrations").get() as
    | { v: number | null }
    | undefined;
  const current = row?.v ?? 0;
  if (current >= TASK_ATTACHMENTS_MIGRATION_VERSION) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stored',
      created_at TEXT NOT NULL,
      created_by TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task
      ON task_attachments(task_id, org_id);
  `);
  try {
    db.prepare("INSERT INTO _migrations (version) VALUES (?)").run(TASK_ATTACHMENTS_MIGRATION_VERSION);
  } catch {
    // concurrent migration insert lost the UNIQUE race; the winner's schema
    // is identical, so continue.
  }

  // FEAT-001/TASK-005: orphan sweep at attachment-store init. Guarded to run
  // once per namespace per process (portal hot reload re-inits stores).
  sweepOrphanAttachmentBlobsOnce(namespaceId);
}

// ---------- row helpers ----------

interface RawAttachmentRow {
  id: string;
  task_id: string;
  org_id: string;
  original_filename: string;
  stored_filename: string;
  content_type: string;
  size: number;
  checksum: string;
  status: string;
  created_at: string;
  created_by: string;
}

function rowToAttachment(row: RawAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
    orgId: row.org_id,
    originalFilename: row.original_filename,
    storedFilename: row.stored_filename,
    contentType: row.content_type,
    size: row.size,
    checksum: row.checksum,
    status: row.status as TaskAttachment["status"],
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

const ATTACHMENT_COLUMNS = `
  id, task_id, org_id, original_filename, stored_filename,
  content_type, size, checksum, status, created_at, created_by
`;

// ---------- create (the one proven upload path) ----------

export interface TaskAttachmentCreateInput {
  orgId: string;
  taskId: string;
  namespaceId?: string;
  /** authenticated actor id; stored as created_by */
  createdBy?: string;
  file: {
    /** client-supplied original filename; sanitized for storage only */
    name: string;
    /** client-declared MIME type; verified against magic bytes */
    type: string;
    bytes: Buffer;
  };
}

/**
 * Validate + persist one attachment: blob write first (atomic temp+rename,
 * 0600), then the row; the blob is removed if the row insert fails so a
 * failed create cannot leave an orphan.
 */
export function taskAttachmentCreate(input: TaskAttachmentCreateInput): TaskAttachment {
  const taskId = validateTaskId(input.taskId);
  const db = _getDb(input.namespaceId);
  ensureAttachmentTables(db, input.namespaceId ?? "default");

  const task = db
    .prepare("SELECT id FROM tasks WHERE id = ? AND org_id = ?")
    .get(taskId, input.orgId);
  if (!task) {
    throw new NotFound("Task", taskId);
  }

  // size/type gate on the actual received bytes
  const validation = validateTaskAttachmentFile({
    size: input.file.bytes.length,
    contentType: input.file.type,
    head: input.file.bytes.subarray(0, 16),
  });
  if (!validation.valid) {
    throw new BadRequest(validation.detail ?? "invalid attachment", {
      field: "file",
      reason: validation.reason,
    });
  }

  // server-side identity: id, stored name, and checksum never see client input
  const id = newTaskAttachmentId();
  const ext = taskAttachmentExtForMime(input.file.type);
  const storedFilename = taskAttachmentStoredFilename(id, ext);
  const checksum = createHash("sha256").update(input.file.bytes).digest("hex");
  const originalFilename = sanitizeTaskAttachmentFilename(input.file.name);
  const createdAt = new Date().toISOString();
  const createdBy = input.createdBy ?? "";

  const namespaceRoot = join(config.globalRoot, "namespaces", input.namespaceId ?? "default");
  const blobPath = attachmentBlobPath(namespaceRoot, input.orgId, taskId, id, ext);

  mkdirSync(dirname(blobPath), { recursive: true });
  const tmpPath = `${blobPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, input.file.bytes, { mode: 0o600 });
  renameSync(tmpPath, blobPath);

  try {
    db.prepare(`
      INSERT INTO task_attachments (
        ${ATTACHMENT_COLUMNS}
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stored', ?, ?)
    `).run(
      id,
      taskId,
      input.orgId,
      originalFilename,
      storedFilename,
      input.file.type,
      input.file.bytes.length,
      checksum,
      createdAt,
      createdBy,
    );
  } catch (err) {
    // row insert failed: roll the blob back so no orphan is left behind
    try { rmSync(blobPath, { force: true }); } catch { /* best effort */ }
    throw err;
  }

  const row = db
    .prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments WHERE id = ?`)
    .get(id) as RawAttachmentRow;
  return rowToAttachment(row);
}

// ---------- reads ----------

export function taskAttachmentGet(
  orgId: string,
  taskId: string,
  attachmentId: string,
  namespaceId?: string,
): TaskAttachment | null {
  const db = _getDb(namespaceId);
  ensureAttachmentTables(db, namespaceId ?? "default");
  const row = db
    .prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments WHERE id = ? AND task_id = ? AND org_id = ?`)
    .get(attachmentId, taskId, orgId) as RawAttachmentRow | undefined;
  return row ? rowToAttachment(row) : null;
}

export function taskAttachmentsForTask(
  orgId: string,
  taskId: string,
  namespaceId?: string,
): TaskAttachment[] {
  const db = _getDb(namespaceId);
  ensureAttachmentTables(db, namespaceId ?? "default");
  const rows = db
    .prepare(
      `SELECT ${ATTACHMENT_COLUMNS} FROM task_attachments
       WHERE task_id = ? AND org_id = ? AND status = 'stored'
       ORDER BY created_at ASC, id ASC`,
    )
    .all(taskId, orgId) as RawAttachmentRow[];
  return rows.map(rowToAttachment);
}

// ---------- org purge (FEAT-001/TASK-005) ----------

/**
 * Remove every attachment row and blob for one org. Called on org deletion so
 * no attachment blobs outlive their org. Best-effort on the filesystem side:
 * a failed blob removal must not fail the org deletion; the per-namespace
 * sweep reaps the leftover dir on the next delete or init.
 */
export function taskAttachmentsPurgeOrg(orgId: string, namespaceId?: string): void {
  const ns = namespaceId ?? "default";
  const db = _getDb(namespaceId);
  ensureAttachmentTables(db, ns);
  db.prepare("DELETE FROM task_attachments WHERE org_id = ?").run(orgId);
  const namespaceRoot = join(config.globalRoot, "namespaces", ns);
  const orgBlobDir = attachmentTaskBlobDir(namespaceRoot, orgId, "");
  try {
    rmSync(orgBlobDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`taskAttachmentsPurgeOrg: could not remove ${orgBlobDir}:`, err);
  }
}
