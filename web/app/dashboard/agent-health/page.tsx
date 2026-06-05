"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ActivityFilled as Activity,
  RefreshFilled,
  ClockFilled as Clock,
  FlashFilled as Power,
  CommandSquareFilled as Terminal,
  UserFilled as User,
  LinkFilled as Workflow,
} from "@aliimam/icons";
import { PageBanner } from "@/components/ui/page-banner";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { getApiErrorMessage } from "@/lib/api/api-client";

interface AgentSession {
  name: string;
  pid: number;
  status: "alive" | "dead";
  command: string;
  startTime?: number;
  runId?: string;
  chain?: string;
  agentId?: string;
}

interface AgentHealthResponse {
  sessions: AgentSession[];
  error?: string;
}

const STATUS_COLORS = {
  alive: "text-green-400",
  dead: "text-red-400",
};

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function getSessionType(session: AgentSession): string {
  if (session.name.includes("-watchdog")) return "watchdog";
  if (session.name.includes("-chain-watcher")) return "chain-watcher";
  if (session.name.includes("-chain-")) return "agent";
  return "other";
}

function getSessionDisplayName(session: AgentSession): string {
  const type = getSessionType(session);

  switch (type) {
    case "watchdog":
      return "Watchdog";
    case "chain-watcher":
      return "Chain Watcher";
    case "agent":
      if (session.chain) {
        return `${session.chain}`;
      }
      return session.name;
    default:
      return session.name;
  }
}

export default function AgentHealthPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [killing, setKilling] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchSessions = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      const res = await fetchWithNamespace("/api/agent-health");
      const data: AgentHealthResponse = await res.json();

      if (data.error) {
        setError(getApiErrorMessage(data, "unknown error"));
      } else {
        setError(null);
        setSessions(data.sessions);
      }

      setLastUpdate(new Date());
      setNow(Date.now());
    } catch (e) {
      console.error("failed to fetch agent health", e);
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchWithNamespace]);

  const killSession = useCallback(async (sessionName: string) => {
    if (!confirm(`kill session "${sessionName}"?`)) return;

    try {
      setKilling(sessionName);
      const res = await fetchWithNamespace(`/api/agent-health?session=${encodeURIComponent(sessionName)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await fetchSessions();
      } else {
        const data = await res.json();
        setError(getApiErrorMessage(data, "failed to kill session"));
      }
    } catch (e) {
      console.error("failed to kill session", e);
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setKilling(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWithNamespace]);

  useEffect(() => {
    fetchSessions();

    const interval = setInterval(() => fetchSessions(), 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const aliveSessions = sessions.filter((s) => s.status === "alive");
  const deadSessions = sessions.filter((s) => s.status === "dead");
  const agentSessions = sessions.filter((s) => getSessionType(s) === "agent");
  const systemSessions = sessions.filter((s) =>
    ["watchdog", "chain-watcher", "other"].includes(getSessionType(s))
  );

  return (
    <div>
      <PageBanner
        title="Agent Health"
        subtitle="Live view of active PTY sessions, agent processes, and system watchdogs."
        icon={Activity}
        sectionColor="#a0927b"
        actions={[
          { label: "Refresh", icon: RefreshFilled, iconColor: "#a0927b", onClick: () => fetchSessions(true) },
        ]}
      />
      <div className="px-4 py-3 max-w-6xl mx-auto">

      {loading && sessions.length === 0 ? (
        <div className="bg-card rounded-md p-8 text-center">
          <Activity className="h-8 w-8 mx-auto mb-3 text-foreground/20 animate-pulse" />
          <p className="text-sm text-foreground/40">loading sessions...</p>
        </div>
      ) : (error === "pty-manager not found" || (error && sessions.length === 0 && error.includes("not found"))) ? (
        <div className="bg-card rounded-md p-8 text-center">
          <Terminal className="h-8 w-8 mx-auto mb-3 text-foreground/15" />
          <p className="text-sm text-foreground/40">No active sessions</p>
          <p className="text-xs text-foreground/25 mt-1">Start a chain run to see agent sessions here.</p>
        </div>
      ) : error && sessions.length === 0 ? (
        <div className="bg-card rounded-md p-8 text-center">
          <p className="text-sm text-foreground/40">{error}</p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-3">
          {/* stats */}
          <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <Terminal className="h-4 w-4 text-foreground/60" />
                <span className="text-xs text-foreground/60">Total Sessions</span>
              </div>
              <div className="text-2xl font-semibold">{sessions.length}</div>
            </div>
            <div className="bg-card rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="h-4 w-4 text-green-400" />
                <span className="text-xs text-foreground/60">Alive</span>
              </div>
              <div className="text-2xl font-semibold text-green-400">{aliveSessions.length}</div>
            </div>
            <div className="bg-card rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <User className="h-4 w-4 text-foreground/60" />
                <span className="text-xs text-foreground/60">Agents</span>
              </div>
              <div className="text-2xl font-semibold">{agentSessions.length}</div>
            </div>
            <div className="bg-card rounded-md p-4">
              <div className="flex items-center gap-2 mb-1">
                <Workflow className="h-4 w-4 text-foreground/60" />
                <span className="text-xs text-foreground/60">System</span>
              </div>
              <div className="text-2xl font-semibold">{systemSessions.length}</div>
            </div>
          </div>

          {/* agent sessions */}
          <div className="lg:col-span-2 bg-card rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <User className="h-4 w-4 text-foreground/60" />
              <span className="text-sm font-medium">Agent Sessions</span>
              <span className="text-xs text-foreground/40 ml-auto">{agentSessions.length}</span>
            </div>
            {agentSessions.length === 0 ? (
              <p className="text-xs text-foreground/40 py-4">No active agents</p>
            ) : (
              <div className="space-y-2">
                {agentSessions.map((session) => (
                  <SessionRow
                    key={session.name}
                    session={session}
                    killing={killing}
                    onKill={() => killSession(session.name)}
                    now={now}
                  />
                ))}
              </div>
            )}
          </div>

          {/* system sessions */}
          <div className="bg-card rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Workflow className="h-4 w-4 text-foreground/60" />
              <span className="text-sm font-medium">System Sessions</span>
              <span className="text-xs text-foreground/40 ml-auto">{systemSessions.length}</span>
            </div>
            {systemSessions.length === 0 ? (
              <p className="text-xs text-foreground/40 py-4">No system sessions</p>
            ) : (
              <div className="space-y-2">
                {systemSessions.map((session) => (
                  <SessionRow
                    key={session.name}
                    session={session}
                    killing={killing}
                    onKill={() => killSession(session.name)}
                    now={now}
                  />
                ))}
              </div>
            )}
          </div>

          {/* dead sessions */}
          {deadSessions.length > 0 && (
            <div className="lg:col-span-3 bg-card rounded-md p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-red-400" />
                <span className="text-sm font-medium">Dead Sessions</span>
                <span className="text-xs text-foreground/40 ml-auto">{deadSessions.length}</span>
              </div>
              <div className="space-y-2">
                {deadSessions.map((session) => (
                  <SessionRow
                    key={session.name}
                    session={session}
                    killing={killing}
                    onKill={() => killSession(session.name)}
                    now={now}
                  />
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

interface SessionRowProps {
  session: AgentSession;
  killing: string | null;
  onKill: () => void;
  now: number;
}

function SessionRow({ session, killing, onKill, now }: SessionRowProps) {
  const displayName = getSessionDisplayName(session);
  const type = getSessionType(session);
  const duration = session.startTime ? now - session.startTime : null;

  return (
    <div className="flex items-center gap-3 p-2 rounded-sm bg-muted/50 hover:bg-muted transition-colors">
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${
          session.status === "alive" ? "bg-green-400" : "bg-red-400"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{displayName}</span>
          <span className={`text-xs ${STATUS_COLORS[session.status]}`}>
            {session.status}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground/40">
          <span className="font-mono">pid:{session.pid}</span>
          {session.runId && <span>run:{session.runId.slice(-8)}</span>}
          {duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(duration)}
            </span>
          )}
          {type !== "agent" && (
            <span className="text-foreground/30">
              {type === "watchdog" ? "watchdog" : type === "chain-watcher" ? "chain-watcher" : "system"}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onKill}
        disabled={killing === session.name}
        className="p-1.5 rounded-sm bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-50 transition-colors"
        title="kill session"
      >
        <Power className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
