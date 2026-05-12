"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshFilled, InfoCircleFilled, DangerFilled, FilterFilled, DocumentTextFilled, CommandSquareFilled, Setting2Filled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import type { LogLevel, LogEntry } from "@/lib/system-logger";

const LEVEL_COLORS: Record<LogLevel, string> = {
  error: "text-red-400",
  warn: "text-amber-400",
  info: "text-foreground/50",
};

const LEVEL_BG: Record<LogLevel, string> = {
  error: "bg-red-500/10",
  warn: "bg-amber-500/10",
  info: "",
};

const LEVEL_ICON: Record<LogLevel, React.ComponentType<{ className?: string }>> = {
  error: InfoCircleFilled,
  warn: DangerFilled,
  info: InfoCircleFilled,
};

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = LEVEL_ICON[entry.level];
  return (
    <div
      className={`px-4 py-2 border-b border-border/5 cursor-pointer hover:bg-accent/30 transition-colors ${LEVEL_BG[entry.level]}`}
      onClick={() => entry.detail && setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-3">
        <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${LEVEL_COLORS[entry.level]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-foreground/30 font-mono shrink-0">
              {new Date(entry.ts).toLocaleString()}
            </span>
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-foreground/50 shrink-0">
              {entry.source}
            </span>
            <span className={`text-xs ${LEVEL_COLORS[entry.level]}`}>{entry.message}</span>
          </div>
          {entry.detail && expanded && (
            <pre className="mt-1.5 text-[10px] text-foreground/50 font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-2">
              {entry.detail}
            </pre>
          )}
          {entry.detail && !expanded && (
            <p className="text-[10px] text-foreground/30 mt-0.5 truncate">{entry.detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LogsSettingsPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");
  const [sourceFilter, setSourceFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (sourceFilter) params.set("source", sourceFilter);
      const res = await fetchWithNamespace(`/api/system/logs?${params}`);
      if (res.ok) {
        const data = await res.json() as { logs: LogEntry[] };
        setLogs(data.logs || []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [fetchWithNamespace, levelFilter, sourceFilter]);

  useEffect(() => { load(); }, [load]);

  const sources = Array.from(new Set(logs.map((l) => l.source))).sort();

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  return (
    <div className="flex flex-col h-full">
      <PageBanner
        title="System Logs"
        subtitle={`Runtime log entries from all system components. ${logs.length} entries${errorCount > 0 ? `, ${errorCount} errors` : ""}${warnCount > 0 ? `, ${warnCount} warnings` : ""}.`}
        icon={DocumentTextFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "PTY Sessions", href: "/settings/pty", icon: CommandSquareFilled, iconColor: "#a0927b" },
          { label: "System", href: "/settings/system", icon: Setting2Filled, iconColor: "#a0927b" },
          { label: "Refresh", onClick: load, icon: RefreshFilled },
        ]}
      />
      {/* filters */}
      <div className="px-4 pb-3 border-b border-border/10 shrink-0">
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <FilterFilled className="h-3 w-3 text-foreground/30 shrink-0" />
          {(["all", "error", "warn", "info"] as const).map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(lvl)}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                levelFilter === lvl
                  ? "bg-foreground text-background font-medium"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {lvl}
            </button>
          ))}
          {sources.length > 0 && (
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="px-2 py-0.5 rounded text-[11px] bg-muted text-muted-foreground border-none outline-none"
            >
              <option value="">all sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* log list */}
      <div className="flex-1 overflow-y-auto">
        {loading && logs.length === 0 ? (
          <div className="px-6 py-8 text-xs text-foreground/30">loading...</div>
        ) : logs.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-foreground/30">no log entries</p>
            <p className="text-xs text-foreground/20 mt-1">
              errors and events will appear here as the system runs
            </p>
          </div>
        ) : (
          <div>
            {logs.map((entry, i) => (
              <LogRow key={i} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
