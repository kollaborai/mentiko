"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api/api-client";
import { useEditorStore } from "@/lib/ui/editor-store";
import { cn } from "@/lib/utils";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import {
  ArrowDown1Filled,
  DocumentFilled,
  FolderFilled,
  FolderOpenFilled,
  Refresh2Filled,
} from "@aliimam/icons";

interface DbColumn {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt_value: unknown;
}

interface DbTable {
  name: string;
  type: "table" | "view";
  schema: string;
  columns: DbColumn[];
  indexes: Array<{ name: string; unique: boolean; origin: string; partial: boolean; columns: string[]; schema: string }>;
  rowCount: number | null;
}

interface DbOverview {
  namespaceId: string;
  dbPath: string;
  tables: DbTable[];
}

function tableLabel(table: DbTable): string {
  const count = table.rowCount === null ? "?" : String(table.rowCount);
  return `${table.name}  ${count}`;
}

export function TasksDbPanel() {
  const [overview, setOverview] = useState<DbOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["tables", "analysis", "schema", "indexes"]));
  const activePaneId = useEditorStore((s) => s.activePaneId);
  const openView = useEditorStore((s) => s.openView);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/code/tasks-db");
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getApiErrorMessage(raw, "failed to load tasks.db"));
      setOverview(unwrapApiData<DbOverview>(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load tasks.db");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const tables = overview?.tables.filter((table) => table.type === "table") ?? [];
    const views = overview?.tables.filter((table) => table.type === "view") ?? [];
    return { tables, views };
  }, [overview]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openTable = useCallback((table: DbTable) => {
    openView(activePaneId, `tasks-db://table/${encodeURIComponent(table.name)}`, table.name, {
      type: "tasks-db",
      mode: "table",
      table: table.name,
    });
  }, [activePaneId, openView]);

  const openSchema = useCallback((table: DbTable) => {
    openView(activePaneId, `tasks-db://schema/${encodeURIComponent(table.name)}`, `${table.name}.sql`, {
      type: "tasks-db",
      mode: "schema",
      table: table.name,
    });
  }, [activePaneId, openView]);

  const openMode = useCallback((mode: "recent" | "graph" | "dependencies" | "diagnostics" | "select", name: string) => {
    openView(activePaneId, `tasks-db://${mode}`, name, {
      type: "tasks-db",
      mode,
      table: mode === "recent" ? "tasks" : undefined,
    });
  }, [activePaneId, openView]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <WaveSpinner size="sm" color="muted" animation="ripple" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-[11px] text-red-400/70">
        {error}
      </div>
    );
  }

  if (!overview) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-mono uppercase tracking-wider text-white/35">
            tasks.db
          </div>
          <div className="truncate text-[9px] font-mono text-white/18">
            {overview.namespaceId}
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          title="Refresh"
          className="flex h-6 w-6 items-center justify-center rounded-md text-white/25 transition-colors hover:bg-white/5 hover:text-white/60"
        >
          <Refresh2Filled className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <DbFolder
          id="tables"
          label="tables"
          count={grouped.tables.length}
          expanded={expanded.has("tables")}
          onToggle={() => toggle("tables")}
        >
          {grouped.tables.map((table) => (
            <DbRow
              key={table.name}
              label={tableLabel(table)}
              title={table.name}
              onClick={() => openTable(table)}
            />
          ))}
        </DbFolder>

        {grouped.views.length > 0 && (
          <DbFolder
            id="views"
            label="views"
            count={grouped.views.length}
            expanded={expanded.has("views")}
            onToggle={() => toggle("views")}
          >
            {grouped.views.map((table) => (
              <DbRow
                key={table.name}
                label={tableLabel(table)}
                title={table.name}
                onClick={() => openTable(table)}
              />
            ))}
          </DbFolder>
        )}

        <DbFolder
          id="analysis"
          label="analysis"
          count={5}
          expanded={expanded.has("analysis")}
          onToggle={() => toggle("analysis")}
        >
          <DbRow label="recent changes" title="tasks updated_at desc" onClick={() => openMode("recent", "recent changes")} />
          <DbRow label="relationship graph" title="tasks parent and dependency graph" onClick={() => openMode("graph", "relationship graph")} />
          <DbRow label="dependencies" title="blocked by and blocks browser" onClick={() => openMode("dependencies", "dependencies")} />
          <DbRow label="invariants" title="orphan, duplicate, and task-store checks" onClick={() => openMode("diagnostics", "invariants")} />
          <DbRow label="select" title="read-only SELECT console" onClick={() => openMode("select", "select")} />
        </DbFolder>

        <DbFolder
          id="schema"
          label="schema"
          count={overview.tables.length}
          expanded={expanded.has("schema")}
          onToggle={() => toggle("schema")}
        >
          {overview.tables.map((table) => (
            <DbFolder
              key={table.name}
              id={`schema:${table.name}`}
              label={`${table.name}.sql`}
              count={table.columns.length}
              expanded={expanded.has(`schema:${table.name}`)}
              onToggle={() => toggle(`schema:${table.name}`)}
            >
              <DbRow
                label="create table"
                title={`${table.name} schema`}
                onClick={() => openSchema(table)}
              />
              {table.columns.map((column) => (
                <DbMetaRow
                  key={column.name}
                  label={column.name}
                  meta={[
                    column.type || "any",
                    column.pk ? "pk" : "",
                    column.notnull ? "not null" : "",
                  ].filter(Boolean).join(" ")}
                />
              ))}
            </DbFolder>
          ))}
        </DbFolder>

        <DbFolder
          id="indexes"
          label="indexes"
          count={overview.tables.reduce((sum, table) => sum + table.indexes.length, 0)}
          expanded={expanded.has("indexes")}
          onToggle={() => toggle("indexes")}
        >
          {overview.tables.map((table) => (
            <DbFolder
              key={table.name}
              id={`indexes:${table.name}`}
              label={table.name}
              count={table.indexes.length}
              expanded={expanded.has(`indexes:${table.name}`)}
              onToggle={() => toggle(`indexes:${table.name}`)}
            >
              {table.indexes.length === 0 ? (
                <DbMetaRow label="no indexes" meta="" />
              ) : table.indexes.map((index) => (
                <DbMetaRow
                  key={index.name}
                  label={index.name}
                  meta={[
                    index.unique ? "unique" : "",
                    index.columns.join(", "),
                  ].filter(Boolean).join(" ")}
                />
              ))}
            </DbFolder>
          ))}
        </DbFolder>
      </div>
    </div>
  );
}

function DbMetaRow({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[10px] text-white/28">
      <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
      {meta && <span className="truncate font-mono text-white/16">{meta}</span>}
    </div>
  );
}

function DbFolder({
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/70"
      >
        <ArrowDown1Filled className={cn("h-3 w-3 transition-transform", !expanded && "-rotate-90")} />
        {expanded ? (
          <FolderOpenFilled className="h-3.5 w-3.5 text-cyan-400/70" />
        ) : (
          <FolderFilled className="h-3.5 w-3.5 text-cyan-400/50" />
        )}
        <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
        <span className="font-mono text-[9px] text-white/20">{count}</span>
      </button>
      {expanded && <div className="ml-4 mt-0.5 space-y-px">{children}</div>}
    </div>
  );
}

function DbRow({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/75"
    >
      <DocumentFilled className="h-3.5 w-3.5 shrink-0 text-white/25" />
      <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
    </button>
  );
}
