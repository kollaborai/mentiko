"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiErrorMessage, unwrapApiData } from "@/lib/api/api-client";
import { cn } from "@/lib/utils";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { CopyFilled, Export2Filled, Refresh2Filled } from "@aliimam/icons";

type DbMode = "table" | "schema" | "recent" | "graph" | "dependencies" | "diagnostics" | "select";

interface DbColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: unknown;
}

interface ColumnStats {
  column: string;
  nullCount: number;
  distinctCount: number;
}

interface DbTable {
  name: string;
  type: "table" | "view";
  schema: string;
  columns: DbColumn[];
  rowCount: number | null;
}

interface DbTablePayload {
  table: DbTable;
  rows: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
  hasMore: boolean;
  filteredRowCount: number;
  generatedSql: string;
  generatedSqlParams: unknown[];
  stats?: ColumnStats[];
}

interface GraphPayload {
  nodes: Array<{ id: string; title?: string | null; status?: string | null; parent_id?: string | null; workspace_id?: string | null }>;
  edges: Array<{ from: string; to: string; type: "parent" | "depends_on" }>;
}

interface DependenciesPayload {
  taskId: string;
  task: Record<string, unknown> | null;
  parent: Record<string, unknown> | null;
  children: Array<Record<string, unknown>>;
  blockedBy: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
}

interface DiagnosticsPayload {
  warnings: Array<{ code: string; message: string; count: number }>;
  missingParents: Array<Record<string, unknown>>;
  missingDependencies: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
  invalidStatus: Array<Record<string, unknown>>;
}

interface SelectPayload {
  sql: string;
  executedSql: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  limit: number;
}

interface TasksDbViewProps {
  mode: DbMode;
  table?: string;
}

const PAGE_SIZES = [50, 100, 250, 500];
const FILTER_STORAGE_PREFIX = "tasks-db-saved-filters:";
const WIDTH_STORAGE_PREFIX = "tasks-db-column-widths:";
const DEFAULT_COLUMN_WIDTH = 288;
const ROW_COLUMN_WIDTH = 96;

export function TasksDbView({ mode, table }: TasksDbViewProps) {
  if (mode === "graph") return <GraphView />;
  if (mode === "dependencies") return <DependenciesView />;
  if (mode === "diagnostics") return <DiagnosticsView />;
  if (mode === "select") return <SelectConsoleView />;
  return <DbTableView mode={mode} table={mode === "recent" ? "tasks" : table} />;
}

function DbTableView({ mode, table }: { mode: "table" | "schema" | "recent"; table?: string }) {
  const [payload, setPayload] = useState<DbTablePayload | null>(null);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(
    mode === "recent" ? { column: "updated_at", dir: "desc" } : null,
  );
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [diffA, setDiffA] = useState<Record<string, unknown> | null>(null);
  const [diffB, setDiffB] = useState<Record<string, unknown> | null>(null);
  const [savedName, setSavedName] = useState("");
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const storageKey = `${FILTER_STORAGE_PREFIX}${table || "unknown"}`;
  const widthStorageKey = `${WIDTH_STORAGE_PREFIX}${table || "unknown"}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setSavedFilters(raw ? JSON.parse(raw) as SavedFilter[] : []);
    } catch {
      setSavedFilters([]);
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(widthStorageKey);
      setColumnWidths(raw ? JSON.parse(raw) as Record<string, number> : {});
    } catch {
      setColumnWidths({});
    }
  }, [widthStorageKey]);

  const load = useCallback(async () => {
    if (!table) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        table,
        limit: String(pageSize),
        offset: String(offset),
        stats: "1",
      });
      if (search.trim()) params.set("q", search.trim());
      if (Object.keys(filters).length > 0) params.set("filters", JSON.stringify(filters));
      if (sort?.column) {
        params.set("sort", sort.column);
        params.set("dir", sort.dir);
      }
      const res = await fetch(`/api/code/tasks-db?${params}`);
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "failed to load table"));
      setPayload(unwrapApiData<DbTablePayload>(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load table");
    } finally {
      setLoading(false);
    }
  }, [filters, offset, pageSize, search, sort, table]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = useMemo(() => payload?.table.columns.map((column) => column.name) ?? [], [payload]);
  const hasStatus = columns.includes("status");
  const hasWorkspace = columns.includes("workspace_id");
  const visibleCsv = useMemo(() => payload ? rowsToCsv(columns, payload.rows) : "", [columns, payload]);

  const resetAndSetSearch = useCallback((value: string) => {
    setOffset(0);
    setSearch(value);
  }, []);

  const setColumnFilter = useCallback((column: string, value: string) => {
    setOffset(0);
    setFilters((prev) => {
      const next = { ...prev };
      if (value.trim()) next[column] = value.trim();
      else delete next[column];
      return next;
    });
  }, []);

  const setQuickFilter = useCallback((column: string, value: string) => {
    setColumnFilter(column, filters[column] === value ? "" : value);
  }, [filters, setColumnFilter]);

  const toggleSort = useCallback((column: string) => {
    setOffset(0);
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  }, []);

  const copyText = useCallback(async (text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }, []);

  const download = useCallback((name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportAllRows = useCallback(async (format: "csv" | "json") => {
    if (!table) return;
    const rows: Array<Record<string, unknown>> = [];
    let nextOffset = 0;
    let exportColumns = columns;
    for (;;) {
      const params = new URLSearchParams({
        table,
        limit: "500",
        offset: String(nextOffset),
      });
      if (search.trim()) params.set("q", search.trim());
      if (Object.keys(filters).length > 0) params.set("filters", JSON.stringify(filters));
      if (sort?.column) {
        params.set("sort", sort.column);
        params.set("dir", sort.dir);
      }
      const res = await fetch(`/api/code/tasks-db?${params}`);
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "failed to export table"));
      const page = unwrapApiData<DbTablePayload>(raw);
      exportColumns = page.table.columns.map((column) => column.name);
      rows.push(...page.rows);
      if (!page.hasMore) break;
      nextOffset += page.limit;
    }
    if (format === "csv") {
      download(`${table}.csv`, rowsToCsv(exportColumns, rows), "text/csv");
    } else {
      download(`${table}.json`, JSON.stringify(rows, null, 2), "application/json");
    }
  }, [columns, download, filters, search, sort, table]);

  const saveFilter = useCallback(() => {
    const name = savedName.trim();
    if (!name) return;
    const next = [
      ...savedFilters.filter((item) => item.name !== name),
      { name, search, filters, sort, pageSize },
    ];
    setSavedFilters(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
    setSavedName("");
  }, [filters, pageSize, savedFilters, savedName, search, sort, storageKey]);

  const applyFilter = useCallback((saved: SavedFilter) => {
    setOffset(0);
    setSearch(saved.search);
    setFilters(saved.filters);
    setSort(saved.sort);
    setPageSize(saved.pageSize);
  }, []);

  const deleteFilter = useCallback((name: string) => {
    const next = savedFilters.filter((item) => item.name !== name);
    setSavedFilters(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }, [savedFilters, storageKey]);

  const setColumnWidth = useCallback((column: string, width: number) => {
    setColumnWidths((prev) => {
      const next = { ...prev, [column]: Math.max(120, Math.min(900, Math.round(width))) };
      localStorage.setItem(widthStorageKey, JSON.stringify(next));
      return next;
    });
  }, [widthStorageKey]);

  const resetColumnWidth = useCallback((column: string) => {
    setColumnWidths((prev) => {
      const next = { ...prev };
      delete next[column];
      localStorage.setItem(widthStorageKey, JSON.stringify(next));
      return next;
    });
  }, [widthStorageKey]);

  if (!table) return <CenteredText>table required</CenteredText>;
  if (loading && !payload) return <CenteredSpinner />;
  if (error && !payload) return <CenteredText tone="error">{error}</CenteredText>;
  if (!payload) return null;

  if (mode === "schema") {
    return (
      <div className="flex h-full flex-col bg-[#0a0a0a]">
        <DbViewHeader table={payload.table} onRefresh={load} loading={loading} />
        <pre className="flex-1 overflow-auto p-4 text-[12px] leading-6 text-white/70">
          <code>{payload.table.schema || "-- schema unavailable"}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <DbViewHeader table={payload.table} onRefresh={load} loading={loading} />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/6 px-3 py-2">
        <input
          value={search}
          onChange={(event) => resetAndSetSearch(event.target.value)}
          placeholder="search all columns"
          className="h-7 w-52 rounded-md border border-white/8 bg-white/[0.035] px-2 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/18"
        />
        {hasStatus && ["open", "in_progress", "blocked", "closed"].map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setQuickFilter("status", status)}
            className={cn(
              "h-7 rounded-md px-2 text-[10px] transition-colors",
              filters.status === status ? "bg-white/10 text-white/75" : "text-white/30 hover:bg-white/5 hover:text-white/60",
            )}
          >
            {status}
          </button>
        ))}
        {hasWorkspace && (
          <input
            value={filters.workspace_id || ""}
            onChange={(event) => setColumnFilter("workspace_id", event.target.value)}
            placeholder="workspace_id"
            className="h-7 w-40 rounded-md border border-white/8 bg-white/[0.035] px-2 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/18"
          />
        )}
        <select
          value={pageSize}
          onChange={(event) => {
            setOffset(0);
            setPageSize(Number(event.target.value));
          }}
          className="h-7 rounded-md border border-white/8 bg-[#101014] px-2 text-[11px] text-white/55 outline-none"
        >
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <input
          value={savedName}
          onChange={(event) => setSavedName(event.target.value)}
          placeholder="filter name"
          className="h-7 w-32 rounded-md border border-white/8 bg-white/[0.035] px-2 text-[11px] text-white/70 outline-none placeholder:text-white/20 focus:border-white/18"
        />
        <button type="button" onClick={saveFilter} className="h-7 rounded-md px-2 text-[10px] text-white/35 hover:bg-white/5 hover:text-white/65">save</button>
        <button type="button" onClick={() => copyText(visibleCsv)} className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-white/35 hover:bg-white/5 hover:text-white/65">
          <CopyFilled className="h-3 w-3" />
          csv
        </button>
        <button type="button" onClick={() => exportAllRows("csv").catch((err) => setError(err instanceof Error ? err.message : "failed to export table"))} className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-white/35 hover:bg-white/5 hover:text-white/65">
          <Export2Filled className="h-3 w-3" />
          csv
        </button>
        <button type="button" onClick={() => exportAllRows("json").catch((err) => setError(err instanceof Error ? err.message : "failed to export table"))} className="flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-white/35 hover:bg-white/5 hover:text-white/65">
          <Export2Filled className="h-3 w-3" />
          json
        </button>
      </div>
      {savedFilters.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/6 px-3 py-1.5">
          {savedFilters.map((saved) => (
            <span key={saved.name} className="inline-flex items-center rounded-md bg-white/[0.035] text-[10px] text-white/35">
              <button type="button" onClick={() => applyFilter(saved)} className="px-2 py-1 hover:text-white/65">{saved.name}</button>
              <button type="button" onClick={() => deleteFilter(saved.name)} className="px-1.5 py-1 text-white/18 hover:text-red-300/70">x</button>
            </span>
          ))}
        </div>
      )}
      <SqlPreview payload={payload} />
      {error && <div className="mx-3 mb-2 rounded-md bg-red-500/10 px-2 py-1 text-[11px] text-red-400/70">{error}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] overflow-hidden max-xl:grid-cols-1">
        <div className="min-w-0 overflow-auto">
          <table className="min-w-full table-fixed border-separate border-spacing-0 text-left font-mono text-[11px]">
            <colgroup>
              <col style={{ width: ROW_COLUMN_WIDTH }} />
              {columns.map((column) => (
                <col key={column} style={{ width: columnWidths[column] ?? DEFAULT_COLUMN_WIDTH }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr>
                <th className="border-b border-white/8 px-3 py-2 font-medium text-white/20">row</th>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="relative border-b border-white/8 px-3 py-2 align-top font-medium text-white/35"
                  >
                    <button type="button" onClick={() => toggleSort(column)} className="flex items-center gap-1 text-left hover:text-white/70">
                      <span>{column}</span>
                      {sort?.column === column && <span className="text-white/25">{sort.dir === "asc" ? "up" : "down"}</span>}
                    </button>
                    <input
                      value={filters[column] || ""}
                      onChange={(event) => setColumnFilter(column, event.target.value)}
                      placeholder="filter"
                      className="mt-1 h-6 w-full min-w-24 rounded border border-white/6 bg-white/[0.025] px-1.5 text-[10px] text-white/55 outline-none placeholder:text-white/16 focus:border-white/14"
                    />
                    <ColumnResizeHandle
                      column={column}
                      width={columnWidths[column] ?? DEFAULT_COLUMN_WIDTH}
                      onResize={setColumnWidth}
                      onReset={resetColumnWidth}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payload.rows.map((row, rowIndex) => (
                <tr key={`${payload.offset}-${rowIndex}`} className={cn("hover:bg-white/[0.035]", selectedRow === row && "bg-white/[0.05]")}>
                  <td className="border-b border-white/[0.035] px-3 py-1.5 align-top text-white/20">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setSelectedRow(row)} className="rounded px-1 text-white/30 hover:bg-white/5 hover:text-white/70">
                        {payload.offset + rowIndex + 1}
                      </button>
                      <button type="button" title="Diff A" onClick={() => setDiffA(row)} className="rounded px-1 text-[9px] text-cyan-300/45 hover:bg-white/5">A</button>
                      <button type="button" title="Diff B" onClick={() => setDiffB(row)} className="rounded px-1 text-[9px] text-amber-200/45 hover:bg-white/5">B</button>
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="overflow-hidden border-b border-white/[0.035] px-3 py-1.5 align-top text-white/62"
                      onClick={() => setSelectedRow(row)}
                    >
                      <CellValue column={column} table={payload.table.name} value={row[column]} onCopy={copyText} />
                    </td>
                  ))}
                </tr>
              ))}
              {payload.rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(columns.length + 1, 1)} className="px-3 py-8 text-center text-white/25">empty table</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <RowDetail
          row={selectedRow}
          columns={columns}
          stats={payload.stats || []}
          diffA={diffA}
          diffB={diffB}
          onClose={() => setSelectedRow(null)}
          onCopy={copyText}
        />
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-white/6 px-3 py-2 text-[10px] text-white/30">
        <span>
          rows {payload.rows.length === 0 ? 0 : payload.offset + 1}-{payload.offset + payload.rows.length}
          {` of ${payload.filteredRowCount}`}
          {payload.table.rowCount !== null && payload.filteredRowCount !== payload.table.rowCount ? ` filtered from ${payload.table.rowCount}` : ""}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" disabled={payload.offset === 0 || loading} onClick={() => setOffset((value) => Math.max(0, value - pageSize))} className="rounded-md px-2 py-1 text-white/35 hover:bg-white/5 hover:text-white/70 disabled:pointer-events-none disabled:opacity-30">prev</button>
          <button type="button" disabled={!payload.hasMore || loading} onClick={() => setOffset((value) => value + pageSize)} className="rounded-md px-2 py-1 text-white/35 hover:bg-white/5 hover:text-white/70 disabled:pointer-events-none disabled:opacity-30">next</button>
        </div>
      </div>
    </div>
  );
}

function GraphView() {
  const { data, loading, error, reload } = useModePayload<GraphPayload>("mode=graph", "failed to load graph");
  if (loading && !data) return <CenteredSpinner />;
  if (error && !data) return <CenteredText tone="error">{error}</CenteredText>;
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <ModeShell title="relationship graph" subtitle={`${nodes.length} nodes / ${edges.length} edges`} onRefresh={reload} loading={loading}>
      <div className="grid gap-2 p-3 lg:grid-cols-2">
        {edges.slice(0, 500).map((edge, index) => (
          <div key={`${edge.type}:${edge.from}:${edge.to}:${index}`} className="rounded-md border border-white/6 bg-white/[0.025] p-2 font-mono text-[11px]">
            <div className="mb-1 text-[10px] text-white/22">{edge.type}</div>
            <TaskLink id={edge.from} title={byId.get(edge.from)?.title} />
            <span className="mx-2 text-white/18">-&gt;</span>
            <TaskLink id={edge.to} title={byId.get(edge.to)?.title} />
          </div>
        ))}
        {edges.length === 0 && <EmptyLine>no relationships</EmptyLine>}
      </div>
    </ModeShell>
  );
}

function DependenciesView() {
  const [taskId, setTaskId] = useState("");
  const [queryId, setQueryId] = useState("");
  const params = queryId ? `mode=dependencies&taskId=${encodeURIComponent(queryId)}` : "";
  const { data, loading, error, reload } = useModePayload<DependenciesPayload>(params, "failed to load dependencies");
  return (
    <ModeShell title="dependencies" subtitle={queryId || "task"} onRefresh={reload} loading={loading}>
      <div className="flex gap-2 border-b border-white/6 p-3">
        <input value={taskId} onChange={(event) => setTaskId(event.target.value)} placeholder="TASK-123" className="h-8 w-48 rounded-md border border-white/8 bg-white/[0.035] px-2 text-xs text-white/70 outline-none" />
        <button type="button" onClick={() => setQueryId(taskId.trim())} className="rounded-md px-3 text-xs text-white/45 hover:bg-white/5 hover:text-white/70">open</button>
      </div>
      {loading && queryId && !data ? <CenteredSpinner /> : error && queryId && !data ? <CenteredText tone="error">{error}</CenteredText> : (
        <div className="grid gap-3 p-3 lg:grid-cols-2">
          <RelationshipList title="blocked by" rows={data?.blockedBy ?? []} />
          <RelationshipList title="blocks" rows={data?.blocks ?? []} />
          <RelationshipList title="children" rows={data?.children ?? []} />
          <RelationshipList title="parent" rows={data?.parent ? [data.parent] : []} />
        </div>
      )}
    </ModeShell>
  );
}

function DiagnosticsView() {
  const { data, loading, error, reload } = useModePayload<DiagnosticsPayload>("mode=diagnostics", "failed to load diagnostics");
  if (loading && !data) return <CenteredSpinner />;
  if (error && !data) return <CenteredText tone="error">{error}</CenteredText>;
  return (
    <ModeShell title="invariants" subtitle={`${data?.warnings.length ?? 0} warnings`} onRefresh={reload} loading={loading}>
      <div className="space-y-3 p-3">
        <DiagnosticsWarnings rows={data?.warnings ?? []} />
        <RecordList title="missing parents" rows={data?.missingParents ?? []} />
        <RecordList title="missing dependencies" rows={data?.missingDependencies ?? []} />
        <RecordList title="duplicate titles" rows={data?.duplicates ?? []} />
        <RecordList title="invalid statuses" rows={data?.invalidStatus ?? []} />
      </div>
    </ModeShell>
  );
}

function SelectConsoleView() {
  const [sql, setSql] = useState("SELECT id, title, status FROM tasks LIMIT 50");
  const [payload, setPayload] = useState<SelectPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode: "select", sql, limit: "500" });
      const res = await fetch(`/api/code/tasks-db?${params}`);
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "SELECT failed"));
      setPayload(unwrapApiData<SelectPayload>(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : "SELECT failed");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [sql]);

  return (
    <ModeShell title="select" subtitle="read-only" onRefresh={run} loading={loading}>
      <div className="border-b border-white/6 p-3">
        <textarea value={sql} onChange={(event) => setSql(event.target.value)} className="h-28 w-full resize-none rounded-md border border-white/8 bg-white/[0.035] p-2 font-mono text-xs leading-5 text-white/70 outline-none" />
        <button type="button" onClick={run} className="mt-2 h-8 rounded-md bg-white/8 px-3 text-xs text-white/65 hover:bg-white/12">run</button>
      </div>
      {error && <div className="m-3 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-300/70">{error}</div>}
      {payload && (
        <>
          <pre className="mx-3 mt-3 max-h-24 overflow-auto rounded-md bg-white/[0.025] p-2 text-[10px] text-white/30">{payload.executedSql}</pre>
          <SimpleRows columns={payload.columns} rows={payload.rows} />
        </>
      )}
    </ModeShell>
  );
}

function useModePayload<T>(params: string, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(params));
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!params) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/code/tasks-db?${params}`);
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getApiErrorMessage(raw, fallback));
      setData(unwrapApiData<T>(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setLoading(false);
    }
  }, [fallback, params]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, loading, error, reload };
}

function DbViewHeader({ table, onRefresh, loading }: { table: DbTable; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/6 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-semibold text-white/75">{table.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] font-mono text-white/25">
          <span>{table.type}</span>
          <span>{table.columns.length} columns</span>
          <span>{table.rowCount === null ? "?" : table.rowCount} rows</span>
        </div>
      </div>
      <RefreshButton onClick={onRefresh} loading={loading} />
    </div>
  );
}

function ModeShell({ title, subtitle, onRefresh, loading, children }: { title: string; subtitle: string; onRefresh: () => void; loading: boolean; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-[#0a0a0a]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/6 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-white/75">{title}</div>
          <div className="mt-0.5 font-mono text-[10px] text-white/25">{subtitle}</div>
        </div>
        <RefreshButton onClick={onRefresh} loading={loading} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

function RefreshButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={loading} title="Refresh" className="flex h-7 w-7 items-center justify-center rounded-md text-white/25 hover:bg-white/5 hover:text-white/60 disabled:opacity-40">
      <Refresh2Filled className="h-3.5 w-3.5" />
    </button>
  );
}

function SqlPreview({ payload }: { payload: DbTablePayload }) {
  return (
    <details className="border-b border-white/6 px-3 py-2 text-[10px] text-white/28">
      <summary className="cursor-pointer select-none">sql</summary>
      <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-white/[0.025] p-2 font-mono leading-4">
        {payload.generatedSql}
        {"\n"}
        {JSON.stringify(payload.generatedSqlParams)}
      </pre>
    </details>
  );
}

function ColumnResizeHandle({
  column,
  width,
  onResize,
  onReset,
}: {
  column: string;
  width: number;
  onResize: (column: string, width: number) => void;
  onReset: (column: string) => void;
}) {
  return (
    <button
      type="button"
      title="Resize column"
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset(column);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = width;
        const onMove = (moveEvent: MouseEvent) => {
          onResize(column, startWidth + moveEvent.clientX - startX);
        };
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
      className="absolute right-0 top-0 h-full w-3 cursor-col-resize border-r border-white/10 transition-colors hover:border-cyan-300/70 focus-visible:border-cyan-300/80 focus-visible:outline-none"
    />
  );
}

function CellValue({ column, table, value, onCopy }: { column: string; table: string; value: unknown; onCopy: (text: string) => void }) {
  const text = stringifyCell(value);
  const json = parseJsonish(value);
  const isTaskLink = typeof value === "string" && isTaskIdColumn(table, column, value);
  if (value === null || value === undefined) return <span className="text-white/18">null</span>;
  return (
    <div className="group/cell flex min-w-0 max-w-full items-start gap-1">
      <button type="button" onClick={(event) => { event.stopPropagation(); onCopy(text); }} title="Copy cell" className="mt-0.5 hidden h-4 w-4 shrink-0 items-center justify-center rounded text-white/20 hover:bg-white/5 hover:text-white/60 group-hover/cell:flex">
        <CopyFilled className="h-2.5 w-2.5" />
      </button>
      {isTaskLink ? (
        <TaskLink id={value} />
      ) : json ? (
        <JsonTree value={json} />
      ) : (
        <span className={cn("min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]", semanticClass(column, value))}>{text}</span>
      )}
    </div>
  );
}

function RowDetail({ row, columns, stats, diffA, diffB, onClose, onCopy }: {
  row: Record<string, unknown> | null;
  columns: string[];
  stats: ColumnStats[];
  diffA: Record<string, unknown> | null;
  diffB: Record<string, unknown> | null;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  const diff = useMemo(() => diffA && diffB ? diffRows(diffA, diffB) : [], [diffA, diffB]);
  if (!row) {
    return (
      <aside className="border-l border-white/6 bg-white/[0.015] p-3 text-[11px] text-white/24 max-xl:hidden">
        select a row
        <StatsList stats={stats} />
        <DiffList diff={diff} />
      </aside>
    );
  }

  return (
    <aside className="overflow-auto border-l border-white/6 bg-white/[0.015] p-3 max-xl:hidden">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-white/24">row detail</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onCopy(JSON.stringify(row, null, 2))} className="rounded-md px-2 py-1 text-[10px] text-white/35 hover:bg-white/5 hover:text-white/65">copy json</button>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[10px] text-white/25 hover:bg-white/5 hover:text-white/60">close</button>
        </div>
      </div>
      <DiffList diff={diff} />
      <div className="space-y-2">
        {columns.map((column) => {
          const json = parseJsonish(row[column]);
          return (
            <div key={column} className="rounded-md bg-white/[0.025] p-2">
              <div className="mb-1 text-[10px] font-mono text-white/28">{column}</div>
              {json ? <JsonTree value={json} /> : (
                <pre className={cn("max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-white/65", semanticClass(column, row[column]))}>
                  {formatDetailValue(row[column])}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function StatsList({ stats }: { stats: ColumnStats[] }) {
  if (stats.length === 0) return null;
  return (
    <div className="mt-4 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-white/18">stats</div>
      {stats.slice(0, 18).map((stat) => (
        <div key={stat.column} className="flex justify-between gap-2 font-mono">
          <span className="truncate">{stat.column}</span>
          <span className="shrink-0 text-white/16">{stat.nullCount} null / {stat.distinctCount} distinct</span>
        </div>
      ))}
    </div>
  );
}

function DiffList({ diff }: { diff: RowDiff[] }) {
  if (diff.length === 0) return null;
  return (
    <div className="mb-3 space-y-1 rounded-md bg-white/[0.025] p-2">
      <div className="text-[10px] uppercase tracking-wider text-white/18">diff</div>
      {diff.map((item) => (
        <div key={item.column} className="font-mono text-[10px]">
          <div className="text-white/35">{item.column}</div>
          <div className="break-words text-cyan-300/55">A {item.a}</div>
          <div className="break-words text-amber-200/55">B {item.b}</div>
        </div>
      ))}
    </div>
  );
}

function JsonTree({ value }: { value: unknown }) {
  if (value === null) return <span className="text-white/18">null</span>;
  if (Array.isArray(value)) {
    return (
      <div className="max-h-44 overflow-auto font-mono text-[10px] leading-4 text-emerald-200/60">
        {value.map((item, index) => <JsonBranch key={index} label={String(index)} value={item} />)}
      </div>
    );
  }
  if (typeof value === "object") {
    return (
      <div className="max-h-44 overflow-auto font-mono text-[10px] leading-4 text-emerald-200/60">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => <JsonBranch key={key} label={key} value={item} />)}
      </div>
    );
  }
  return <span className="break-words font-mono text-[10px] text-emerald-200/60">{String(value)}</span>;
}

function JsonBranch({ label, value }: { label: string; value: unknown }) {
  const nested = value !== null && typeof value === "object";
  return (
    <div className="pl-2">
      <span className="text-white/30">{label}: </span>
      {nested ? <JsonTree value={value} /> : <span className="break-words">{String(value)}</span>}
    </div>
  );
}

function DiagnosticsWarnings({ rows }: { rows: Array<{ code: string; message: string; count: number }> }) {
  if (rows.length === 0) return <EmptyLine>no invariant warnings</EmptyLine>;
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {rows.map((row) => (
        <div key={row.code} className="rounded-md border border-amber-300/10 bg-amber-300/[0.035] p-3">
          <div className="font-mono text-xs text-amber-200/70">{row.code}</div>
          <div className="mt-1 text-xs text-white/45">{row.message}</div>
          <div className="mt-2 font-mono text-[10px] text-white/25">{row.count}</div>
        </div>
      ))}
    </div>
  );
}

function RelationshipList({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <div className="rounded-md border border-white/6 bg-white/[0.02] p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-white/25">{title}</div>
      <div className="space-y-1">
        {rows.length === 0 ? <EmptyLine>none</EmptyLine> : rows.map((row, index) => (
          <div key={`${stringifyCell(row.id)}:${index}`} className="font-mono text-[11px]">
            <TaskLink id={stringifyCell(row.id)} title={stringifyCell(row.title)} />
            <span className={cn("ml-2", semanticClass("status", row.status))}>{stringifyCell(row.status)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecordList({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-white/25">{title}</div>
      <SimpleRows columns={rows[0] ? Object.keys(rows[0]) : []} rows={rows} />
    </div>
  );
}

function SimpleRows({ columns, rows }: { columns: string[]; rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <EmptyLine>none</EmptyLine>;
  return (
    <div className="overflow-auto rounded-md border border-white/6">
      <table className="min-w-full border-separate border-spacing-0 text-left font-mono text-[11px]">
        <thead className="bg-white/[0.025]">
          <tr>{columns.map((column) => <th key={column} className="border-b border-white/6 px-2 py-1.5 text-white/35">{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => <td key={column} className="max-w-[320px] border-b border-white/[0.035] px-2 py-1.5 text-white/55"><CellInline column={column} value={row[column]} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellInline({ column, value }: { column: string; value: unknown }) {
  const text = stringifyCell(value);
  if (typeof value === "string" && /^[A-Z]+-\d+$/i.test(value)) return <TaskLink id={value} />;
  return <span className={cn("break-words", semanticClass(column, value))}>{text || "null"}</span>;
}

function TaskLink({ id, title }: { id: string; title?: string | null }) {
  return (
    <a href={`/tasks?taskId=${encodeURIComponent(id)}`} className="break-words text-cyan-300/75 hover:text-cyan-200">
      {id}{title ? <span className="ml-1 text-white/28">{title}</span> : null}
    </a>
  );
}

function CenteredSpinner() {
  return (
    <div className="flex h-full items-center justify-center bg-[#0a0a0a]">
      <WaveSpinner size="sm" color="primary" animation="ripple" />
    </div>
  );
}

function CenteredText({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <div className={cn("flex h-full items-center justify-center bg-[#0a0a0a] px-6 text-xs", tone === "error" ? "text-red-400/70" : "text-white/30")}>{children}</div>;
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md bg-white/[0.02] px-3 py-2 text-[11px] text-white/24">{children}</div>;
}

interface SavedFilter {
  name: string;
  search: string;
  filters: Record<string, string>;
  sort: { column: string; dir: "asc" | "desc" } | null;
  pageSize: number;
}

interface RowDiff {
  column: string;
  a: string;
  b: string;
}

function diffRows(a: Record<string, unknown>, b: Record<string, unknown>): RowDiff[] {
  const columns = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  return columns
    .map((column) => ({ column, a: stringifyCell(a[column]), b: stringifyCell(b[column]) }))
    .filter((item) => item.a !== item.b);
}

function parseJsonish(value: unknown): unknown | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDetailValue(value: unknown): string {
  const json = parseJsonish(value);
  if (json) return JSON.stringify(json, null, 2);
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function isTaskIdColumn(table: string, column: string, value: string): boolean {
  if (!/^[A-Z]+-\d+$/i.test(value)) return false;
  if (table === "tasks" && column === "id") return true;
  return ["task_id", "parent_id", "depends_on_id"].includes(column);
}

function semanticClass(column: string, value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (column === "status") {
    if (text === "closed" || text === "complete") return "text-emerald-300/70";
    if (text === "blocked" || text === "failed") return "text-red-300/70";
    if (text === "in_progress" || text === "running") return "text-cyan-300/70";
    if (text === "open") return "text-amber-200/70";
  }
  if (column === "closed_at" && text) return "text-emerald-200/60";
  if (column === "priority") {
    if (/high|urgent|p0|p1|^0$|^1$/i.test(text)) return "text-red-300/70";
    if (/medium|p2|^2$/i.test(text)) return "text-amber-200/70";
    if (/low|p3|p4|^[3-9]$/i.test(text)) return "text-white/40";
  }
  if (column === "issue_type") return "text-violet-200/65";
  return "";
}

function rowsToCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const escape = (value: unknown) => {
    const text = stringifyCell(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    columns.map(escape).join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n");
}
