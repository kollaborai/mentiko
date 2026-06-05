"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import {
  RefreshFilled as RefreshCw,
  BotMessageSquare as Bot,
  ClockFilled as Clock,
  TickCircleFilled as CheckCircle2,
  CloseCircleFilled as XCircle,
  InfoCircleFilled as AlertCircle,
  ActivityFilled as Activity,
} from "@aliimam/icons";
import Link from "next/link";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { Badge } from "@/components/ui/badge";

interface RunAgent {
  id: string;
  name?: string;
  status: string;
  session: string;
  started?: string;
  completed?: string;
  agentId?: string; // agent definition ID for preview link
}

/** Derive the actual agent status from data — status field in run.json can be stale */
function deriveAgentStatus(agent: RunAgent, run: Run): AgentStatus {
  // If agent has a completion timestamp, it's done regardless of status field
  if (agent.completed) {
    if (agent.status === "failed" || agent.status === "error") return agent.status;
    return "completed";
  }
  // If the run itself has completed but agent status wasn't updated, derive from run
  if (run.completed && run.status !== "running") {
    return run.status === "failed" ? "failed" : "completed";
  }
  return (agent.status as AgentStatus) || "pending";
}

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  agents: RunAgent[];
  sessions: string[];
}

type AgentStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "error" | "stopped";

function getStatusBadge(status: AgentStatus) {
  switch (status) {
    case "running":
      return (
        <Badge variant="outline" className="text-amber-400 border-amber-400/30">
          <Activity className="h-2.5 w-2.5 mr-1 animate-pulse" />
          running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="text-green-400 border-green-400/30">
          <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
          complete
        </Badge>
      );
    case "failed":
    case "error":
      return (
        <Badge variant="outline" className="text-red-400 border-red-400/30">
          <XCircle className="h-2.5 w-2.5 mr-1" />
          failed
        </Badge>
      );
    case "cancelled":
    case "stopped":
      return (
        <Badge variant="outline" className="text-foreground/40 border-foreground/20">
          cancelled
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-foreground/60 border-foreground/20">
          <AlertCircle className="h-2.5 w-2.5 mr-1" />
          pending
        </Badge>
      );
  }
}

function formatDuration(started: string, completed?: string): string {
  const start = new Date(started).getTime();
  const end = completed ? new Date(completed).getTime() : Date.now();
  const ms = end - start;

  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function AgentsHealthPageContent() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActiveRuns = useCallback(async () => {
    try {
      const res = await fetchWithNamespace("/api/runs?limit=20&status=running");
      const data = unwrapApiData<{ runs?: Run[] }>(await res.json());
      setRuns(data.runs || []);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWithNamespace]);

  useEffect(() => {
    fetchActiveRuns();
    const interval = setInterval(() => fetchActiveRuns(), 5000);
    return () => clearInterval(interval);
  }, [fetchActiveRuns]);

  // flatten all agents from running runs, deriving correct status
  const allAgents: Array<{
    agent: RunAgent;
    run: Run;
    duration: string;
    derivedStatus: AgentStatus;
  }> = [];
  for (const run of runs) {
    for (const agent of run.agents || []) {
      allAgents.push({
        agent,
        run,
        duration: formatDuration(agent.started || run.started, agent.completed),
        derivedStatus: deriveAgentStatus(agent, run),
      });
    }
  }

  const activeAgents = allAgents.filter(
    ({ derivedStatus }) => derivedStatus === "running" || derivedStatus === "pending"
  );
  const completedAgents = allAgents.filter(
    ({ derivedStatus }) => derivedStatus === "completed" || derivedStatus === "failed" || derivedStatus === "error" || derivedStatus === "stopped" || derivedStatus === "cancelled"
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div>
          <h1>Agent Health</h1>
          <p className="text-xs text-foreground/50">
            {activeAgents.length} active
            {completedAgents.length > 0 && <> · {completedAgents.length} completed</>}
            {" · "}refreshes every 5s
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => fetchActiveRuns()} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <WaveSpinner size="sm" color="primary" animation="ripple" />
          </div>
        ) : allAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-center bg-muted">
            <Bot className="h-12 w-12 text-muted-foreground/30 mb-3" />
            <h3 className="text-sm font-medium text-foreground/70 mb-1">No agents currently active</h3>
            <p className="text-xs text-muted-foreground mb-4 max-w-xs">
              Active agent sessions will appear here with real-time status updates.
            </p>
            <Link href="/chains">
              <Button size="sm" variant="default">
                Run a chain
              </Button>
            </Link>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {/* Active Agents */}
            {activeAgents.length > 0 && (
              <div>
                <h2 className="text-xs font-medium text-foreground/60 uppercase tracking-wider mb-3">
                  Active ({activeAgents.length})
                </h2>
                <div className="space-y-2">
                  {activeAgents.map(({ agent, run, duration, derivedStatus }) => (
                    <div
                      key={`${run.id}-${agent.id}`}
                      className="bg-card rounded-md p-3 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium truncate">
                            {agent.name || agent.id}
                          </span>
                          {getStatusBadge(derivedStatus)}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono">{run.id.slice(-8)}</span>
                          <span className="truncate max-w-[200px]">{run.chain}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {duration}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {(agent.agentId || agent.name) && (
                          <Link href={`/agents/${agent.agentId || encodeURIComponent(agent.name || agent.id)}`}>
                            <Button size="sm" variant="ghost" className="text-xs">
                              Preview
                            </Button>
                          </Link>
                        )}
                        <Link href={`/runs/${run.id}`}>
                          <Button size="sm" variant="ghost" className="text-xs">
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Completed Agents */}
            {completedAgents.length > 0 && (
              <div>
                <h2 className="text-xs font-medium text-foreground/60 uppercase tracking-wider mb-3">
                  Completed ({completedAgents.length})
                </h2>
                <div className="space-y-2">
                  {completedAgents.map(({ agent, run, duration, derivedStatus }) => (
                    <div
                      key={`${run.id}-${agent.id}`}
                      className="bg-muted rounded-md p-3 flex items-center gap-3 opacity-60"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium truncate">
                            {agent.name || agent.id}
                          </span>
                          {getStatusBadge(derivedStatus)}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-mono">{run.id.slice(-8)}</span>
                          <span className="truncate max-w-[200px]">{run.chain}</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {duration}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {(agent.agentId || agent.name) && (
                          <Link href={`/agents/${agent.agentId || encodeURIComponent(agent.name || agent.id)}`}>
                            <Button size="sm" variant="ghost" className="text-xs opacity-70">
                              Preview
                            </Button>
                          </Link>
                        )}
                        <Link href={`/runs/${run.id}`}>
                          <Button size="sm" variant="ghost" className="text-xs opacity-70">
                            View
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentsHealthPage() {
  return (
    <Suspense fallback={
      <div className="h-full flex items-center justify-center">
        <WaveSpinner size="sm" color="primary" animation="ripple" />
      </div>
    }>
      <AgentsHealthPageContent />
    </Suspense>
  );
}
