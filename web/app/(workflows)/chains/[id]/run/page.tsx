"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StatusBadge, type Status } from "@/components/status-badge";
import { AgentStatusPanel, type AgentStatusDetail } from "@/components/agent/agent-status-panel";
import { PerformanceTab } from "@/components/run/performance-tab";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// Alert/AlertDescription available for future error states
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEventStream } from "@/hooks/use-event-stream";
import { useRunNotifications } from "@/hooks/use-notifications-listener";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { useAgentProfiles } from "@/lib/hooks/use-agent-profiles";
import { resolveRunAgentProfileId } from "@/lib/agents/run-agent-profile";
import type { AgentProfile } from "@/lib/types";
import {
  ArrowLeftFilled,
  CommandSquareFilled,
  ClockFilled,
  ChartFilled,
  FolderOpenFilled,
  ArrowRightFilled,
  RotateFilled as Loader2,
  PlayFilled as Play,
  FlashFilled as Square,
  Webhook,
  RecordCircleFilled as Dot,
  BotMessageSquare as Bot,
  Webhook as WebhookOff,
  Warning2Filled as Target,
} from "@aliimam/icons";

// ============================================================
// types
// ============================================================

interface SessionState {
  status?: string;
  started?: string;
  completed?: string;
  session?: string;
  agent_id?: string;
}

interface ChainAgent {
  id: string;
  name: string;
  role: string;
  agent_profile?: string;
  gateway?: string;
  prompt: string;
  triggers: string[];
  emits: string;
  context?: {
    read_first: string[];
    workspace?: string;
  };
  authorities?: {
    can: string[];
    needs_approval: string[];
  };
  timeout?: number;
  retry?: {
    max_retries: number;
    backoff: string;
  };
}

interface Chain {
  id: string;
  name: string;
  description: string;
  version: string;
  agents: ChainAgent[];
  default_agent_profile?: string;
  webhooks?: Array<{
    event_type: string;
    url: string;
    headers?: Record<string, string>;
  }>;
  goal?: string;
}

interface Run {
  id: string;
  chain: string;
  chainId?: string;
  goal: string;
  started: string;
  completed?: string;
  status: "running" | "completed" | "failed" | "cancelled";
  agents: Array<{
    id: string;
    name: string;
    status: string;
    started?: string;
    completed?: string;
    output?: string;
    error?: string;
  }>;
  workspaceId?: string;
  agentProfileId?: string;
}

type TabValue = "goal" | "agents" | "terminal" | "events" | "metrics";

interface StreamEvent {
  filename?: string;
  event?: string;
  source?: string;
  timestamp?: string;
  processed?: boolean;
  data?: string;
}

// ============================================================
// helpers
// ============================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function statusFromRun(runStatus: string): Status {
  switch (runStatus) {
    case "running": return "running";
    case "completed": return "complete";
    case "failed": return "error";
    case "cancelled": return "cancelled";
    default: return "pending";
  }
}

// ============================================================
// components
// ============================================================

function GoalInput({
  goal,
  setGoal,
  isRunning,
  onStart,
  chain,
  workspaceId,
  onWorkspaceChange,
  workspaces,
  agentProfileId,
  onAgentProfileChange,
  profiles,
}: {
  goal: string;
  setGoal: (g: string) => void;
  isRunning: boolean;
  onStart: () => void;
  chain: Chain | null;
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  workspaces: Array<{ id: string; name: string; path: string; default_agent_profile?: string }>;
  agentProfileId: string;
  onAgentProfileChange: (id: string) => void;
  profiles: AgentProfile[];
}) {
  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto">
      <div className="flex items-center gap-2 mb-4">
        <Target className="h-5 w-5 text-foreground/60" />
        <h2 className="text-lg font-medium">chain goal</h2>
      </div>

      {chain && (
        <div className="mb-4 p-3 bg-card rounded-md">
          <p className="text-xs text-foreground/40 mb-1">chain</p>
          <p className="text-sm font-medium">{chain.name}</p>
          <p className="text-xs text-foreground/50 mt-1">{chain.description}</p>
          <Badge variant="ghost" className="mt-2 text-xs bg-muted">
            v{chain.version}
          </Badge>
        </div>
      )}

      {chain?.goal && (
        <div className="mb-4 p-3 bg-accent rounded-md">
          <p className="text-xs text-muted-foreground mb-1">default goal</p>
          <p className="text-xs text-foreground">{chain.goal}</p>
        </div>
      )}

      {workspaces.length > 0 && (
        <div className="mb-4">
          <label htmlFor="workspace-select" className="text-sm text-foreground/60 mb-2 block">
            <FolderOpenFilled className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
            run in workspace
          </label>
          <Select value={workspaceId} onValueChange={onWorkspaceChange}>
            <SelectTrigger id="workspace-select" className="h-9 text-xs bg-card">
              <SelectValue placeholder="select workspace..." />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id} className="text-xs">
                  <span>{ws.name}</span>
                  <span className="ml-2 text-muted-foreground font-mono">{ws.path}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="mb-4">
          <label htmlFor="agent-profile-select" className="text-sm text-foreground/60 mb-2 block">
            <Square className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
            run with profile
          </label>
          <Select value={agentProfileId} onValueChange={onAgentProfileChange}>
            <SelectTrigger id="agent-profile-select" className="h-9 text-xs bg-card">
              <SelectValue placeholder="select profile..." />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id} className="text-xs">
                  <span>{profile.name}</span>
                  <span className="ml-2 text-muted-foreground font-mono">
                    {profile.cli}{profile.model ? ` / ${profile.model}` : ""}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="chain-goal" className="text-sm text-foreground/60 mb-2 block">
          what should this chain accomplish?
        </label>
        <Textarea
          id="chain-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="describe the goal..."
          className="min-h-[200px] bg-card text-sm"
          disabled={isRunning}
        />
      </div>

      <div className="mt-4">
        <Button
          onClick={onStart}
          disabled={!goal.trim() || isRunning}
          className="w-full"
          size="lg"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              chain is running...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              start chain
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function AgentList({
  agents,
  sessionStates,
  run,
  chainDefaultProfileId,
  workspaceDefaultProfileId,
}: {
  agents: ChainAgent[];
  sessionStates: Record<string, SessionState>;
  run: Run | null;
  chainDefaultProfileId?: string;
  workspaceDefaultProfileId?: string;
}) {
  const agentsWithStatus = useMemo(() => {
    return agents.map((agent) => {
      const sessionState = sessionStates[agent.id];
      const runAgent = run?.agents.find((a) => a.id === agent.id);

      return {
        ...agent,
        status: (sessionState?.status || runAgent?.status || "pending") as Status,
        started: sessionState?.started || runAgent?.started,
        completed: sessionState?.completed || runAgent?.completed,
        session: sessionState?.session,
        error: runAgent?.error,
        duration:
          sessionState?.started && sessionState?.completed
            ? new Date(sessionState.completed).getTime() -
              new Date(sessionState.started).getTime()
            : undefined,
      };
    });
  }, [agents, sessionStates, run]);

  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-foreground/60" />
          <h2 className="text-sm font-medium">agents</h2>
        </div>
        <Badge variant="ghost" className="text-xs bg-muted">
          {agentsWithStatus.length}
        </Badge>
      </div>

      <div className="space-y-2">
        {agentsWithStatus.map((agent, idx) => (
          <AgentStatusPanel
            key={agent.id || `agent-${idx}`}
            agent={agent as AgentStatusDetail}
            compact
            showRuntime
            agentProfileId={agent.agent_profile}
            runtimeProfileId={run?.agentProfileId}
            chainDefaultProfileId={chainDefaultProfileId}
            workspaceDefaultProfileId={workspaceDefaultProfileId}
            defaultExpanded={agent.status === "running" || agent.status === "error"}
          />
        ))}
      </div>
    </div>
  );
}

function TerminalOutput({ sessionStates }: { runId: string | null; sessionStates: Record<string, SessionState> }) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);
  const initializedRef = useRef(false);

  const sessions = useMemo(() => {
    return Object.values(sessionStates)
      .map((s) => s.session)
      .filter((s): s is string => Boolean(s));
  }, [sessionStates]);

  useEffect(() => {
    if (selectedSession && !isFetchingRef.current) {
      isFetchingRef.current = true;

      const fetchOutput = async () => {
        setLoading(true);
        try {
          const res = await fetchWithNamespace(
            `/api/agents/${encodeURIComponent(selectedSession)}/output`
          );
          if (res.ok) {
            const data = await res.json();
            setOutputs((prev) => ({ ...prev, [selectedSession]: data.output || "" }));
          }
        } catch {}
        setLoading(false);
        isFetchingRef.current = false;
      };

      fetchOutput();
      const interval = setInterval(fetchOutput, 2000);
      return () => {
        clearInterval(interval);
        isFetchingRef.current = false;
      };
    }
  }, [selectedSession, fetchWithNamespace]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputs, selectedSession]);

  useEffect(() => {
    if (sessions.length > 0 && !selectedSession && !initializedRef.current) {
      const firstSession = sessions[0];
      if (firstSession) {
        initializedRef.current = true;
        setTimeout(() => setSelectedSession(firstSession), 0);
      }
    }
  }, [sessions, selectedSession]);

  const currentOutput = selectedSession ? outputs[selectedSession] || "" : "";
  const selectedSessionState = selectedSession
    ? Object.values(sessionStates).find((s) => s.session === selectedSession)
    : undefined;
  const selectedSessionAlive = selectedSessionState?.status === "running";

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-3 bg-accent">
        <div className="flex items-center gap-2">
          <CommandSquareFilled className="h-4 w-4 text-foreground/60" />
          <span className="text-sm">terminal output</span>
        </div>
        {selectedSession && (
          <Badge variant="ghost" className="text-xs bg-muted font-mono">
            {selectedSession.slice(0, 8)}
          </Badge>
        )}
      </div>

      <div className="flex">
        {sessions.length === 0 ? (
          <div className="px-3 py-2 text-xs text-foreground/30">
            no active sessions
          </div>
        ) : (
          sessions.map((session, idx) => (
            <>
              {idx > 0 && <div className="w-px bg-accent" />}
              <button
                key={session}
                onClick={() => setSelectedSession(session)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  selectedSession === session
                    ? "bg-accent text-foreground"
                    : "text-foreground/50 hover:text-foreground hover:bg-muted"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Dot className={`h-3 w-3 ${
                    sessionStates[Object.values(sessionStates).find((s) => s.session === session)?.agent_id || ""]?.status === "running"
                      ? "text-foreground animate-pulse"
                      : "text-foreground/40"
                  }`} />
                  <span className="font-mono">{session.slice(0, 8)}</span>
                </div>
              </button>
            </>
          ))
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {selectedSession ? (
          <TerminalPanel
            session={selectedSession}
            sessionAlive={selectedSessionAlive}
            fallbackOutput={currentOutput}
            readOnly
            compact
          />
        ) : loading && !currentOutput ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-foreground/30" />
          </div>
        ) : (
          <div
            ref={outputRef}
            className="h-full bg-card text-foreground p-4 overflow-y-auto font-mono text-xs"
          >
            {currentOutput ? (
              <pre className="whitespace-pre-wrap">{currentOutput}</pre>
            ) : (
              <p className="text-foreground/30">
                {selectedSession ? "waiting for output..." : "select a session"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EventsTimeline({ events }: { events: StreamEvent[] }) {
  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto">
      <div className="flex items-center gap-2 mb-4">
        <ClockFilled className="h-5 w-5 text-foreground/60" />
        <h2 className="text-sm font-medium">events timeline</h2>
        <Badge variant="ghost" className="text-xs bg-muted">
          {events.length}
        </Badge>
      </div>

      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-foreground/30">no events yet</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-accent" />
          <div className="space-y-3">
            {events.map((event, idx) => (
              <div key={event.filename || idx} className="relative flex gap-3">
                <div className="relative z-10 mt-1">
                  {event.processed ? (
                    <div className="w-3.5 h-3.5 rounded-full bg-foreground border-2 border-background" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full bg-muted border-2 border-background" />
                  )}
                </div>
                <Card className="flex-1 bg-muted p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium">{event.event || "unknown"}</span>
                    <Badge variant="ghost" className="text-[10px] bg-muted">
                      {event.source || "?"}
                    </Badge>
                  </div>
                  {event.data && (
                    <p className="text-[10px] text-foreground/50 truncate">{event.data}</p>
                  )}
                  {event.timestamp && (
                    <p className="text-[9px] text-foreground/30 mt-1 font-mono">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </p>
                  )}
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricsTab({ runId, chainId }: { runId: string | null; chainId: string | null }) {
  return <PerformanceTab runId={runId} chainId={chainId || undefined} />;
}

// ============================================================
// main page
// ============================================================

export default function RunPage() {
  const { fetchWithNamespace } = useNamespaceFetch();
  const params = useParams();
  const chainId = params.id as string;
  const { workspaceId: ctxWorkspaceId, workspaces } = useWorkspace();
  const { profiles } = useAgentProfiles();

  const [chain, setChain] = useState<Chain | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [goal, setGoal] = useState("");
  const [runWorkspaceId, setRunWorkspaceId] = useState(ctxWorkspaceId);
  const [runAgentProfileId, setRunAgentProfileId] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabValue>("goal");
  const [webhookEnabled, setWebhookEnabled] = useState(true);
  const selectedWorkspaceDefaultProfileId =
    workspaces.find((workspace) => workspace.id === runWorkspaceId)?.default_agent_profile;

  // sync with context workspace when it changes (e.g. user switches in nav)
  useEffect(() => { setRunWorkspaceId(ctxWorkspaceId); }, [ctxWorkspaceId]);

  useEffect(() => {
    if (!chain) return;
    setRunAgentProfileId(resolveRunAgentProfileId({
      chainDefaultProfileId: chain.default_agent_profile,
      workspaceDefaultProfileId: selectedWorkspaceDefaultProfileId,
      profiles,
    }) || "");
  }, [chain, selectedWorkspaceDefaultProfileId, profiles]);

  const { connected, events, sessionStatus, chainComplete } = useEventStream(run?.id || null);
  useRunNotifications(run?.id || null);

  // update run status when chain completes
  useEffect(() => {
    if (chainComplete && run && run.status === "running") {
      setRun((prev) => prev ? { ...prev, status: "completed", completed: new Date().toISOString() } : null);
    }
  }, [chainComplete, run]);

  // poll run status while running
  useEffect(() => {
    if (!run?.id || run.status !== "running") return;

    const poll = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${run.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.run) {
          setRun(data.run);
        }
      } catch { /* ignore */ }
    };

    // initial fetch immediately to get resolved agent names
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [run?.id, run?.status, fetchWithNamespace]);

  // ============================================================
  // data fetching
  // ============================================================

  useEffect(() => {
    const fetchChain = async () => {
      try {
        const res = await fetchWithNamespace(`/api/chains/${chainId}`);
        if (res.ok) {
          const data = await res.json();
          setChain(data.chain);
          if (data.chain.goal) {
            setGoal(data.chain.goal);
          }
        }
      } catch {}
    };
    fetchChain();
  }, [chainId, fetchWithNamespace]);

  // ============================================================
  // start chain
  // ============================================================

  const handleStart = async () => {
    if (!goal.trim() || !chain) return;

    const selectedWs = workspaces.find((w) => w.id === runWorkspaceId);
    setIsStarting(true);
    try {
      const res = await fetchWithNamespace("/api/chains/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          chainId,
          userPrompt: goal,
          webhook: webhookEnabled,
          ...(runAgentProfileId ? { agentProfileId: runAgentProfileId } : {}),
          ...(selectedWs ? { workspacePath: selectedWs.path, workspaceId: selectedWs.id } : {}),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // API returns { success, runId, chainId, status }
        // construct Run object for UI state
        setRun(data.run || {
          id: data.runId,
          chain: chain.name,
          chainId: data.chainId || chainId,
          goal,
          started: new Date().toISOString(),
          status: "running",
          agents: chain.agents?.map((a) => ({
            id: a.id,
            name: a.name,
            status: "pending",
            session: "",
          })) || [],
          ...(selectedWs ? { workspacePath: selectedWs.path, workspaceId: selectedWs.id } : {}),
          ...(runAgentProfileId ? { agentProfileId: runAgentProfileId } : {}),
        });
        setActiveTab("agents");
      } else {
        const error = await res.json();
        alert(error.error || "failed to start chain");
      }
    } catch {
      alert("failed to start chain");
    } finally {
      setIsStarting(false);
    }
  };

  // ============================================================
  // stop chain
  // ============================================================

  const handleStop = async () => {
    if (!run?.id) return;

    try {
      await fetchWithNamespace(`/api/runs/${run.id}/stop`, { method: "POST" });
      setRun((prev) => prev ? { ...prev, status: "cancelled" } : null);
    } catch {}
  };

  // ============================================================
  // derived state
  // ============================================================

  const chainEvents = useMemo(() => {
    return events
      .filter((e) => e.type === "event" && e.data)
      .map((e) => e.data as StreamEvent);
  }, [events]);

  const isRunning = run?.status === "running";

  // ============================================================
  // render
  // ============================================================

  return (
    <div className="h-full flex flex-col bg-background">
      {/* header */}
      <header className="h-14 bg-accent flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link href={`/chains/${chainId}`}>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
              <ArrowLeftFilled className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-sm">{chain?.name || "chain"}</h1>
            {run && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground/40 font-mono">
                  {run.id}
                </span>
                <StatusBadge status={statusFromRun(run.status)} size="sm" />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* sse connection indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted">
            {connected ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-foreground animate-pulse" />
                <span className="text-[10px] text-foreground">live</span>
              </>
            ) : (
              <>
                <Dot className="h-3 w-3 text-foreground/30" />
                <span className="text-[10px] text-foreground/30">polling</span>
              </>
            )}
          </div>

          {/* webhook toggle */}
          {!run && (
            <Button
              size="sm"
              variant={webhookEnabled ? "default" : "outline"}
              className="h-8"
              onClick={() => setWebhookEnabled(!webhookEnabled)}
            >
              {webhookEnabled ? (
                <Webhook className="h-3.5 w-3.5 mr-1" />
              ) : (
                <WebhookOff className="h-3.5 w-3.5 mr-1" />
              )}
              webhooks
            </Button>
          )}

          {/* stop button */}
          {run && isRunning && (
            <Button size="sm" variant="destructive" className="h-8" onClick={handleStop}>
              <Square className="h-3.5 w-3.5 mr-1" />
              stop
            </Button>
          )}

          {/* new run button */}
          {run && !isRunning && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setRun(null);
                setActiveTab("goal");
              }}
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              new run
            </Button>
          )}
        </div>
      </header>

      {/* main content */}
      <main className="flex-1 overflow-hidden">
        {!run ? (
          // pre-run: show goal input
          <div className="h-full">
            <GoalInput
              goal={goal}
              setGoal={setGoal}
              isRunning={isStarting}
              onStart={handleStart}
              chain={chain}
              workspaceId={runWorkspaceId}
              onWorkspaceChange={setRunWorkspaceId}
              workspaces={workspaces}
              agentProfileId={runAgentProfileId}
              onAgentProfileChange={setRunAgentProfileId}
              profiles={profiles}
            />
          </div>
        ) : (
          // post-run: show tabs
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="h-full flex flex-col">
            <div className="bg-accent px-4 shrink-0">
              <TabsList className="bg-transparent border-0 h-12 p-0 gap-1">
                <TabsTrigger
                  value="goal"
                  className="data-[state=active]:bg-accent data-[state=active]:text-foreground h-8 px-3 text-xs"
                >
                  <Target className="h-3.5 w-3.5 mr-1.5" />
                  goal
                </TabsTrigger>
                <TabsTrigger
                  value="agents"
                  className="data-[state=active]:bg-accent data-[state=active]:text-foreground h-8 px-3 text-xs"
                >
                  <Bot className="h-3.5 w-3.5 mr-1.5" />
                  agents
                  {chain?.agents ? (
                    <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                      {chain.agents.length}
                    </Badge>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger
                  value="terminal"
                  className="data-[state=active]:bg-accent data-[state=active]:text-foreground h-8 px-3 text-xs"
                >
                  <CommandSquareFilled className="h-3.5 w-3.5 mr-1.5" />
                  terminal
                </TabsTrigger>
                <TabsTrigger
                  value="events"
                  className="data-[state=active]:bg-accent data-[state=active]:text-foreground h-8 px-3 text-xs"
                >
                  <ClockFilled className="h-3.5 w-3.5 mr-1.5" />
                  events
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {chainEvents.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="metrics"
                  className="data-[state=active]:bg-accent data-[state=active]:text-foreground h-8 px-3 text-xs"
                >
                  <ChartFilled className="h-3.5 w-3.5 mr-1.5" />
                  metrics
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="goal" className="h-full m-0 p-0">
                <div className="h-full">
                  <GoalInput
                    goal={run.goal}
                    setGoal={() => {}}
                    isRunning={isRunning}
                    onStart={() => {}}
                    chain={chain}
                    workspaceId={runWorkspaceId}
                    onWorkspaceChange={() => {}}
                    workspaces={workspaces}
                    agentProfileId={runAgentProfileId}
                    onAgentProfileChange={() => {}}
                    profiles={profiles}
                  />
                </div>
              </TabsContent>

              <TabsContent value="agents" className="h-full m-0 p-0">
                {chain ? (
                  <AgentList
                    agents={run?.agents?.length ? run.agents as unknown as ChainAgent[] : chain.agents}
                    sessionStates={sessionStatus}
                    run={run}
                    chainDefaultProfileId={chain.default_agent_profile}
                    workspaceDefaultProfileId={selectedWorkspaceDefaultProfileId}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-foreground/30" />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="terminal" className="h-full m-0 p-0">
                <TerminalOutput runId={run.id} sessionStates={sessionStatus} />
              </TabsContent>

              <TabsContent value="events" className="h-full m-0 p-0">
                <EventsTimeline events={chainEvents} />
              </TabsContent>

              <TabsContent value="metrics" className="h-full m-0 p-0">
                <MetricsTab runId={run.id} chainId={chainId} />
              </TabsContent>
            </div>
          </Tabs>
        )}
      </main>

      {/* status bar */}
      <footer className="h-8 bg-accent flex items-center justify-between px-4 text-[10px] text-foreground/40 shrink-0">
        <div className="flex items-center gap-3">
          <span>chain: {chainId}</span>
          {run && (
            <>
              <ArrowRightFilled className="h-3 w-3" />
              <span>run: {run.id}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {run && (
            <>
              <span>
                started: {new Date(run.started).toLocaleTimeString()}
              </span>
              {run.completed && (
                <>
                  <ArrowRightFilled className="h-3 w-3" />
                  <span>
                    duration: {formatDuration(
                      new Date(run.completed).getTime() - new Date(run.started).getTime()
                    )}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
