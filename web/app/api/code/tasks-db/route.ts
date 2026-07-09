import { existsSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac-auth";
import { BadRequest, NotFound } from "@/lib/api-errors";
import { withErrorHandling, apiSuccess } from "@/lib/api-response";
import config from "@/lib/config";
import { getNamespaceIdFromRequest } from "@/lib/namespace-config";
import { filterVisibleTaskRecords, type VisibilityTask } from "@/lib/tasks/task-visibility";

export const dynamic = "force-dynamic";

type SqliteValue = string | number | bigint | Buffer | null;

interface IndexInfo {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
  schema: string;
}

interface ColumnStats {
  column: string;
  nullCount: number;
  distinctCount: number;
}

interface TableInfo {
  name: string;
  type: "table" | "view";
  schema: string;
  columns: Array<{ name: string; type: string; notnull: number; pk: number; dflt_value: SqliteValue }>;
  indexes: IndexInfo[];
  rowCount: number | null;
}

interface TaskLite {
  id: string;
  title: string | null;
  status: string | null;
  parent_id: string | null;
  workspace_id: string | null;
  updated_at: string | null;
}

function getTasksDbPath(namespaceId: string): string {
  return join(config.globalRoot, "namespaces", namespaceId, "data", "tasks.db");
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function toPlainValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toPlainValue(value)]));
}

function readIndexes(db: import("better-sqlite3").Database, tableName: string): IndexInfo[] {
  const rows = db.prepare(`PRAGMA index_list(${quoteIdent(tableName)})`).all() as Array<{
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>;
  return rows.map((row) => {
    const columns = db
      .prepare(`PRAGMA index_info(${quoteIdent(row.name)})`)
      .all() as Array<{ name: string | null }>;
    const schema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(row.name) as { sql?: string | null } | undefined;
    return {
      name: row.name,
      unique: row.unique === 1,
      origin: row.origin,
      partial: row.partial === 1,
      columns: columns.map((column) => column.name).filter((name): name is string => !!name),
      schema: schema?.sql || "",
    };
  });
}

function readTables(db: import("better-sqlite3").Database): TableInfo[] {
  const rows = db.prepare(`
    SELECT name, type, sql
    FROM sqlite_master
    WHERE type IN ('table', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as Array<{ name: string; type: "table" | "view"; sql: string | null }>;

  return rows.map((row) => {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(row.name)})`).all() as TableInfo["columns"];
    let rowCount: number | null = null;
    try {
      const countRow = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(row.name)}`).get() as { count?: number } | undefined;
      rowCount = Number(countRow?.count ?? 0);
    } catch {
      rowCount = null;
    }
    return {
      name: row.name,
      type: row.type,
      schema: row.sql || "",
      columns,
      indexes: readIndexes(db, row.name),
      rowCount,
    };
  });
}

function parseFilters(raw: string | null, allowedColumns: Set<string>): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([column, value]) => allowedColumns.has(column) && typeof value === "string" && value.trim() !== "")
        .map(([column, value]) => [column, value.trim()]),
    );
  } catch {
    return {};
  }
}

function buildWhere(input: {
  columns: string[];
  query: string;
  filters: Record<string, string>;
}): { sql: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (input.query) {
    clauses.push(`(${input.columns.map((column) => `CAST(${quoteIdent(column)} AS TEXT) LIKE ?`).join(" OR ")})`);
    params.push(...input.columns.map(() => `%${input.query}%`));
  }
  for (const [column, value] of Object.entries(input.filters)) {
    clauses.push(`CAST(${quoteIdent(column)} AS TEXT) LIKE ?`);
    params.push(`%${value}%`);
  }
  return {
    sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function readStats(db: import("better-sqlite3").Database, table: TableInfo): ColumnStats[] {
  return table.columns.map((column) => {
    const row = db.prepare(`
      SELECT
        SUM(CASE WHEN ${quoteIdent(column.name)} IS NULL THEN 1 ELSE 0 END) AS nullCount,
        COUNT(DISTINCT ${quoteIdent(column.name)}) AS distinctCount
      FROM ${quoteIdent(table.name)}
    `).get() as { nullCount?: number | null; distinctCount?: number | null };
    return {
      column: column.name,
      nullCount: Number(row?.nullCount ?? 0),
      distinctCount: Number(row?.distinctCount ?? 0),
    };
  });
}

function hasTable(tables: TableInfo[], name: string): boolean {
  return tables.some((table) => table.name === name);
}

function hasColumn(tables: TableInfo[], tableName: string, columnName: string): boolean {
  return tables.find((table) => table.name === tableName)?.columns.some((column) => column.name === columnName) ?? false;
}

function readTaskGraph(db: import("better-sqlite3").Database, tables: TableInfo[]) {
  if (!hasTable(tables, "tasks")) {
    return { nodes: [], edges: [] };
  }
  // Select issue_type + metadata (not part of TaskLite) purely so
  // filterVisibleTaskRecords can identify superseded decision gates -- this
  // raw db browse must not expose tasks /api/tasks already hides. Stripped
  // back down to TaskLite before returning.
  const rawNodes = db.prepare(`
    SELECT id, title, status, parent_id, workspace_id, updated_at, issue_type, metadata
    FROM tasks
    ORDER BY id
    LIMIT 1000
  `).all().map((row) => normalizeRow(row as Record<string, unknown>)) as unknown as Array<TaskLite & VisibilityTask>;
  const visibleNodes = filterVisibleTaskRecords(rawNodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const nodes: TaskLite[] = visibleNodes.map(({ id, title, status, parent_id, workspace_id, updated_at }) => ({
    id, title, status, parent_id, workspace_id, updated_at,
  }));
  const edges = nodes
    .filter((task) => task.parent_id && visibleIds.has(task.parent_id))
    .map((task) => ({ from: task.parent_id, to: task.id, type: "parent" }));
  if (hasTable(tables, "task_dependencies")) {
    const dependencyEdges = db.prepare(`
      SELECT task_id AS to_id, depends_on_id AS from_id
      FROM task_dependencies
      WHERE task_id IS NOT NULL AND depends_on_id IS NOT NULL
      ORDER BY task_id, depends_on_id
      LIMIT 2000
    `).all() as Array<{ to_id: string; from_id: string }>;
    edges.push(
      ...dependencyEdges
        .filter((edge) => visibleIds.has(edge.from_id) && visibleIds.has(edge.to_id))
        .map((edge) => ({ from: edge.from_id, to: edge.to_id, type: "depends_on" })),
    );
  }
  return { nodes, edges };
}

function readDependencies(db: import("better-sqlite3").Database, tables: TableInfo[], taskId: string) {
  if (!hasTable(tables, "tasks")) {
    return { task: null, parent: null, children: [], blockedBy: [], blocks: [] };
  }
  // task itself is an explicit by-id lookup (caller already knows the id, same
  // as [id]/deps/route.ts not filtering its root); the LISTS of related tasks
  // below go through filterVisibleTaskRecords so a superseded decision gate
  // can't be discovered via this raw browse either.
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  const parentId = typeof task?.parent_id === "string" ? task.parent_id : "";
  const parent = parentId
    ? db.prepare("SELECT id, title, status, issue_type, metadata FROM tasks WHERE id = ?").get(parentId)
    : null;
  const rawChildren = db.prepare(
    "SELECT id, title, status, issue_type, metadata FROM tasks WHERE parent_id = ? ORDER BY id LIMIT 200"
  ).all(taskId) as unknown as VisibilityTask[];
  const children = filterVisibleTaskRecords(rawChildren);
  let rawBlockedBy: unknown[] = [];
  let rawBlocks: unknown[] = [];
  if (hasTable(tables, "task_dependencies")) {
    rawBlockedBy = db.prepare(`
      SELECT d.depends_on_id AS id, t.title, t.status, t.issue_type, t.metadata
      FROM task_dependencies d
      LEFT JOIN tasks t ON t.id = d.depends_on_id
      WHERE d.task_id = ?
      ORDER BY d.depends_on_id
      LIMIT 200
    `).all(taskId);
    rawBlocks = db.prepare(`
      SELECT d.task_id AS id, t.title, t.status, t.issue_type, t.metadata
      FROM task_dependencies d
      LEFT JOIN tasks t ON t.id = d.task_id
      WHERE d.depends_on_id = ?
      ORDER BY d.task_id
      LIMIT 200
    `).all(taskId);
  }
  const blockedBy = filterVisibleTaskRecords(rawBlockedBy as VisibilityTask[]);
  const blocks = filterVisibleTaskRecords(rawBlocks as VisibilityTask[]);
  return {
    task: task ? normalizeRow(task) : null,
    parent: parent ? normalizeRow(parent as Record<string, unknown>) : null,
    children: children.map((row) => normalizeRow(row as unknown as Record<string, unknown>)),
    blockedBy: blockedBy.map((row) => normalizeRow(row as unknown as Record<string, unknown>)),
    blocks: blocks.map((row) => normalizeRow(row as unknown as Record<string, unknown>)),
  };
}

function readDiagnostics(db: import("better-sqlite3").Database, tables: TableInfo[]) {
  const warnings: Array<{ code: string; message: string; count: number }> = [];
  const missingParents = hasTable(tables, "tasks") && hasColumn(tables, "tasks", "parent_id")
    ? db.prepare(`
      SELECT child.id, child.title, child.parent_id
      FROM tasks child
      LEFT JOIN tasks parent ON parent.id = child.parent_id
      WHERE child.parent_id IS NOT NULL AND child.parent_id != '' AND parent.id IS NULL
      ORDER BY child.id
      LIMIT 200
    `).all().map((row) => normalizeRow(row as Record<string, unknown>))
    : [];
  if (missingParents.length > 0) warnings.push({ code: "missing_parent", message: "tasks reference parent_id values that do not exist", count: missingParents.length });

  const missingDependencies = hasTable(tables, "task_dependencies")
    ? db.prepare(`
      SELECT d.task_id, d.depends_on_id,
        CASE WHEN t.id IS NULL THEN 1 ELSE 0 END AS missing_task,
        CASE WHEN dep.id IS NULL THEN 1 ELSE 0 END AS missing_dependency
      FROM task_dependencies d
      LEFT JOIN tasks t ON t.id = d.task_id
      LEFT JOIN tasks dep ON dep.id = d.depends_on_id
      WHERE t.id IS NULL OR dep.id IS NULL
      ORDER BY d.task_id, d.depends_on_id
      LIMIT 200
    `).all().map((row) => normalizeRow(row as Record<string, unknown>))
    : [];
  if (missingDependencies.length > 0) warnings.push({ code: "missing_dependency", message: "dependency rows reference missing tasks", count: missingDependencies.length });

  const duplicates = hasTable(tables, "tasks") && hasColumn(tables, "tasks", "title")
    ? db.prepare(`
      SELECT lower(trim(title)) AS normalized_title, COUNT(*) AS count, group_concat(id, ', ') AS task_ids
      FROM tasks
      WHERE title IS NOT NULL AND trim(title) != ''
      GROUP BY lower(trim(title))
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, normalized_title
      LIMIT 200
    `).all().map((row) => normalizeRow(row as Record<string, unknown>))
    : [];
  if (duplicates.length > 0) warnings.push({ code: "duplicate_title", message: "multiple tasks share the same normalized title", count: duplicates.length });

  const invalidStatus = hasTable(tables, "tasks") && hasColumn(tables, "tasks", "status")
    ? db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM tasks
      WHERE status IS NULL OR status NOT IN ('open', 'in_progress', 'blocked', 'closed', 'complete', 'failed', 'cancelled')
      GROUP BY status
      ORDER BY count DESC
    `).all().map((row) => normalizeRow(row as Record<string, unknown>))
    : [];
  if (invalidStatus.length > 0) warnings.push({ code: "invalid_status", message: "tasks contain statuses outside the known task-state vocabulary", count: invalidStatus.length });

  const closedWithoutClosedAt = hasTable(tables, "tasks") && hasColumn(tables, "tasks", "closed_at") && hasColumn(tables, "tasks", "status")
    ? db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status IN ('closed', 'complete') AND (closed_at IS NULL OR closed_at = '')").get() as { count?: number }
    : { count: 0 };
  if (Number(closedWithoutClosedAt.count ?? 0) > 0) {
    warnings.push({ code: "closed_without_closed_at", message: "closed tasks are missing closed_at", count: Number(closedWithoutClosedAt.count ?? 0) });
  }

  return { missingParents, missingDependencies, duplicates, invalidStatus, warnings };
}

function assertReadOnlySelect(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) throw new BadRequest("SQL is required");
  if (trimmed.includes(";")) throw new BadRequest("Only one SELECT statement is allowed");
  const compact = trimmed.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ").trim();
  if (!/^(select|with)\b/i.test(compact)) throw new BadRequest("Only SELECT statements are allowed");
  if (/\b(insert|update|delete|replace|drop|alter|create|vacuum|attach|detach|pragma|reindex|analyze|begin|commit|rollback)\b/i.test(compact)) {
    throw new BadRequest("Only read-only SELECT statements are allowed");
  }
  return trimmed;
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Raw table browse + arbitrary read-only SELECT against tasks.db is a
  // dev/admin diagnostic surface, not a general task API -- require the same
  // role tier as /api/audit (owner/admin), not just an authenticated session.
  const permissionError = await requirePermission(request, "view_audit");
  if (permissionError) return permissionError;

  const namespaceId = await getNamespaceIdFromRequest(request);
  const dbPath = getTasksDbPath(namespaceId);
  if (!existsSync(dbPath)) {
    // NotFound's identifier ends up in the error response's `details.id` --
    // never the absolute host filesystem path (namespaceId is enough to debug).
    throw new NotFound("tasks.db", namespaceId);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");

  try {
    const tables = readTables(db);
    const mode = request.nextUrl.searchParams.get("mode") || "";
    if (mode === "diagnostics") {
      // Intentionally NOT run through filterVisibleTaskRecords: this surfaces
      // data-integrity anomalies (orphaned parents, duplicate titles, invalid
      // statuses), and a superseded decision gate having e.g. a missing
      // parent is exactly the kind of thing this mode exists to catch.
      return apiSuccess({ namespaceId, ...readDiagnostics(db, tables) });
    }
    if (mode === "graph") {
      return apiSuccess({ namespaceId, ...readTaskGraph(db, tables) });
    }
    if (mode === "dependencies") {
      const taskId = (request.nextUrl.searchParams.get("taskId") || "").trim();
      if (!taskId) throw new BadRequest("taskId is required");
      return apiSuccess({ namespaceId, taskId, ...readDependencies(db, tables, taskId) });
    }
    if (mode === "select") {
      // Arbitrary read-only SQL against ANY table -- shape of the result set
      // is unknown, so it can't be run through filterVisibleTaskRecords
      // without risking silently dropping rows from unrelated tables that
      // happen to have an `id` column. Admin/dev gating above is the control
      // here, not row-level visibility.
      const sql = assertReadOnlySelect(request.nextUrl.searchParams.get("sql") || "");
      const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") || "100", 10);
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
      const statement = `SELECT * FROM (${sql}) AS readonly_select LIMIT ?`;
      const rows = db.prepare(statement).all(limit).map((row) => normalizeRow(row as Record<string, unknown>));
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
      return apiSuccess({ namespaceId, sql, executedSql: statement, columns, rows, limit });
    }

    const tableName = request.nextUrl.searchParams.get("table");
    if (!tableName) {
      return apiSuccess({ namespaceId, tables });
    }

    const table = tables.find((item) => item.name === tableName);
    if (!table) {
      throw new BadRequest("unknown table", { table: tableName });
    }

    const allowedColumns = new Set(table.columns.map((column) => column.name));
    const query = (request.nextUrl.searchParams.get("q") || "").trim();
    const filters = parseFilters(request.nextUrl.searchParams.get("filters"), allowedColumns);
    const sort = request.nextUrl.searchParams.get("sort") || "";
    const sortColumn = allowedColumns.has(sort) ? sort : "";
    const dir = request.nextUrl.searchParams.get("dir") === "desc" ? "DESC" : "ASC";
    const withStats = request.nextUrl.searchParams.get("stats") === "1";
    const columns = table.columns.map((column) => column.name);
    const where = buildWhere({ columns, query, filters });
    const orderBy = sortColumn ? ` ORDER BY ${quoteIdent(sortColumn)} ${dir}` : "";
    const generatedSql = `SELECT * FROM ${quoteIdent(table.name)}${where.sql}${orderBy} LIMIT ? OFFSET ?`;
    const countRow = db
      .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(table.name)}${where.sql}`)
      .get(...where.params) as { count?: number } | undefined;
    const filteredRowCount = Number(countRow?.count ?? 0);
    const limitParam = Number.parseInt(request.nextUrl.searchParams.get("limit") || "100", 10);
    const offsetParam = Number.parseInt(request.nextUrl.searchParams.get("offset") || "0", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
    const rawRows = db
      .prepare(generatedSql)
      .all(...where.params, limit, offset)
      .map((row) => normalizeRow(row as Record<string, unknown>));
    // The generic table browser works against ANY table; only the `tasks`
    // table itself carries superseded-decision-gate visibility rules. Note
    // filteredRowCount/hasMore below are computed pre-filter (SQL COUNT/LIMIT
    // happen before this post-fetch filter step), so they can slightly
    // overcount when a page contains a hidden row -- acceptable for this
    // admin-only diagnostic view; a fully accurate count would need the
    // visibility predicate pushed into SQL, which is out of scope here.
    const rows = tableName === "tasks"
      ? filterVisibleTaskRecords(rawRows as unknown as VisibilityTask[])
      : rawRows;

    return apiSuccess({
      namespaceId,
      table,
      rows,
      limit,
      offset,
      query,
      filters,
      sort: sortColumn,
      dir: dir.toLowerCase(),
      generatedSql,
      generatedSqlParams: [...where.params, limit, offset],
      filteredRowCount,
      stats: withStats ? readStats(db, table) : undefined,
      hasMore: offset + rows.length < filteredRowCount,
    });
  } finally {
    db.close();
  }
});
