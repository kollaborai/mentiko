"use client";

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { GoalCard } from "@/components/ui/goal-card";
import { Badge } from "@/components/ui/badge";
import { TrendUpFilled, ChartFilled, ChartFilled as BarChart3, RefreshFilled, ClockFilled as Clock, TickCircleFilled as CheckCircle, Star1Filled as Coins } from "@aliimam/icons";
import { BotMessageSquare as Bot, ArrowRight2Filled, ArrowDown2Filled, ArrowUp2Filled, ArrowSwapFilled, SearchNormal1Filled } from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { StatusBadge, type Status } from "@/components/common/status-badge";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";

interface TokenCounts {
  total_input: number;
  total_output: number;
  total: number;
  by_model: Record<string, { input: number; output: number; total: number }>;
}

interface Snapshot {
  label: string;
  timestamp: string;
  epoch: number;
  memory_mb: number;
  cpu_pct: number;
}

interface ApiCall {
  model: string;
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  duration_ms: number;
}

interface AgentProfile {
  session: string;
  agent_id: string;
  agent_name: string;
  run_id?: string;
  started_at: string;
  start_epoch: number;
  ended_at?: string;
  end_epoch?: number;
  duration_ms?: number;
  status: Status;
  error?: string;
  snapshots: Snapshot[];
  api_calls: ApiCall[];
  tokens: TokenCounts;
  memory_samples: number[];
  peak_memory_mb: number;
  cpu_samples: number[];
  avg_cpu_pct: number;
}

interface ProfilesResponse {
  profiles: AgentProfile[];
}

async function fetchProfiles(fetcher: (url: string, init?: RequestInit) => Promise<Response>): Promise<AgentProfile[]> {
  try {
    const res = await fetcher("/api/profiles", { cache: "no-store" });
    if (!res.ok) return [];
    const data: ProfilesResponse = await res.json();
    return data.profiles || [];
  } catch {
    return [];
  }
}

// duration_ms in profile JSON is actually nanoseconds (date +%s%N difference)
function nsToMs(ns: number): number {
  return ns / 1_000_000;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

// compact "time since" for the Started column; absolute timestamp lives in the title attr
function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function MiniSparkLine({ data, max, color }: { data: number[]; max: number; color: string }) {
  if (data.length === 0) return null;

  const width = 60;
  const height = 20;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * (width - padding * 2);
    const y = height - padding - (v / (max || 1)) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="inline-block ml-2">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricBar({ label, value, max, color, unit }: {
  label: string;
  value: number;
  max: number;
  color: string;
  unit: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-foreground/60 truncate">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-16 text-right font-mono text-foreground/80">
        {value.toLocaleString()} {unit}
      </span>
    </div>
  );
}

function TokenBreakdown({ tokens }: { tokens: TokenCounts }) {
  const models = Object.entries(tokens.by_model)
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.total - a.total);

  if (models.length === 0) return null;

  const maxModel = models[0].total;

  return (
    <div className="space-y-1">
      {models.map((m) => (
        <div key={m.model} className="flex items-center gap-2 text-[10px]">
          <span className="w-20 truncate text-foreground/50">{m.model}</span>
          <div className="flex-1 h-1.5 bg-muted rounded overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded"
              style={{ width: `${(m.total / maxModel) * 100}%` }}
            />
          </div>
          <span className="w-16 text-right font-mono text-foreground/60">
            {formatTokens(m.total)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Expanded detail for a single profile row — the full metric breakdown.
function ProfileDetail({ profile }: { profile: AgentProfile }) {
  return (
    <div className="space-y-3">
      {/* status and timing */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] text-foreground/40 mb-1">Status</p>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={profile.status} size="sm" />
            <span className="text-xs text-foreground/60">{profile.status}</span>
          </div>
        </div>
        {profile.duration_ms !== undefined && (
          <div>
            <p className="text-[10px] text-foreground/40 mb-1">Duration</p>
            <p className="text-xs font-mono text-foreground/60">
              {formatDuration(nsToMs(profile.duration_ms))}
            </p>
          </div>
        )}
      </div>

      {/* error if any */}
      {profile.error && (
        <div className="p-2 bg-accent rounded">
          <p className="text-[10px] text-foreground/60">{profile.error}</p>
        </div>
      )}

      {/* metrics bars */}
      {profile.duration_ms !== undefined && profile.duration_ms > 0 && (
        <div>
          <p className="text-[10px] text-foreground/40 mb-2">Execution</p>
          <MetricBar
            label="duration"
            value={nsToMs(profile.duration_ms) / 1000}
            max={300}
            color="#3b82f6"
            unit="s"
          />
        </div>
      )}

      {profile.tokens.total > 0 && (
        <div>
          <p className="text-[10px] text-foreground/40 mb-2">Tokens</p>
          <MetricBar
            label="input"
            value={profile.tokens.total_input}
            max={profile.tokens.total}
            color="#22c55e"
            unit=""
          />
          <MetricBar
            label="output"
            value={profile.tokens.total_output}
            max={profile.tokens.total}
            color="#60a5fa"
            unit=""
          />
          <div className="mt-2">
            <p className="text-[10px] text-foreground/40 mb-1">By Model</p>
            <TokenBreakdown tokens={profile.tokens} />
          </div>
        </div>
      )}

      {profile.peak_memory_mb > 0 && (
        <div>
          <p className="text-[10px] text-foreground/40 mb-2">Memory</p>
          <MetricBar
            label="peak"
            value={profile.peak_memory_mb}
            max={4096}
            color="#8b5cf6"
            unit="MB"
          />
          {profile.memory_samples.length > 1 && (
            <div className="mt-1 flex items-center text-[10px] text-foreground/50">
              <span>samples: </span>
              <MiniSparkLine
                data={profile.memory_samples}
                max={profile.peak_memory_mb}
                color="#8b5cf6"
              />
              <span className="ml-1">({profile.memory_samples.length})</span>
            </div>
          )}
        </div>
      )}

      {profile.avg_cpu_pct > 0 && (
        <div>
          <p className="text-[10px] text-foreground/40 mb-2">CPU</p>
          <MetricBar
            label="average"
            value={profile.avg_cpu_pct}
            max={100}
            color="#06b6d4"
            unit="%"
          />
          {profile.cpu_samples.length > 1 && (
            <div className="mt-1 flex items-center text-[10px] text-foreground/50">
              <span>samples: </span>
              <MiniSparkLine
                data={profile.cpu_samples}
                max={100}
                color="#06b6d4"
              />
              <span className="ml-1">({profile.cpu_samples.length})</span>
            </div>
          )}
        </div>
      )}

      {/* api calls */}
      {profile.api_calls.length > 0 && (
        <div>
          <p className="text-[10px] text-foreground/40 mb-1">
            api calls ({profile.api_calls.length})
          </p>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {profile.api_calls.map((call, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[10px] bg-muted rounded px-2 py-1"
              >
                <span className="w-20 truncate text-foreground/50">{call.model}</span>
                <span className="font-mono text-foreground/60">
                  {formatTokens(call.total_tokens)}
                </span>
                <span className="text-foreground/30 ml-auto">
                  {call.duration_ms}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* timestamps */}
      <div className="grid grid-cols-2 gap-2 text-[10px] text-foreground/40 font-mono">
        <div>
          <p className="mb-0.5">Started</p>
          <p className="text-foreground/60">{profile.started_at}</p>
        </div>
        {profile.ended_at && (
          <div>
            <p className="mb-0.5">Ended</p>
            <p className="text-foreground/60">{profile.ended_at}</p>
          </div>
        )}
      </div>

      {profile.run_id && (
        <div>
          <p className="text-[10px] text-foreground/40 mb-1">Run ID</p>
          <Badge variant="ghost" className="text-[10px] font-mono bg-muted">
            {profile.run_id}
          </Badge>
        </div>
      )}
    </div>
  );
}

function ComparisonChart({ profiles }: { profiles: AgentProfile[] }) {
  const completed = profiles.filter(p => p.duration_ms !== undefined);

  if (completed.length === 0) return null;

  const maxDuration = Math.max(...completed.map(p => p.duration_ms || 0));
  const maxTokens = Math.max(...completed.map(p => p.tokens.total));
  const maxMemory = Math.max(...completed.map(p => p.peak_memory_mb));

  return (
    <div className="bg-muted rounded-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="h-4 w-4 text-foreground/60" />
        <span className="text-sm font-medium">Comparison</span>
      </div>

      <div className="space-y-3">
        {completed.slice(0, 10).map((profile) => (
          <div key={profile.session} className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-24 truncate font-medium">{profile.agent_name}</span>
              <StatusBadge status={profile.status} size="sm" />
            </div>

            {profile.duration_ms !== undefined && (
              <MetricBar
                label=""
                value={nsToMs(profile.duration_ms) / 1000}
                max={nsToMs(maxDuration) / 1000}
                color="#3b82f6"
                unit="s"
              />
            )}

            {profile.tokens.total > 0 && (
              <MetricBar
                label=""
                value={profile.tokens.total}
                max={maxTokens}
                color="#a855f7"
                unit="tok"
              />
            )}

            {profile.peak_memory_mb > 0 && (
              <MetricBar
                label=""
                value={profile.peak_memory_mb}
                max={maxMemory || 1}
                color="#06b6d4"
                unit="MB"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AggregateStats({ profiles }: { profiles: AgentProfile[] }) {
  const completed = profiles.filter(p => p.status === "completed");

  const totalDuration = completed.reduce((sum, p) => sum + (p.duration_ms || 0), 0);
  const totalTokens = completed.reduce((sum, p) => sum + p.tokens.total, 0);
  const totalCalls = completed.reduce((sum, p) => sum + p.api_calls.length, 0);
  const avgDuration = completed.length > 0 ? totalDuration / completed.length : 0;
  const avgTokens = completed.length > 0 ? totalTokens / completed.length : 0;

  const stats = [
    { label: "total profiles", value: profiles.length, icon: Bot },
    { label: "completed", value: completed.length, icon: CheckCircle },
    { label: "total duration", value: formatDuration(nsToMs(totalDuration)), icon: Clock },
    { label: "total tokens", value: formatTokens(totalTokens), icon: Coins },
    { label: "api calls", value: totalCalls, icon: TrendUpFilled },
    { label: "avg duration", value: formatDuration(nsToMs(avgDuration)), icon: Clock },
    { label: "avg tokens", value: formatTokens(Math.round(avgTokens)), icon: Coins },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat, i) => {
        const Icon = stat.icon;
        return (
          <GoalCard
            key={i}
            id={`stat-${i}`}
            title={stat.label}
            description={String(stat.value)}
            icon={<Icon className="h-4 w-4 text-foreground/60" />}
            status="completed"
          />
        );
      })}
    </div>
  );
}

type SortKey = "agent" | "status" | "started" | "duration" | "tokens" | "memory" | "cpu" | "calls";
type SortDir = "asc" | "desc";

function sortValue(p: AgentProfile, key: SortKey): number | string {
  switch (key) {
    case "agent": return (p.agent_name || "").toLowerCase();
    case "status": return p.status || "";
    case "started": return p.start_epoch || 0;
    case "duration": return p.duration_ms ?? -1;
    case "tokens": return p.tokens.total || 0;
    case "memory": return p.peak_memory_mb || 0;
    case "cpu": return p.avg_cpu_pct || 0;
    case "calls": return p.api_calls.length;
  }
}

function SortHeader({ label, sortKey, active, dir, align, onSort }: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  align?: "right";
  onSort: (k: SortKey) => void;
}) {
  const Icon = !active ? ArrowSwapFilled : dir === "asc" ? ArrowUp2Filled : ArrowDown2Filled;
  return (
    <th className={`p-2 text-[10px] font-normal ${active ? "text-foreground/70" : "text-foreground/40"} ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        <Icon className={`h-2.5 w-2.5 ${active ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function ProfilesTable({ profiles }: { profiles: AgentProfile[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("started");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openSession, setOpenSession] = useState<string | null>(null);

  const onSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // text columns read better ascending; metrics/time default to descending
      setSortDir(k === "agent" || k === "status" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...profiles].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (typeof va === "string" || typeof vb === "string") {
        return factor * String(va).localeCompare(String(vb));
      }
      return factor * (va - vb);
    });
  }, [profiles, sortKey, sortDir]);

  if (profiles.length === 0) {
    return (
      <div className="bg-muted rounded-md p-8 text-center">
        <p className="text-sm text-foreground/40">No runs match your filters</p>
        <p className="text-xs text-foreground/30 mt-1">try a different status or clear the search</p>
      </div>
    );
  }

  return (
    <div className="bg-muted rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-foreground/10">
              <th className="w-7" />
              <SortHeader label="Agent" sortKey="agent" active={sortKey === "agent"} dir={sortDir} onSort={onSort} />
              <SortHeader label="Status" sortKey="status" active={sortKey === "status"} dir={sortDir} onSort={onSort} />
              <SortHeader label="Started" sortKey="started" active={sortKey === "started"} dir={sortDir} onSort={onSort} />
              <SortHeader label="Duration" sortKey="duration" active={sortKey === "duration"} dir={sortDir} align="right" onSort={onSort} />
              <SortHeader label="Tokens" sortKey="tokens" active={sortKey === "tokens"} dir={sortDir} align="right" onSort={onSort} />
              <SortHeader label="Peak Mem" sortKey="memory" active={sortKey === "memory"} dir={sortDir} align="right" onSort={onSort} />
              <SortHeader label="CPU" sortKey="cpu" active={sortKey === "cpu"} dir={sortDir} align="right" onSort={onSort} />
              <SortHeader label="Calls" sortKey="calls" active={sortKey === "calls"} dir={sortDir} align="right" onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const isOpen = openSession === p.session;
              const Caret = isOpen ? ArrowDown2Filled : ArrowRight2Filled;
              return (
                <Fragment key={p.session}>
                  <tr
                    onClick={() => setOpenSession(isOpen ? null : p.session)}
                    className={`cursor-pointer border-b border-foreground/5 hover:bg-accent transition-colors ${isOpen ? "bg-accent" : ""}`}
                  >
                    <td className="pl-2 align-top pt-2.5">
                      <Caret className="h-3 w-3 text-foreground/40" />
                    </td>
                    <td className="p-2">
                      <div className="font-medium text-foreground/90 truncate max-w-[200px]">{p.agent_name}</div>
                      <div className="text-[10px] text-foreground/40 font-mono truncate max-w-[200px]">{p.run_id || p.session}</div>
                    </td>
                    <td className="p-2"><StatusBadge status={p.status} size="sm" /></td>
                    <td className="p-2 text-foreground/60 whitespace-nowrap" title={p.started_at}>{formatRelative(p.started_at)}</td>
                    <td className="p-2 text-right font-mono text-foreground/60 whitespace-nowrap">{p.duration_ms !== undefined ? formatDuration(nsToMs(p.duration_ms)) : "—"}</td>
                    <td className="p-2 text-right font-mono text-foreground/60">{p.tokens.total > 0 ? formatTokens(p.tokens.total) : "—"}</td>
                    <td className="p-2 text-right font-mono text-foreground/60 whitespace-nowrap">{p.peak_memory_mb > 0 ? `${p.peak_memory_mb}MB` : "—"}</td>
                    <td className="p-2 text-right font-mono text-foreground/60">{p.avg_cpu_pct > 0 ? `${p.avg_cpu_pct.toFixed(0)}%` : "—"}</td>
                    <td className="p-2 text-right font-mono text-foreground/60">{p.api_calls.length || "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-foreground/5">
                      <td colSpan={9} className="bg-card px-4 py-3">
                        <ProfileDetail profile={p} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FILTERS = ["all", "running", "completed", "failed"] as const;
type Filter = (typeof FILTERS)[number];

export default function ProfilesPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const loadProfiles = useCallback(async () => {
    queueMicrotask(() => setLoading(true));
    const data = await fetchProfiles(fetchWithNamespace);
    setProfiles(data);
    setLoading(false);
  }, [fetchWithNamespace]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfiles();
  }, [loadProfiles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      const statusOk =
        filter === "all" ? true :
        filter === "failed" ? (p.status === "failed" || p.status === "error") :
        p.status === filter;
      if (!statusOk) return false;
      if (!q) return true;
      return (
        (p.agent_name || "").toLowerCase().includes(q) ||
        (p.session || "").toLowerCase().includes(q) ||
        (p.run_id || "").toLowerCase().includes(q)
      );
    });
  }, [profiles, filter, search]);

  return (
    <div>
      <PageBanner
        title="Performance"
        subtitle="Agent execution profiles, token consumption, memory and CPU usage across runs."
        icon={TrendUpFilled}
        sectionColor="#a0927b"
        actions={[
          { label: "Metrics", href: "/settings/metrics", icon: ChartFilled, iconColor: "#a0927b" },
          { label: "Refresh", icon: RefreshFilled, iconColor: "#a0927b", onClick: loadProfiles },
        ]}
      />
      <div className="px-4 py-3 max-w-6xl mx-auto">

      {/* filter tabs + search */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? "bg-muted text-foreground"
                : "text-foreground/50 hover:text-foreground hover:bg-muted"
            }`}
          >
            {f}
          </button>
        ))}
        <div className="relative ml-auto">
          <SearchNormal1Filled className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-foreground/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by agent, run, session…"
            className="w-56 pl-7 pr-2 py-1.5 rounded-md text-xs bg-muted text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-foreground/20"
          />
        </div>
        <div className="text-xs text-foreground/40 whitespace-nowrap">
          {filtered.length} of {profiles.length}
        </div>
      </div>

      {loading && profiles.length === 0 ? (
        <div className="bg-muted rounded-md p-8 text-center">
          <p className="text-sm text-foreground/40">loading profiles...</p>
        </div>
      ) : profiles.length === 0 ? (
        <div className="bg-muted rounded-md p-8 text-center">
          <p className="text-sm text-foreground/40">No profiles yet</p>
          <p className="text-xs text-foreground/30 mt-1">
            profiles are created when agents run
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* aggregate stats */}
          <AggregateStats profiles={profiles} />

          {/* comparison chart */}
          <ComparisonChart profiles={profiles} />

          {/* runs table */}
          <div>
            <h2 className="text-sm font-medium mb-3">Runs</h2>
            <ProfilesTable profiles={filtered} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
