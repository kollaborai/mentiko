"use client";

import { useState, useEffect, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowDown2Filled,
  ArrowRight2Filled,
  BotMessageSquare,
  DataFilled,
  DocumentTextFilled,
  ActivityFilled,
  ClockFilled,
  RefreshFilled,
  SearchNormalFilled,
  ArrowLeft2Filled,
} from "@aliimam/icons";

interface VariableValue {
  value: unknown;
  type: "string" | "number" | "boolean" | "object" | "array" | "null";
  updated_at: string;
  source: string;
}

interface VariableScope {
  global: Record<string, VariableValue>;
  chain: Record<string, VariableValue>;
  agent: Record<string, VariableValue>;
}

interface CurrentAgentInfo {
  id: string;
  name: string;
  role: string;
  session: string;
  started_at: string;
  status: "running" | "waiting" | "error";
}

interface OutputEntry {
  timestamp: string;
  source: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

interface PendingEvent {
  id: string;
  type: string;
  source: string;
  target: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface StateSnapshot {
  timestamp: string;
  run_id: string;
  chain_id: string;
  status: "running" | "paused" | "idle";
  current_agent: CurrentAgentInfo | null;
  variables: VariableScope;
  recent_output: OutputEntry[];
  pending_events: PendingEvent[];
}

interface StateInspectorProps {
  chainId: string;
  paused: boolean;
  onRefresh?: () => void;
}

interface SectionState {
  agent: boolean;
  global: boolean;
  chain: boolean;
  agentVars: boolean;
  output: boolean;
  events: boolean;
}

export function StateInspector({ chainId, paused, onRefresh }: StateInspectorProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<SectionState>({
    agent: true,
    global: true,
    chain: true,
    agentVars: true,
    output: true,
    events: true,
  });
  const [outputPage, setOutputPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const OUTPUT_PER_PAGE = 5;

  const fetchState = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}/debug/state`);
      if (!res.ok) throw new Error(await res.text());
      const raw = await res.json();
      const data = unwrapApiData<StateSnapshot>(raw);
      setState(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [chainId, fetchWithNamespace]);

  useEffect(() => {
    fetchState();
  }, [chainId, fetchState]);

  useEffect(() => {
    if (!paused) return;
    const interval = setInterval(fetchState, 3000);
    return () => clearInterval(interval);
  }, [paused, fetchState]);

  const handleRefresh = () => {
    fetchState();
    onRefresh?.();
  };

  const toggleSection = (section: keyof SectionState) => {
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const formatValue = (val: VariableValue): string => {
    const { value, type } = val;
    if (type === "null") return "null";
    if (type === "string") return `"${value}"`;
    if (type === "array") return `Array(${(value as unknown[]).length})`;
    if (type === "object") return `{${Object.keys(value as Record<string, unknown>).length} keys}`;
    return String(value);
  };

  const expandable = (val: VariableValue) => val.type === "object" || val.type === "array";

  const renderVariable = (name: string, val: VariableValue, depth = 0) => {
    const matchesSearch = !searchQuery || name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch && depth === 0) return null;

    return (
      <div key={name} className={depth > 0 ? "ml-4" : ""}>
        <div className="flex items-center gap-2 py-1">
          {expandable(val) && (
            <button
              onClick={() => {}}
              className="text-foreground/30 hover:text-foreground/60"
            >
              <ArrowRight2Filled className="h-3 w-3" />
            </button>
          )}
          <span className="text-[10px] font-mono text-blue-400">{name}</span>
          <span className="text-[9px] text-foreground/30">:</span>
          <span className="text-[10px] font-mono text-foreground/60">{formatValue(val)}</span>
          <Badge variant="outline" className="text-[8px] px-1 ml-auto">
            {val.type}
          </Badge>
        </div>
      </div>
    );
  };

  const renderVariables = (vars: Record<string, VariableValue>, title: string, icon: React.ReactNode, sectionKey: keyof SectionState) => {
    const entries = Object.entries(vars);
    if (entries.length === 0) return null;

    return (
      <div className="mb-3">
        <button
          onClick={() => toggleSection(sectionKey)}
          className="flex items-center gap-2 w-full text-left mb-2"
        >
          {expanded[sectionKey] ? (
            <ArrowDown2Filled className="h-3 w-3 text-foreground/40" />
          ) : (
            <ArrowRight2Filled className="h-3 w-3 text-foreground/40" />
          )}
          {icon}
          <span className="text-[10px] text-foreground/40 uppercase tracking-wide">{title}</span>
          <Badge variant="outline" className="text-[8px]">
            {entries.length}
          </Badge>
        </button>
        {expanded[sectionKey] && (
          <div className="ml-4 bg-muted/20 rounded p-2">
            {entries.map(([name, val]) => renderVariable(name, val))}
          </div>
        )}
      </div>
    );
  };

  const filteredOutput = state?.recent_output.filter(
    (e) => !searchQuery || e.message.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const paginatedOutput = filteredOutput.slice(
    outputPage * OUTPUT_PER_PAGE,
    (outputPage + 1) * OUTPUT_PER_PAGE
  );

  const levelColors: Record<string, string> = {
    info: "text-blue-400",
    warn: "text-amber-400",
    error: "text-red-400",
    debug: "text-foreground/40",
  };

  return (
    <div className="bg-background dark:bg-[#0a0a0a]">
      <div className="mx-3 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DataFilled className="h-3 w-3 text-foreground/40" />
          <span className="text-[10px] uppercase tracking-wide text-foreground/40">state inspector</span>
          {state && (
            <Badge
              variant="outline"
              className={`text-[9px] ${
                state.status === "running"
                  ? "bg-green-500/10 text-green-400 border-green-500/20"
                  : state.status === "paused"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-muted/5 text-foreground/30"
              }`}
            >
              {state.status}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          disabled={loading}
          className="h-7 px-2"
        >
          <RefreshFilled className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-red-500/10 text-red-400 text-[10px]">
          {error}
        </div>
      )}

      <div className="p-3 space-y-4 max-h-[600px] overflow-y-auto">
        {!state ? (
          <p className="text-[10px] text-foreground/30 italic">
            {loading ? "loading state..." : "no state available"}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[9px] text-foreground/30">
              <ClockFilled className="h-2.5 w-2.5" />
              updated: {new Date(state.timestamp).toLocaleTimeString()}
            </div>

            <div className="relative">
              <SearchNormalFilled className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-foreground/30" />
              <input
                type="text"
                placeholder="filter variables..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 bg-muted/5 border border-border rounded text-[10px] focus:outline-none focus:border-foreground/20"
              />
            </div>

            {renderVariables(state.variables.global, "global", <ActivityFilled className="h-3 w-3" />, "global")}
            {renderVariables(state.variables.chain, "chain", <DocumentTextFilled className="h-3 w-3" />, "chain")}
            {renderVariables(state.variables.agent, "agent vars", <BotMessageSquare className="h-3 w-3" />, "agentVars")}

            <div>
              <button
                onClick={() => toggleSection("output")}
                className="flex items-center gap-2 w-full text-left mb-2"
              >
                {expanded.output ? (
                  <ArrowDown2Filled className="h-3 w-3 text-foreground/40" />
                ) : (
                  <ArrowRight2Filled className="h-3 w-3 text-foreground/40" />
                )}
                <ActivityFilled className="h-3 w-3 text-foreground/40" />
                <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                  recent output
                </span>
                <Badge variant="outline" className="text-[8px]">
                  {filteredOutput.length}
                </Badge>
              </button>
              {expanded.output && (
                <div className="bg-muted/20 rounded p-2 space-y-1">
                  {paginatedOutput.length === 0 ? (
                    <p className="text-[10px] text-foreground/30 italic">no output</p>
                  ) : (
                    paginatedOutput.map((entry, idx) => (
                      <div key={idx} className="text-[9px] font-mono">
                        <span className="text-foreground/30">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="ml-2 text-foreground/40">[{entry.source}]</span>
                        <span className={`ml-2 ${levelColors[entry.level]}`}>
                          {entry.level.toUpperCase()}
                        </span>
                        <p className="text-foreground/60 mt-0.5 whitespace-pre-wrap">
                          {entry.message.slice(0, 200)}
                          {entry.message.length > 200 && "..."}
                        </p>
                      </div>
                    ))
                  )}
                  {filteredOutput.length > OUTPUT_PER_PAGE && (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOutputPage((p) => Math.max(0, p - 1))}
                        disabled={outputPage === 0}
                        className="h-6 px-2 text-[9px]"
                      >
                        <ArrowLeft2Filled className="h-3 w-3" />
                      </Button>
                      <span className="text-[9px] text-foreground/40">
                        {outputPage + 1} / {Math.ceil(filteredOutput.length / OUTPUT_PER_PAGE)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOutputPage((p) => p + 1)}
                        disabled={(outputPage + 1) * OUTPUT_PER_PAGE >= filteredOutput.length}
                        className="h-6 px-2 text-[9px]"
                      >
                        <ArrowRight2Filled className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <button
                onClick={() => toggleSection("events")}
                className="flex items-center gap-2 w-full text-left mb-2"
              >
                {expanded.events ? (
                  <ArrowDown2Filled className="h-3 w-3 text-foreground/40" />
                ) : (
                  <ArrowRight2Filled className="h-3 w-3 text-foreground/40" />
                )}
                <ActivityFilled className="h-3 w-3 text-foreground/40" />
                <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                  pending events
                </span>
                <Badge variant="outline" className="text-[8px]">
                  {state.pending_events.length}
                </Badge>
              </button>
              {expanded.events && (
                <div className="bg-muted/20 rounded p-2 space-y-1">
                  {state.pending_events.length === 0 ? (
                    <p className="text-[10px] text-foreground/30 italic">no pending events</p>
                  ) : (
                    state.pending_events.map((event) => (
                      <div key={event.id} className="text-[9px] border-l-2 border-amber-500/30 pl-2">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400 font-mono">{event.type}</span>
                          <span className="text-foreground/30">
                            {event.source} → {event.target}
                          </span>
                        </div>
                        <pre className="text-[8px] text-foreground/40 mt-1 overflow-x-auto">
                          {JSON.stringify(event.payload, null, 1)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {state.current_agent && (
              <div className="mt-4 p-2 bg-green-500/5 border border-green-500/10 rounded">
                <div className="flex items-center gap-2 mb-1">
                  <BotMessageSquare className="h-3 w-3 text-green-400" />
                  <span className="text-[10px] font-medium text-green-400">
                    {state.current_agent.name}
                  </span>
                  <Badge variant="outline" className="text-[8px] bg-green-500/10 text-green-400 border-green-500/20">
                    active
                  </Badge>
                </div>
                <div className="text-[9px] text-foreground/40">
                  {state.current_agent.role}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
