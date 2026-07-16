"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import { useParams, useRouter } from "next/navigation";
import { useRunNotifications, notifyAgentEvent } from "@/hooks/use-notifications-listener";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, type Status } from "@/components/common/status-badge";
import { RunComparison } from "@/components/run/run-comparison";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import {
  ArrowLeftFilled,
  PlayFilled as Play,
  FlashFilled as Pause,
  RefreshFilled as RotateCcw,
  ClockFilled as Clock,
  ComponentFilled as Cpu,
  ArrowSwapFilled as GitCompare,
  MaximizeFilled as Maximize2,
  Star1Filled as DollarSign,
  FlashFilled as Zap,
  InfoCircleFilled as AlertCircle,
  TickCircleFilled as CheckCircle2,
  CloseCircleFilled as XCircle,
  ArrowDown2Filled as ChevronDown,
  ArrowRight2Filled as ChevronRight,
  CopyFilled as Copy,
  DocumentTextFilled,
  TaskSquareFilled,
} from "@aliimam/icons";
import { TerminalIcon } from "@/components/ui/terminal-icon";
import { formatAgentAttemptTerminalReason } from "@/lib/runner-v2/attempt-terminal-reason";

interface Agent {
  id: string;
  name: string;
  status: string;
  session: string;
  emits?: string;
  started?: string;
  completed?: string;
}

interface AgentAttempt {
  id: string;
  agentId: string;
  phase: string;
  terminalReason?: string;
  terminalDetail?: string;
  processEvidence?: {
    processPid?: number;
    processSpawnedAt?: string;
    ptySessionId?: string;
  };
  instructionLedger?: Array<{ idempotencyKey: string; submittedAt: string }>;
  recoveryDecisionCount?: number;
  updatedAt?: string;
}

interface Run {
  id: string;
  chain: string;
  chainId: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  taskId?: string;
  agents: Agent[];
  runnerV2?: {
    attempts?: AgentAttempt[];
  };
}

interface EventArtifactExecution {
  id: string;
  mappingId: string;
  event: string;
  status: string;
  artifactName: string | null;
  draftTaskName: string | null;
  artifact: {
    qualityGate?: {
      reason?: string;
      findings?: string[];
      risks?: string[];
      nextActions?: string[];
    };
    generated?: {
      title?: string;
      subtasks?: Array<{ title?: string; type?: string; priority?: number }>;
    };
  } | null;
  draftTask: {
    title?: string;
    subtasks?: Array<{ title?: string; type?: string; priority?: number }>;
  } | null;
  actionResults: unknown[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StreamEvent {
  type: "session_status" | "event" | "run_status" | "connected" | "keepalive";
  data?: unknown;
  timestamp: string;
}

interface MetricPoint {
  timestamp: number;
  value: number;
}

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params["run-id"] as string;

  useRunNotifications(runId);

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [agentOutputs, setAgentOutputs] = useState<Record<string, string>>({});
  const [metricsTimeline, setMetricsTimeline] = useState<Record<string, MetricPoint[]>>({});
  const [debugPaused, setDebugPaused] = useState(false);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [currentPerf, setCurrentPerf] = useState<Record<string, unknown> | null>(null);
  const [eventArtifacts, setEventArtifacts] = useState<EventArtifactExecution[]>([]);
  const [eventArtifactsLoading, setEventArtifactsLoading] = useState(false);
  const [applyingExecutionId, setApplyingExecutionId] = useState<string | null>(null);
  const [eventArtifactError, setEventArtifactError] = useState<string | null>(null);

  const { fetchWithNamespace } = useNamespaceFetch();
  const eventSourceRef = useRef<EventSource | null>(null);
  const metricsRef = useRef<Record<string, MetricPoint[]>>({});
  const outputsRef = useRef<Record<string, string>>({});

  // fetch run data (full payload - initial load)
  const fetchRun = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setRun(data.run);
      }
    } catch (e) {
      console.error("failed to fetch run", e);
    } finally {
      setLoading(false);
    }
  }, [runId, fetchWithNamespace]);

  const fetchEventArtifacts = useCallback(async () => {
    setEventArtifactsLoading(true);
    setEventArtifactError(null);
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/event-artifacts`);
      if (!res.ok) return;
      const data = await res.json();
      const payload = data.data || data;
      setEventArtifacts(payload.executions || []);
    } catch (e) {
      setEventArtifactError(e instanceof Error ? e.message : "failed to load triage artifacts");
    } finally {
      setEventArtifactsLoading(false);
    }
  }, [runId, fetchWithNamespace]);

  // lightweight status poll
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/status`);
      if (!res.ok) return;
      const data = await res.json();
      setRun((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: data.status,
          completed: data.completed || prev.completed,
          runnerV2: data.runnerV2 || prev.runnerV2,
          agents: prev.agents.map((agent) => {
            const live = (data.agents || []).find((a: { id: string }) => a.id === agent.id);
            return live ? { ...agent, status: live.status, session: live.session } : agent;
          }),
        };
      });
    } catch {
      // ignore
    }
  }, [runId, fetchWithNamespace]);

  // fetch agent output
  const fetchAgentOutput = useCallback(async (_agentId: string, session: string) => {
    if (outputsRef.current[session]) return;

    try {
      const res = await fetchWithNamespace(`/api/agents/${encodeURIComponent(session)}/output`);
      if (res.ok) {
        const data = await res.json();
        outputsRef.current[session] = data.output || "";
        setAgentOutputs({ ...outputsRef.current });
      }
    } catch (e) {
      console.error("failed to fetch output", e);
    }
  }, [fetchWithNamespace]);

  // setup event stream
  useEffect(() => {
    const eventSource = new EventSource(
      `/api/events/stream?run-id=${encodeURIComponent(runId)}`
    );

    eventSource.onopen = () => setConnected(true);
    eventSource.onerror = () => setConnected(false);

    eventSource.addEventListener("message", (e) => {
      if (debugPaused) return;

      try {
        const event: StreamEvent = JSON.parse(e.data);

        if (event.type === "session_status" && event.data) {
          const eventData = event.data as { agent_id: string; status: string; session: string };
          // update agent status in run
          setRun((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              agents: prev.agents.map((agent) =>
                agent.id === eventData.agent_id
                  ? { ...agent, status: eventData.status, session: eventData.session || agent.session }
                  : agent
              ),
            };
          });

          // dispatch notifications for agent status changes
          if (eventData.status === "complete") {
            notifyAgentEvent({
              type: "agent_complete",
              title: "Agent completed",
              message: eventData.agent_id,
              metadata: { agentId: eventData.agent_id, runId },
            });
          } else if (eventData.status === "error" || eventData.status === "failed") {
            notifyAgentEvent({
              type: "agent_error",
              title: "Agent failed",
              message: eventData.agent_id,
              metadata: { agentId: eventData.agent_id, runId },
            });
          }

          // add metrics point
          const agentId = eventData.agent_id;
          if (!metricsRef.current[agentId]) {
            metricsRef.current[agentId] = [];
          }
          metricsRef.current[agentId].push({
            timestamp: Date.now(),
            value: eventData.status === "running" ? 1 : eventData.status === "complete" ? 0.5 : 0,
          });
          // keep only last 100 points
          if (metricsRef.current[agentId].length > 100) {
            metricsRef.current[agentId] = metricsRef.current[agentId].slice(-100);
          }
          setMetricsTimeline({ ...metricsRef.current });
        }

        if (event.type === "event" && event.data) {
          // could display events in a timeline
        }
      } catch {}
    });

    eventSourceRef.current = eventSource;

    return () => {
      eventSource.close();
    };
  }, [runId, debugPaused]);

  useEffect(() => {
    fetchRun();
    fetchEventArtifacts();
    const interval = setInterval(pollStatus, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRun, fetchEventArtifacts]);

  // fetch performance data
  useEffect(() => {
    const fetchPerf = async () => {
      try {
        const res = await fetchWithNamespace(`/api/runs/${runId}/performance`);
        if (res.ok) {
          const data = await res.json();
          setCurrentPerf(data);
        }
      } catch (e) {
        console.error("failed to fetch performance", e);
      }
    };
    fetchPerf();
  }, [runId, fetchWithNamespace]);

  // auto-fetch output for selected agent
  useEffect(() => {
    if (selectedAgent && run) {
      const agent = run.agents.find((a) => a.id === selectedAgent);
      if (agent?.session) {
        fetchAgentOutput(selectedAgent, agent.session);
        const interval = setInterval(() => fetchAgentOutput(selectedAgent, agent.session), 3000);
        return () => clearInterval(interval);
      }
    }
  }, [selectedAgent, run, fetchAgentOutput]);

  const toggleExpand = (agentId: string) => {
    const newExpanded = new Set(expandedAgents);
    if (newExpanded.has(agentId)) {
      newExpanded.delete(agentId);
    } else {
      newExpanded.add(agentId);
    }
    setExpandedAgents(newExpanded);
  };

  const formatDuration = (start?: string, end?: string) => {
    if (!start) return "-";
    const startDate = new Date(start).getTime();
    const endDate = end ? new Date(end).getTime() : Date.now();
    const diff = endDate - startDate;
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}m ${secs}s`;
  };

  const handleCopyOutput = (sessionId: string) => {
    const output = agentOutputs[sessionId] || "";
    copyToClipboard(output);
  };

  const handleRetryAgent = async (_agentId: string) => {
    // TODO: implement retry logic
  };

  const handleApplyEventArtifact = async (executionId: string) => {
    if (!run?.taskId) {
      setEventArtifactError("run has no task id");
      return;
    }
    setApplyingExecutionId(executionId);
    setEventArtifactError(null);
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/event-artifacts/${executionId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentTaskId: run.taskId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "apply failed");
      }
      await fetchEventArtifacts();
      await fetchRun();
    } catch (e) {
      setEventArtifactError(e instanceof Error ? e.message : "apply failed");
    } finally {
      setApplyingExecutionId(null);
    }
  };

  const handlePauseResume = () => {
    setDebugPaused(!debugPaused);
  };

  const latestAttemptForAgent = (agentId: string): AgentAttempt | undefined => {
    const attempts = run?.runnerV2?.attempts?.filter((attempt) => attempt.agentId === agentId) || [];
    return attempts[attempts.length - 1];
  };

  const Sparkline = ({ data, width = 200, height = 40 }: { data: MetricPoint[]; width?: number; height?: number }) => {
    if (data.length < 2) return null;

    const max = Math.max(...data.map((d) => d.value), 1);
    const points = data.map((d, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (d.value / max) * height;
      return `${x},${y}`;
    }).join(" ");

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke="url(#sparkline-gradient)"
          strokeWidth="2"
          points={points}
        />
        <defs>
          <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="1" />
          </linearGradient>
        </defs>
      </svg>
    );
  };

  // comparison view component
  const ComparisonView = () => {
    if (!run) return null;
    return (
      <div>
        <RunComparison
          currentRun={run}
          currentPerf={currentPerf || {}}
          onClose={() => setComparisonMode(false)}
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-foreground/40 text-xs">
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          loading run...
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <AlertCircle className="h-8 w-8 text-foreground/20" />
        <p className="text-sm text-foreground/40">run not found</p>
        <Button size="sm" variant="secondary" onClick={() => router.back()}>
          go back
        </Button>
      </div>
    );
  }

  const completedAgents = run.agents?.filter((a) => a.status === "complete").length || 0;
  const totalAgents = run.agents?.length || 0;

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-foreground/5">
        <div className="flex items-center gap-4">
          <Button size="sm" variant="ghost" onClick={() => router.back()}>
            <ArrowLeftFilled className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm">{run.chain}</h1>
              <StatusBadge status={run.status as Status} size="sm" />
              {connected && (
                <Badge variant="ghost" className="text-[9px] bg-green-500/10 text-green-400 border-green-500/20">
                  live
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-foreground/40 font-mono mt-0.5">{runId}</p>
          </div>
        </div>

        {/* stats */}
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-foreground/40" />
            <span className="font-mono">{formatDuration(run.started, run.completed)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-foreground/40" />
            <span className="font-mono">{completedAgents}/{totalAgents}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={debugPaused ? "default" : "secondary"}
              className="h-7 text-[10px]"
              onClick={handlePauseResume}
            >
              {debugPaused ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
              {debugPaused ? "paused" : "live"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-[10px]"
              onClick={() => setComparisonMode(!comparisonMode)}
            >
              <GitCompare className="h-3 w-3 mr-1" />
              compare
            </Button>
          </div>
        </div>
      </div>

      {/* content */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="agents" className="h-full flex flex-col">
          <div className="px-6 pt-3">
            <TabsList className="bg-muted">
              <TabsTrigger value="agents" className="text-xs">agents</TabsTrigger>
              <TabsTrigger value="output" className="text-xs">output</TabsTrigger>
              <TabsTrigger value="triage" className="text-xs">
                triage
                {eventArtifacts.length > 0 && (
                  <span className="ml-1 rounded bg-amber-500/15 px-1 text-[9px] text-amber-300">
                    {eventArtifacts.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="metrics" className="text-xs">metrics</TabsTrigger>
              <TabsTrigger value="timeline" className="text-xs">timeline</TabsTrigger>
            </TabsList>
          </div>

          {/* agents tab */}
          <TabsContent value="agents" className="flex-1 overflow-y-auto p-6 mt-0">
            {comparisonMode ? (
              <ComparisonView />
            ) : (
              <div className="grid gap-3">
                {run.agents?.map((agent) => {
                  const isExpanded = expandedAgents.has(agent.id);
                  const hasOutput = agentOutputs[agent.session || ""]?.length > 0;
                  const timeline = metricsTimeline[agent.id] || [];
                  const attempt = latestAttemptForAgent(agent.id);

                  return (
                    <Card key={agent.id} className="overflow-hidden">
                      <CardHeader
                        className="pb-3 cursor-pointer hover:bg-muted transition-colors"
                        onClick={() => toggleExpand(agent.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-foreground/40" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-foreground/40" />
                            )}
                            <TerminalIcon className="h-4 w-4 text-foreground/40" />
                            <div>
                              <CardTitle className="text-sm">{agent.name}</CardTitle>
                              <p className="text-[10px] text-foreground/40 font-mono">{agent.id}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {agent.emits && (
                              <Badge variant="ghost" className="text-[9px] bg-muted">
                                emits: {agent.emits}
                              </Badge>
                            )}
                            {attempt && (
                              <Badge variant="ghost" className="text-[9px] bg-cyan-500/10 text-cyan-300 border-cyan-500/20">
                                {attempt.phase}
                              </Badge>
                            )}
                            <StatusBadge status={agent.status as Status} size="sm" />
                            <span className="text-[10px] text-foreground/40 font-mono">
                              {formatDuration(agent.started, agent.completed)}
                            </span>
                            {agent.status === "error" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[9px]"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRetryAgent(agent.id);
                                }}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                retry
                              </Button>
                            )}
                          </div>
                        </div>
                        {timeline.length > 2 && !isExpanded && (
                          <div className="mt-2 flex items-center gap-2">
                            <Sparkline data={timeline} width={200} height={24} />
                            <span className="text-[9px] text-foreground/30">activity</span>
                          </div>
                        )}
                      </CardHeader>

                      {isExpanded && (
                        <CardContent className="space-y-3 border-t border-foreground/5 pt-3">
                          {/* details */}
                          <div className="grid grid-cols-4 gap-2 text-[10px]">
                            <div className="bg-muted rounded p-2">
                              <p className="text-foreground/40 uppercase">session</p>
                              <p className="font-mono truncate">{agent.session || "-"}</p>
                            </div>
                            <div className="bg-muted rounded p-2">
                              <p className="text-foreground/40 uppercase">started</p>
                              <p>{agent.started ? new Date(agent.started).toLocaleTimeString() : "-"}</p>
                            </div>
                            <div className="bg-muted rounded p-2">
                              <p className="text-foreground/40 uppercase">completed</p>
                              <p>{agent.completed ? new Date(agent.completed).toLocaleTimeString() : "-"}</p>
                            </div>
                            <div className="bg-muted rounded p-2">
                              <p className="text-foreground/40 uppercase">duration</p>
                              <p className="font-mono">{formatDuration(agent.started, agent.completed)}</p>
                            </div>
                          </div>

                          {attempt && (
                            <div className="grid grid-cols-4 gap-2 text-[10px]">
                              <div className="bg-muted rounded p-2">
                                <p className="text-foreground/40 uppercase">attempt phase</p>
                                <p className="font-mono truncate">{attempt.phase}</p>
                              </div>
                              <div className="bg-muted rounded p-2">
                                <p className="text-foreground/40 uppercase">terminal reason</p>
                                <p className="truncate">{formatAgentAttemptTerminalReason(attempt.terminalReason)}</p>
                                {attempt.terminalReason && (
                                  <p className="truncate font-mono text-[9px] text-foreground/40" title={attempt.terminalReason}>
                                    {attempt.terminalReason}
                                  </p>
                                )}
                                {attempt.terminalDetail && (
                                  <p className="mt-1 line-clamp-2 text-[9px] text-foreground/40" title={attempt.terminalDetail}>
                                    {attempt.terminalDetail}
                                  </p>
                                )}
                              </div>
                              <div className="bg-muted rounded p-2">
                                <p className="text-foreground/40 uppercase">process</p>
                                <p className="font-mono truncate">
                                  {attempt.processEvidence?.processPid
                                    ? `${attempt.processEvidence.processPid} / ${attempt.processEvidence.ptySessionId || "-"}`
                                    : "-"}
                                </p>
                              </div>
                              <div className="bg-muted rounded p-2">
                                <p className="text-foreground/40 uppercase">recovery decisions</p>
                                <p className="font-mono">{attempt.recoveryDecisionCount || 0}</p>
                              </div>
                            </div>
                          )}

                          {/* sparkline */}
                          {timeline.length > 2 && (
                            <div className="bg-muted rounded p-3">
                              <p className="text-[10px] text-foreground/40 uppercase mb-2">activity</p>
                              <Sparkline data={timeline} width={400} height={40} />
                            </div>
                          )}

                          {/* output preview */}
                          {hasOutput && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[10px] text-foreground/40 uppercase">output</p>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-[9px]"
                                    onClick={() => setSelectedAgent(agent.id)}
                                  >
                                    <Maximize2 className="h-3 w-3 mr-1" />
                                    full
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-[9px]"
                                    onClick={() => handleCopyOutput(agent.session || "")}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                              <div className="bg-card text-green-500 p-3 rounded font-mono text-xs h-32 overflow-y-auto">
                                <pre className="whitespace-pre-wrap">{agentOutputs[agent.session || ""]}</pre>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* output tab */}
          <TabsContent value="output" className="flex-1 overflow-hidden flex flex-col mt-0">
            <div className="flex-1 flex min-h-0">
              {/* agent list */}
              <div className="w-48 border-r border-foreground/5 overflow-y-auto p-2 space-y-1">
                <p className="text-[10px] text-foreground/40 uppercase px-2 mb-2">agents</p>
                {run.agents?.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                      selectedAgent === agent.id
                        ? "bg-primary/20 text-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      agent.status === "running" ? "bg-amber-400" :
                      agent.status === "complete" ? "bg-green-400" :
                      agent.status === "error" ? "bg-red-400" : "bg-gray-400"
                    }`} />
                    <span className="font-mono truncate flex-1">{agent.id}</span>
                  </button>
                ))}
              </div>

              {/* output viewer */}
              <div className="flex-1 flex flex-col min-h-0">
                {selectedAgent ? (() => {
                  const agent = run.agents?.find((a) => a.id === selectedAgent);
                  const output = agentOutputs[agent?.session || ""] || "";
                  const agentAlive = agent?.status === "running";
                  return (
                    <>
                      <div className="flex items-center justify-between px-4 py-2 border-b border-foreground/5">
                        <div className="flex items-center gap-2">
                          <TerminalIcon className="h-4 w-4 text-foreground/40" />
                          <span className="text-sm font-medium">{agent?.name}</span>
                          <StatusBadge status={(agent?.status || "pending") as Status} size="sm" />
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleCopyOutput(agent?.session || "")}>
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {agent?.session ? (
                          <TerminalPanel
                            session={agent.session}
                            sessionAlive={agentAlive}
                            fallbackOutput={output}
                            readOnly
                            compact
                          />
                        ) : (
                          <div className="h-full bg-card text-foreground/30 p-4 font-mono text-xs">
                            no session
                          </div>
                        )}
                      </div>
                    </>
                  );
                })() : (
                  <div className="flex-1 flex items-center justify-center text-foreground/30 text-xs">
                    select an agent to view output
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* triage tab */}
          <TabsContent value="triage" className="flex-1 overflow-y-auto p-6 mt-0">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TaskSquareFilled className="h-4 w-4 text-amber-300" />
                <p className="text-[10px] uppercase tracking-wider text-foreground/40">quality gate triage</p>
              </div>
              <Button
                size="xs"
                variant="ghost"
                onClick={fetchEventArtifacts}
                loading={eventArtifactsLoading}
              >
                <RotateCcw className="h-3 w-3" />
                refresh
              </Button>
            </div>

            {eventArtifactError && (
              <div className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {eventArtifactError}
              </div>
            )}

            {eventArtifactsLoading && eventArtifacts.length === 0 ? (
              <div className="rounded-md bg-muted p-4 text-xs text-foreground/40">
                loading triage artifacts...
              </div>
            ) : eventArtifacts.length === 0 ? (
              <div className="rounded-md bg-muted p-4 text-xs text-foreground/40">
                no triage artifacts
              </div>
            ) : (
              <div className="grid gap-3">
                {eventArtifacts.map((execution) => {
                  const gate = execution.artifact?.qualityGate;
                  const draft = execution.draftTask || execution.artifact?.generated;
                  const subtasks = draft?.subtasks || [];
                  const canApply = execution.status === "awaiting_review" && Boolean(run.taskId);

                  return (
                    <Card key={execution.id} className="overflow-hidden">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <DocumentTextFilled className="h-4 w-4 text-foreground/40" />
                              <CardTitle className="truncate text-sm">
                                {draft?.title || execution.mappingId}
                              </CardTitle>
                              <Badge variant="ghost" className="bg-muted text-[9px]">
                                {execution.status}
                              </Badge>
                            </div>
                            <p className="mt-1 font-mono text-[10px] text-foreground/40">
                              {execution.id}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant={canApply ? "default" : "secondary"}
                            className="h-7 text-[10px]"
                            disabled={!canApply}
                            loading={applyingExecutionId === execution.id}
                            onClick={() => handleApplyEventArtifact(execution.id)}
                          >
                            <TaskSquareFilled className="h-3 w-3" />
                            apply
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 border-t border-foreground/5 pt-3">
                        <div className="grid gap-2 md:grid-cols-3">
                          <div className="rounded-md bg-muted p-2">
                            <p className="text-[10px] uppercase text-foreground/40">reason</p>
                            <p className="mt-1 text-xs">{gate?.reason || execution.event}</p>
                          </div>
                          <div className="rounded-md bg-muted p-2">
                            <p className="text-[10px] uppercase text-foreground/40">artifact</p>
                            <p className="mt-1 truncate font-mono text-xs">{execution.artifactName || "-"}</p>
                          </div>
                          <div className="rounded-md bg-muted p-2">
                            <p className="text-[10px] uppercase text-foreground/40">draft</p>
                            <p className="mt-1 truncate font-mono text-xs">{execution.draftTaskName || "-"}</p>
                          </div>
                        </div>

                        {Array.isArray(gate?.findings) && gate.findings.length > 0 && (
                          <div>
                            <p className="mb-2 text-[10px] uppercase text-foreground/40">findings</p>
                            <div className="grid gap-1">
                              {gate.findings.slice(0, 5).map((finding, index) => (
                                <div key={`${execution.id}-finding-${index}`} className="rounded bg-muted px-2 py-1 text-xs">
                                  {finding}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {subtasks.length > 0 && (
                          <div>
                            <p className="mb-2 text-[10px] uppercase text-foreground/40">draft tasks</p>
                            <div className="grid gap-1">
                              {subtasks.slice(0, 6).map((task, index) => (
                                <div
                                  key={`${execution.id}-task-${index}`}
                                  className="flex items-center justify-between rounded bg-muted px-2 py-1 text-xs"
                                >
                                  <span className="truncate">{task.title || `task ${index + 1}`}</span>
                                  <span className="ml-2 font-mono text-[10px] text-foreground/40">
                                    {task.type || "task"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* metrics tab */}
          <TabsContent value="metrics" className="flex-1 overflow-y-auto p-6 mt-0">
            <div className="grid grid-cols-4 gap-4 mb-6">
              <Card className="bg-muted">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="h-4 w-4 text-foreground/40" />
                    <p className="text-[10px] text-foreground/40 uppercase">duration</p>
                  </div>
                  <p className="text-lg font-mono">{formatDuration(run.started, run.completed)}</p>
                </CardContent>
              </Card>
              <Card className="bg-muted">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Zap className="h-4 w-4 text-foreground/40" />
                    <p className="text-[10px] text-foreground/40 uppercase">progress</p>
                  </div>
                  <p className="text-lg font-mono">{completedAgents}/{totalAgents}</p>
                  <div className="w-full bg-accent rounded-full h-1 mt-2">
                    <div
                      className="bg-green-500 h-1 rounded-full transition-all"
                      style={{ width: `${totalAgents > 0 ? (completedAgents / totalAgents) * 100 : 0}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-muted">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Cpu className="h-4 w-4 text-foreground/40" />
                    <p className="text-[10px] text-foreground/40 uppercase">active agents</p>
                  </div>
                  <p className="text-lg font-mono">
                    {run.agents?.filter((a) => a.status === "running").length || 0}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className="h-4 w-4 text-green-400/60" />
                    <p className="text-[10px] text-foreground/40 uppercase">estimated cost</p>
                  </div>
                  <p className="text-lg font-mono text-green-400">
                    $0.0000
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* agent metrics */}
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-3 px-1">
                agent metrics
              </p>
              <div className="grid gap-2">
                {run.agents?.map((agent) => {
                  const timeline = metricsTimeline[agent.id] || [];
                  return (
                    <div key={agent.id} className="bg-muted rounded-md p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{agent.name}</span>
                          <StatusBadge status={agent.status as Status} size="sm" />
                        </div>
                        <span className="text-[10px] text-foreground/40 font-mono">
                          {formatDuration(agent.started, agent.completed)}
                        </span>
                      </div>
                      {timeline.length > 2 ? (
                        <Sparkline data={timeline} width={400} height={32} />
                      ) : (
                        <div className="h-8 flex items-center text-[9px] text-foreground/30">
                          no activity data yet
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* timeline tab */}
          <TabsContent value="timeline" className="flex-1 overflow-y-auto p-6 mt-0">
            <div>
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-3 px-1">
                execution timeline
              </p>
              <div className="relative">
                {/* timeline line */}
                <div className="absolute left-2 top-0 bottom-0 w-px bg-accent" />

                <div className="space-y-4">
                  {/* run start */}
                  <div className="relative pl-8">
                    <div className="absolute left-0 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                      <Play className="h-2 w-2 text-white" />
                    </div>
                    <div className="bg-muted rounded-md p-3">
                      <p className="text-xs font-medium">run started</p>
                      <p className="text-[10px] text-foreground/40">{new Date(run.started).toLocaleString()}</p>
                    </div>
                  </div>

                  {/* agents */}
                  {run.agents?.map((agent) => {
                    const isComplete = agent.status === "complete";
                    const isError = agent.status === "error";
                    const isRunning = agent.status === "running";

                    return (
                      <div key={agent.id} className="relative pl-8">
                        <div className={`absolute left-0 w-4 h-4 rounded-full flex items-center justify-center ${
                          isComplete ? "bg-green-500" :
                          isError ? "bg-red-500" :
                          isRunning ? "bg-amber-500 animate-pulse" : "bg-gray-500"
                        }`}>
                          {isComplete && <CheckCircle2 className="h-2 w-2 text-white" />}
                          {isError && <XCircle className="h-2 w-2 text-white" />}
                          {isRunning && <Zap className="h-2 w-2 text-white" />}
                        </div>
                        <div className="bg-muted rounded-md p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium">{agent.name}</p>
                            <StatusBadge status={agent.status as Status} size="sm" />
                          </div>
                          <p className="text-[10px] text-foreground/40 font-mono">{agent.id}</p>
                          {agent.started && (
                            <p className="text-[10px] text-foreground/30 mt-1">
                              started: {new Date(agent.started).toLocaleTimeString()}
                              {agent.completed && ` → completed: ${new Date(agent.completed).toLocaleTimeString()}`}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* run end */}
                  {run.completed && (
                    <div className="relative pl-8">
                      <div className="absolute left-0 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                        <CheckCircle2 className="h-2 w-2 text-white" />
                      </div>
                      <div className="bg-muted rounded-md p-3">
                        <p className="text-xs font-medium">run completed</p>
                        <p className="text-[10px] text-foreground/40">{new Date(run.completed).toLocaleString()}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
