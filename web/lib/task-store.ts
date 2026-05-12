// Native in-process SQLite task store.

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import config from "./config";
import { ISSUE_TYPE_PREFIX } from "./task-store-types";
import type {
  TaskRecord,
  TaskDep,
  TaskComment,
  TaskListFilter,
  TaskCreateInput,
  TaskUpdateFields,
} from "./task-store-types";

export type {
  TaskRecord,
  TaskDep,
  TaskComment,
  TaskListFilter,
  TaskCreateInput,
  TaskUpdateFields,
};
export { ISSUE_TYPE_PREFIX };

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
    "tasks.db"
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

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        workspace_id TEXT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        priority INTEGER NOT NULL DEFAULT 2,
        issue_type TEXT NOT NULL DEFAULT 'task',
        owner TEXT DEFAULT '',
        assignee TEXT,
        parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        labels TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        acceptance_criteria TEXT,
        design TEXT,
        notes TEXT,
        estimated_minutes INTEGER,
        due_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT DEFAULT '',
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_org_status ON tasks(org_id, status);
      CREATE INDEX IF NOT EXISTS idx_tasks_org_type ON tasks(org_id, issue_type);
      CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);

      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'blocks',
        created_at TEXT NOT NULL,
        created_by TEXT DEFAULT '',
        PRIMARY KEY (task_id, depends_on_id)
      );

      CREATE INDEX IF NOT EXISTS idx_deps_depends_on ON task_dependencies(depends_on_id);

      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author TEXT DEFAULT '',
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);

      INSERT INTO _migrations (version) VALUES (1);
    `);
  }
}

// ---------- ID generation ----------

function generateId(db: Database.Database, _orgId: string, issueType: string): string {
  const prefix = ISSUE_TYPE_PREFIX[issueType] || "TASK";
  // global counter (not per-org) so IDs are unique across the entire namespace db
  const stmt = db.prepare(`
    INSERT INTO id_counters (org_id, prefix, next_val)
    VALUES ('_global', ?, 2)
    ON CONFLICT (org_id, prefix) DO UPDATE SET next_val = next_val + 1
    RETURNING next_val - 1 as val
  `);
  const row = stmt.get(prefix) as { val: number };
  return `${prefix}-${String(row.val).padStart(3, "0")}`;
}

// ---------- row helpers ----------

interface RawTaskRow {
  id: string;
  org_id: string;
  workspace_id: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  owner: string;
  assignee: string | null;
  parent_id: string | null;
  labels: string;
  metadata: string;
  acceptance_criteria: string | null;
  design: string | null;
  notes: string | null;
  estimated_minutes: number | null;
  due_at: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  closed_at: string | null;
}

function rowToTaskRecord(row: RawTaskRow): TaskRecord {
  let labels: string[] = [];
  try { labels = JSON.parse(row.labels); } catch { /* empty */ }

  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(row.metadata); } catch { /* empty */ }

  return { ...row, labels, metadata };
}

function now(): string {
  return new Date().toISOString();
}

// ---------- CRUD ----------

export function taskList(
  orgId: string,
  filter?: TaskListFilter,
  workspaceId?: string,
  namespaceId?: string
): TaskRecord[] {
  const db = getDb(namespaceId);
  const conditions: string[] = ["org_id = ?"];
  const params: unknown[] = [orgId];

  if (workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(workspaceId);
  }

  if (filter?.status && filter.status !== "all") {
    conditions.push("status = ?");
    params.push(filter.status);
  } else if (!filter?.status) {
    conditions.push("status != 'closed'");
  }

  if (filter?.issue_type && filter.issue_type !== "all") {
    conditions.push("issue_type = ?");
    params.push(filter.issue_type);
  }

  if (filter?.assignee) {
    conditions.push("assignee = ?");
    params.push(filter.assignee);
  }

  if (filter?.query) {
    conditions.push("title LIKE ?");
    params.push(`%${filter.query}%`);
  }

  const sql = `SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params) as RawTaskRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const ph = ids.map(() => "?").join(",");

  const depCounts = db
    .prepare(`SELECT task_id, COUNT(*) as cnt FROM task_dependencies WHERE task_id IN (${ph}) GROUP BY task_id`)
    .all(...ids) as Array<{ task_id: string; cnt: number }>;
  const depMap = new Map(depCounts.map((r) => [r.task_id, r.cnt]));

  const dntCounts = db
    .prepare(`SELECT depends_on_id, COUNT(*) as cnt FROM task_dependencies WHERE depends_on_id IN (${ph}) GROUP BY depends_on_id`)
    .all(...ids) as Array<{ depends_on_id: string; cnt: number }>;
  const dntMap = new Map(dntCounts.map((r) => [r.depends_on_id, r.cnt]));

  const cmtCounts = db
    .prepare(`SELECT task_id, COUNT(*) as cnt FROM task_comments WHERE task_id IN (${ph}) GROUP BY task_id`)
    .all(...ids) as Array<{ task_id: string; cnt: number }>;
  const cmtMap = new Map(cmtCounts.map((r) => [r.task_id, r.cnt]));

  return rows.map((row) => {
    const record = rowToTaskRecord(row);
    record.dependency_count = depMap.get(row.id) ?? 0;
    record.dependent_count = dntMap.get(row.id) ?? 0;
    record.comment_count = cmtMap.get(row.id) ?? 0;
    return record;
  });
}

export function taskGet(
  orgId: string,
  id: string,
  namespaceId?: string
): TaskRecord | null {
  const db = getDb(namespaceId);
  const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(id, orgId) as RawTaskRow | undefined;
  if (!row) return null;

  const record = rowToTaskRecord(row);

  record.dependencies = (db.prepare(`
    SELECT d.task_id, d.depends_on_id, d.type, d.created_at, d.created_by,
           t.title, t.status, t.priority, t.issue_type
    FROM task_dependencies d
    LEFT JOIN tasks t ON t.id = d.depends_on_id
    WHERE d.task_id = ?
  `).all(id) as Array<{ task_id: string; depends_on_id: string; type: string; created_at: string; created_by: string; title: string; status: string; priority: number; issue_type: string }>).map((d) => ({
    id: d.depends_on_id,
    task_id: d.task_id,
    depends_on_id: d.depends_on_id,
    type: d.type,
    created_at: d.created_at,
    created_by: d.created_by,
    title: d.title,
    status: d.status,
    priority: d.priority,
    issue_type: d.issue_type,
  }));

  record.dependents = (db.prepare(`
    SELECT d.task_id, d.depends_on_id, d.type, d.created_at, d.created_by,
           t.title, t.status, t.priority, t.issue_type
    FROM task_dependencies d
    LEFT JOIN tasks t ON t.id = d.task_id
    WHERE d.depends_on_id = ?
  `).all(id) as Array<{ task_id: string; depends_on_id: string; type: string; created_at: string; created_by: string; title: string; status: string; priority: number; issue_type: string }>).map((d) => ({
    id: d.task_id,
    task_id: d.task_id,
    depends_on_id: d.depends_on_id,
    type: d.type,
    created_at: d.created_at,
    created_by: d.created_by,
    title: d.title,
    status: d.status,
    priority: d.priority,
    issue_type: d.issue_type,
  }));

  record.dependency_count = record.dependencies.length;
  record.dependent_count = record.dependents.length;
  const cc = db.prepare("SELECT COUNT(*) as cnt FROM task_comments WHERE task_id = ?").get(id) as { cnt: number };
  record.comment_count = cc.cnt;

  return record;
}

export function taskCreate(
  orgId: string,
  input: TaskCreateInput,
  namespaceId?: string
): TaskRecord {
  const db = getDb(namespaceId);
  const issueType = input.issue_type || "task";
  const id = generateId(db, orgId, issueType);
  const timestamp = now();

  db.prepare(`
    INSERT INTO tasks (id, org_id, workspace_id, title, description, status, priority,
      issue_type, owner, assignee, parent_id, labels, metadata,
      acceptance_criteria, design, notes, estimated_minutes, due_at,
      created_at, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId,
    input.workspace_id ?? null,
    input.title,
    input.description ?? "",
    input.priority ?? 2,
    issueType,
    input.owner ?? "",
    input.assignee ?? null,
    input.parent_id ?? null,
    JSON.stringify(input.labels ?? []),
    JSON.stringify(input.metadata ?? {}),
    input.acceptance_criteria ?? null,
    input.design ?? null,
    input.notes ?? null,
    input.estimated_minutes ?? null,
    input.due_at ?? null,
    timestamp,
    input.created_by ?? "",
    timestamp,
  );

  return taskGet(orgId, id, namespaceId)!;
}

export function taskUpdate(
  orgId: string,
  id: string,
  fields: TaskUpdateFields,
  namespaceId?: string
): void {
  const db = getDb(namespaceId);
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];

  if (fields.title !== undefined) { sets.push("title = ?"); params.push(fields.title); }
  if (fields.description !== undefined) { sets.push("description = ?"); params.push(fields.description); }
  if (fields.status !== undefined) {
    sets.push("status = ?"); params.push(fields.status);
    if (fields.status === "closed") { sets.push("closed_at = ?"); params.push(now()); }
  }
  if (fields.priority !== undefined) { sets.push("priority = ?"); params.push(fields.priority); }
  if (fields.assignee !== undefined) { sets.push("assignee = ?"); params.push(fields.assignee); }
  if (fields.acceptance_criteria !== undefined) { sets.push("acceptance_criteria = ?"); params.push(fields.acceptance_criteria); }
  if (fields.design !== undefined) { sets.push("design = ?"); params.push(fields.design); }
  if (fields.notes !== undefined) { sets.push("notes = ?"); params.push(fields.notes); }
  if (fields.labels !== undefined) { sets.push("labels = ?"); params.push(JSON.stringify(fields.labels)); }
  if (fields.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(fields.metadata)); }
  if (fields.estimated_minutes !== undefined) { sets.push("estimated_minutes = ?"); params.push(fields.estimated_minutes); }
  if (fields.due_at !== undefined) { sets.push("due_at = ?"); params.push(fields.due_at); }
  if (fields.workspace_id !== undefined) { sets.push("workspace_id = ?"); params.push(fields.workspace_id); }

  params.push(id, orgId);
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND org_id = ?`).run(...params);
}

/**
 * Read existing task metadata and merge with new fields.
 * Prevents the common bug where callers overwrite the entire metadata
 * column (losing chain_id, chain_name, etc.) when they only meant to
 * update run status fields.
 */
export function taskMergeMeta(
  orgId: string,
  id: string,
  fields: Record<string, unknown>,
  namespaceId?: string
): void {
  const task = taskGet(orgId, id, namespaceId);
  const existing =
    task?.metadata && typeof task.metadata === "object"
      ? (task.metadata as Record<string, unknown>)
      : {};
  taskUpdate(orgId, id, { metadata: { ...existing, ...fields } }, namespaceId);
}

export function taskClose(
  orgId: string,
  id: string,
  _reason?: string,
  namespaceId?: string
): void {
  const db = getDb(namespaceId);
  const timestamp = now();
  db.prepare(
    "UPDATE tasks SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ? AND org_id = ?"
  ).run(timestamp, timestamp, id, orgId);
}

export function taskDelete(
  orgId: string,
  id: string,
  namespaceId?: string
): void {
  const db = getDb(namespaceId);
  // remove dependencies first
  db.prepare("DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_id = ?").run(id, id);
  // remove comments
  db.prepare("DELETE FROM task_comments WHERE task_id = ?").run(id);
  // remove the task
  db.prepare("DELETE FROM tasks WHERE id = ? AND org_id = ?").run(id, orgId);
}

// ---------- dependencies ----------

export function taskAddDep(
  orgId: string,
  taskId: string,
  dependsOnId: string,
  namespaceId?: string,
  workspaceId?: string
): void {
  const db = getDb(namespaceId);
  const t1 = db.prepare("SELECT id, workspace_id FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId) as { id: string; workspace_id: string | null } | undefined;
  const t2 = db.prepare("SELECT id, workspace_id FROM tasks WHERE id = ? AND org_id = ?").get(dependsOnId, orgId) as { id: string; workspace_id: string | null } | undefined;
  if (!t1 || !t2) throw new Error("Task not found or org mismatch");
  if (workspaceId && (t1.workspace_id !== workspaceId || t2.workspace_id !== workspaceId)) {
    throw new Error("Task not found in workspace");
  }

  db.prepare(
    "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id, type, created_at) VALUES (?, ?, 'blocks', ?)"
  ).run(taskId, dependsOnId, now());
}

export function taskRemoveDep(
  orgId: string,
  taskId: string,
  dependsOnId: string,
  namespaceId?: string
): void {
  const db = getDb(namespaceId);
  const t = db.prepare("SELECT id FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId);
  if (!t) throw new Error("Task not found or org mismatch");

  db.prepare(
    "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?"
  ).run(taskId, dependsOnId);
}

export function taskGetAllDeps(
  orgId: string,
  namespaceId?: string
): Array<{ task_id: string; depends_on_id: string; type: string }> {
  const db = getDb(namespaceId);
  return db.prepare(`
    SELECT d.task_id, d.depends_on_id, d.type
    FROM task_dependencies d
    JOIN tasks t ON t.id = d.task_id AND t.org_id = ?
  `).all(orgId) as Array<{ task_id: string; depends_on_id: string; type: string }>;
}

export function taskDepsAllClosed(
  orgId: string,
  taskId: string,
  namespaceId?: string
): boolean {
  const db = getDb(namespaceId);
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM task_dependencies d
    JOIN tasks t ON t.id = d.depends_on_id AND t.org_id = ?
    WHERE d.task_id = ? AND t.status NOT IN ('closed', 'resolved')
  `).get(orgId, taskId) as { cnt: number };
  return row.cnt === 0;
}

// ---------- comments ----------

export function taskGetComments(
  orgId: string,
  taskId: string,
  namespaceId?: string
): TaskComment[] {
  const db = getDb(namespaceId);
  const t = db.prepare("SELECT id FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId);
  if (!t) return [];
  return db.prepare(
    "SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC"
  ).all(taskId) as TaskComment[];
}

export function taskAddComment(
  orgId: string,
  taskId: string,
  author: string,
  text: string,
  namespaceId?: string
): void {
  const db = getDb(namespaceId);
  const t = db.prepare("SELECT id FROM tasks WHERE id = ? AND org_id = ?").get(taskId, orgId);
  if (!t) throw new Error("Task not found or org mismatch");
  db.prepare(
    "INSERT INTO task_comments (task_id, author, text, created_at) VALUES (?, ?, ?, ?)"
  ).run(taskId, author, text, now());
}

// ---------- activity ----------

export function taskGetActivity(
  orgId: string,
  sinceMs: number,
  workspaceId?: string,
  namespaceId?: string
): TaskRecord[] {
  const db = getDb(namespaceId);
  const sinceDate = new Date(sinceMs).toISOString();
  const conditions: string[] = ["org_id = ?", "updated_at >= ?"];
  const params: unknown[] = [orgId, sinceDate];

  if (workspaceId) {
    conditions.push("workspace_id = ?");
    params.push(workspaceId);
  }

  const sql = `SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT 500`;
  return (db.prepare(sql).all(...params) as RawTaskRow[]).map(rowToTaskRecord);
}

// ---------- validation ----------

const MAX_ID_LEN = 80;

export function validateTaskId(id: string): string {
  const trimmed = id.trim().slice(0, MAX_ID_LEN);
  // accept native format only (TASK-001, FEAT-001, BUG-001...)
  if (!/^[A-Z]+-\d+$/.test(trimmed)) {
    throw new Error("Invalid task ID format");
  }
  return trimmed;
}
