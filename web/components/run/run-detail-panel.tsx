"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRunNotifications, notifyAgentEvent } from "@/hooks/use-notifications-listener";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkflowAgent } from "@/components/ui/workflow-card";
import { StatusBadge, type Status } from "@/components/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageList,
  type ConversationMessage,
} from "@/components/conversation/message-renderer";
import Link from "next/link";
import {
  PlayFilled as Play,
  PauseFilled as Pause,
  ArrowDownFilled as ArrowDown,
  ClockFilled as Clock,
  ComponentFilled as Cpu,
  FlashFilled as Zap,
  InfoCircleFilled as AlertCircle,
  CommandSquareFilled as Terminal,
  CopyFilled as Copy,
  Element3Filled as MoreVertical,
  CloseCircleFilled as XCircle,
  RotateRightFilled as RotateCw,
  SettingsFilled as Wrench,
  RefreshFilled as RefreshCw,
  TrashFilled as Trash2,
  DocumentDownloadFilled as Download,
  Star1Filled as DollarSign,
  StopFilled as Square,
  CheckFilled as Check,
  CloseCircleFilled as X,
} from "@aliimam/icons";
import { ArrowLeftFilled, ArrowDown1Filled, ArrowRight1Filled, TaskSquareFilled } from "@aliimam/icons";
import { CopyButton } from "@/components/ui/copy-button";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { PeerSplitView } from "@/components/terminal/peer-split-view";
import { LinkRunTimeline } from "@/components/run/link-run-timeline";
import { Markdown } from "@/components/ui/markdown";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { unwrapApiData, getApiErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface RunAgent extends Omit<WorkflowAgent, "emits"> {
  emits?: string;
  lastHeartbeat?: string;
  lastMessage?: string;
  isStale?: boolean;
  msSinceHeartbeat?: number | null;
}

interface RunArtifact {
  agentId: string;
  type: string;
  path: string;
  timestamp: string;
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
  taskId?: string;
  artifacts?: RunArtifact[];
  workspacePath?: string;
  debug?: boolean;
  type?: string;
  linkId?: string;
  linkName?: string;
  mode?: string;
  rounds?: number;
  workspaceId?: string;
  managerSession?: string;
  escalations?: Array<{
    id: string;
    round: number;
    trigger: string;
    haiku_summary?: string;
    human_reply?: string;
  }>;
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

interface FileChange { status: string; file: string; }
interface ActivityToolCall { name: string; label: string; input: Record<string, unknown>; }
interface ActivityMessage { role: string; content: string; toolCalls?: ActivityToolCall[]; ts?: string; }
interface ActivityConversation { path: string; messages: ActivityMessage[]; }
interface AgentActivityEvent { agent_id: string; agent_name: string; event: string; session: string; timestamp: string; }
interface AgentSummary {
  status?: string;
  executiveSummary?: string;
  workCompleted?: string[];
  artifactsProduced?: string[];
  codeChanges?: string[];
  findings?: string[];
  risks?: string[];
  nextAgentHints?: string[];
}
interface AgentActivity {
  diff: string | null;
  filesChanged: FileChange[];
  conversations: ActivityConversation[];
  output: string | null;
  event: AgentActivityEvent | null;
  summary: AgentSummary | null;
  summaryMarkdown: string | null;
}

interface RunCost {
  runId: string;
  chainName: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  totalCostDisplay: string;
  agentBreakdown: Array<{
    agentId: string;
    agentName?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    costDisplay: string;
  }>;
}

function AgentTimeline({ run }: { run: Run }) {
  const agents = (run.agents || []).filter(a => a.completed);
  if (agents.length === 0) return null;

  const runStart = run.started ? new Date(run.started).getTime() : null;
  const times = agents.map(a => new Date(a.completed!).getTime());
  const earliest = runStart ?? Math.min(...times);
  const latest = Math.max(...times);
  const span = latest - earliest;
  if (span <= 0) return null;

  const statusColor = (status: string) =>
    status === "complete" ? "bg-green-500" :
    status === "error" ? "bg-red-500" :
    status === "cancelled" ? "bg-foreground/20" :
    "bg-amber-400";

  return (
    <div className="mb-4 max-w-4xl">
      <p className="text-[10px] text-foreground/30 uppercase mb-2">execution timeline</p>
      <div className="relative h-6 bg-card rounded-sm overflow-visible">
        {/* track */}
        <div className="absolute inset-y-0 left-0 right-0 flex items-center">
          <div className="w-full h-px bg-foreground/10" />
        </div>
        {/* agent pips */}
        {agents.map((agent) => {
          const t = new Date(agent.completed!).getTime();
          const pct = ((t - earliest) / span) * 100;
          return (
            <div
              key={agent.id}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group"
              style={{ left: `${Math.max(1, Math.min(99, pct))}%` }}
            >
              <div className={`w-2 h-2 rounded-full ${statusColor(agent.status)} ring-1 ring-background`} />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-card border border-foreground/10 rounded px-1.5 py-0.5 text-[9px] whitespace-nowrap shadow-lg">
                  <span className="text-foreground/80">{agent.name || agent.id}</span>
                  <span className="text-foreground/30 ml-1">{new Date(agent.completed!).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-foreground/20 mt-1">
        <span>{new Date(earliest).toLocaleTimeString()}</span>
        <span>{new Date(latest).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

function renderMarkdownBlock(text: string) {
  return <Markdown content={text} compact />;
}

function GoalContent({ goal }: { goal: string }) {
  const lines = goal.split("\n");
  const metaFields: { key: string; value: string }[] = [];
  const bodyLines: string[] = [];
  let pastMeta = false;

  for (const line of lines) {
    if (!pastMeta) {
      const m = line.match(/^(TASK ID|TITLE|TYPE|PRIORITY|ASSIGNEE):\s*(.*)$/);
      if (m) { metaFields.push({ key: m[1], value: m[2] }); continue; }
      if (line.trim() === "" && metaFields.length > 0) { pastMeta = true; continue; }
      if (metaFields.length === 0) pastMeta = true;
    }
    bodyLines.push(line);
  }

  const body = bodyLines.join("\n").trim();

  return (
    <div className="space-y-5">
      {metaFields.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {metaFields.map(({ key, value }) => (
            <div key={key} className="flex items-center gap-1.5 text-xs">
              <span className="text-foreground/30 uppercase text-[10px] tracking-wide">{key}</span>
              {key === "TASK ID" ? (
                <a
                  href={`/tasks?task=${encodeURIComponent(value)}`}
                  className="text-foreground/80 font-medium hover:text-cyan-400 transition-colors font-mono"
                >
                  {value}
                </a>
              ) : (
                <span className="text-foreground/80 font-medium">{value}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {body && (
        <div className="text-sm text-foreground/75 leading-relaxed space-y-4">
          {body.split(/\n{2,}/).map((block, i) => {
            const sectionMatch = block.match(/^([A-Z][A-Za-z ]+):\s*\n([\s\S]*)$/);
            if (sectionMatch) {
              return (
                <div key={i}>
                  <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2">{sectionMatch[1]}</p>
                  <div className="text-foreground/75 space-y-1">{renderMarkdownBlock(sectionMatch[2].trim())}</div>
                </div>
              );
            }
            return <div key={i}>{renderMarkdownBlock(block)}</div>;
          })}
        </div>
      )}
    </div>
  );
}

interface RunDetailPanelProps {
  runId: string;
  onBack?: () => void;
  onDelete?: () => void;
}

export function RunDetailPanel({ runId, onBack, onDelete }: RunDetailPanelProps) {
  useRunNotifications(runId);
  const { fetchWithNamespace } = useNamespaceFetch();
  const router = useRouter();

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [agentOutputs, setAgentOutputs] = useState<Record<string, string>>({});
  const [metricsTimeline, setMetricsTimeline] = useState<Record<string, MetricPoint[]>>({});
  const [debugPaused, setDebugPaused] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentConversations, setAgentConversations] = useState<Record<string, string | null>>({});
  const [agentMessages, setAgentMessages] = useState<Record<string, ConversationMessage[]>>({});
  const [agentMsgTotals, setAgentMsgTotals] = useState<Record<string, number>>({});
  const [showToolResults, setShowToolResults] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [outputView, setOutputView] = useState<"conversation" | "terminal">("conversation");
  const [agentActivity, setAgentActivity] = useState<Record<string, AgentActivity | null>>({});
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const [costData, setCostData] = useState<RunCost | null>(null);
  const [approvalReason, setApprovalReason] = useState("");
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const metricsRef = useRef<Record<string, MetricPoint[]>>({});
  const outputsRef = useRef<Record<string, string>>({});
  const expandedAgentsRef = useRef<Set<string>>(new Set());
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const outputBottomRef = useRef<HTMLDivElement>(null);
  const outputNearBottomRef = useRef(true);
  const prevAgentTotalsRef = useRef<Record<string, number>>({});
  const outputAutoTerminalRef = useRef<Record<string, boolean>>({});
  const conversationLookupAttemptsRef = useRef<Record<string, number>>({});

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}`);
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ run?: Run }>(raw);
        setRun(data.run || null);
      }
    } catch (e) {
      console.error("failed to fetch run", e);
    } finally {
      setLoading(false);
    }
  }, [runId, fetchWithNamespace]);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/status`);
      if (!res.ok) return;
      const raw = await res.json();
      const data = unwrapApiData<{ status?: string; completed?: string; agents?: Array<{ id: string; status: string; session: string }> }>(raw);
      setRun((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: data.status || prev.status,
          completed: data.completed || prev.completed,
          agents: (prev.agents || []).map((agent) => {
            const live = (data.agents || []).find((a: { id: string }) => a.id === agent.id);
            return live ? { ...agent, status: live.status, session: live.session } : agent;
          }),
        };
      });
    } catch {
      // fall back to full fetch on error
    }
  }, [runId, fetchWithNamespace]);

  const fetchAgentActivity = useCallback(async (agentId: string) => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/agents/${encodeURIComponent(agentId)}/activity`);
      const raw = res.ok ? await res.json() : null;
      const data = raw ? unwrapApiData<AgentActivity>(raw) : null;
      setAgentActivity((prev) => ({ ...prev, [agentId]: data }));
    } catch {
      setAgentActivity((prev) => ({ ...prev, [agentId]: null }));
    }
  }, [runId, fetchWithNamespace]);

  const fetchAgentOutput = useCallback(async (_agentId: string, session: string) => {
    try {
      const res = await fetchWithNamespace(`/api/agents/${encodeURIComponent(session)}/output`);
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ output?: string }>(raw);
        const newOutput = data.output || "";
        if (newOutput !== outputsRef.current[session]) {
          outputsRef.current[session] = newOutput;
          setAgentOutputs({ ...outputsRef.current });
        }
      }
    } catch (e) {
      console.error("failed to fetch output", e);
    }
  }, [fetchWithNamespace]);

  const findAgentConversation = useCallback(async (agentName: string, agentId: string) => {
    try {
      const params = new URLSearchParams({
        name: agentName,
        since: run?.started || "",
      });
      if (run?.id) params.set("runId", run.id);
      if (agentId) params.set("agentId", agentId);
      if (run?.workspacePath) params.set("cwd", run.workspacePath);

      const res = await fetchWithNamespace(
        `/api/conversations/find-by-agent?${params.toString()}`
      );
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ conversationId?: string }>(raw);
        setAgentConversations((prev) => ({ ...prev, [agentId]: data.conversationId || null }));
      }
    } catch {
      setAgentConversations((prev) => ({ ...prev, [agentId]: null }));
    }
  }, [run?.id, run?.started, run?.workspacePath, fetchWithNamespace]);

  const fetchAgentMessages = useCallback(async (agentId: string) => {
    const conversationId = agentConversations[agentId];
    if (!conversationId) return;

    try {
      const cwdParam = run?.workspacePath ? `&cwd=${encodeURIComponent(run.workspacePath)}` : "";
      const res = await fetchWithNamespace(`/api/conversations/${conversationId}?mode=tail&tail=100${cwdParam}`);
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ total?: number; messages?: ConversationMessage[] }>(raw);
        const newTotal = data.total || 0;
        if (newTotal === prevAgentTotalsRef.current[agentId] && prevAgentTotalsRef.current[agentId] > 0) {
          return;
        }
        prevAgentTotalsRef.current[agentId] = newTotal;
        setAgentMessages((prev) => ({ ...prev, [agentId]: data.messages || [] }));
        setAgentMsgTotals((prev) => ({ ...prev, [agentId]: newTotal }));
      }
    } catch {
      // ignore
    }
  }, [agentConversations, run?.workspacePath, fetchWithNamespace]);

  const fetchCost = useCallback(async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/cost`);
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<RunCost>(raw);
        setCostData(data);
      }
    } catch {
      setCostData(null);
    }
  }, [runId, fetchWithNamespace]);

  useEffect(() => {
    if (!selectedAgent || !run) return;
    const agent = run.agents?.find((a) => a.id === selectedAgent);
    if (!agent) return;

    const currentConversation = agentConversations[selectedAgent];
    const hasConversation = !!(currentConversation && (agentMessages[selectedAgent]?.length ?? 0) > 0);
    if (hasConversation) {
      conversationLookupAttemptsRef.current[selectedAgent] = 0;
      delete outputAutoTerminalRef.current[selectedAgent];
      return;
    }

    const attempt = (conversationLookupAttemptsRef.current[selectedAgent] || 0) + 1;
    if (attempt > 8) {
      if (agentConversations[selectedAgent] === undefined) {
        setAgentConversations((prev) => ({ ...prev, [selectedAgent]: null }));
      }
      return;
    }
    conversationLookupAttemptsRef.current[selectedAgent] = attempt;

    const retryMs = attempt === 1 ? 0 : Math.min(1000 * attempt, 6000);
    const timeout = setTimeout(() => {
      if (!selectedAgent) return;
      findAgentConversation(agent.name || agent.id, selectedAgent);
    }, retryMs);

    return () => clearTimeout(timeout);
  }, [
    run,
    selectedAgent,
    run?.id,
    run?.started,
    run?.workspacePath,
    run?.agents,
    agentConversations,
    agentMessages,
    findAgentConversation,
  ]);

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
          if (eventData.status === "complete") {
            notifyAgentEvent({ type: "agent_complete", title: "Agent completed", message: eventData.agent_id, metadata: { agentId: eventData.agent_id, runId } });
            // refresh activity if agent is expanded, otherwise invalidate cache
            const completedId = eventData.agent_id;
            setAgentActivity((prev) => {
              const next = { ...prev };
              delete next[completedId];
              return next;
            });
            // re-fetch if currently expanded (use ref to avoid stale closure)
            if (expandedAgentsRef.current.has(completedId)) {
              setTimeout(() => fetchAgentActivity(completedId), 1000);
            }
          } else if (eventData.status === "error" || eventData.status === "failed") {
            notifyAgentEvent({ type: "agent_error", title: "Agent failed", message: eventData.agent_id, metadata: { agentId: eventData.agent_id, runId } });
          }
          const agentId = eventData.agent_id;
          if (!metricsRef.current[agentId]) metricsRef.current[agentId] = [];
          metricsRef.current[agentId].push({ timestamp: Date.now(), value: eventData.status === "running" ? 1 : eventData.status === "complete" ? 0.5 : 0 });
          if (metricsRef.current[agentId].length > 100) metricsRef.current[agentId] = metricsRef.current[agentId].slice(-100);
          setMetricsTimeline({ ...metricsRef.current });
        }
      } catch {}
    });
    eventSourceRef.current = eventSource;
    return () => { eventSource.close(); };
  }, [runId, debugPaused, fetchAgentActivity]);

  useEffect(() => {
    fetchRun();
    const interval = setInterval(pollStatus, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRun]);

  // convert activity messages (captured artifacts) to ConversationMessage format
  const activityToMessages = useCallback((activity: AgentActivity): ConversationMessage[] => {
    const msgs: ConversationMessage[] = [];
    for (const conv of activity.conversations) {
      for (const m of conv.messages) {
        if (m.content) {
          msgs.push({ type: m.role as "user" | "assistant", timestamp: m.ts, text: m.content });
        }
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            msgs.push({ type: "tool_use", timestamp: m.ts, toolName: tc.name, toolInput: tc.input });
          }
        }
      }
    }
    return msgs;
  }, []);

  useEffect(() => {
    if (selectedAgent && run) {
      const agent = run.agents?.find((a) => a.id === selectedAgent);
      if (agent) {
        if (agent.session) fetchAgentOutput(selectedAgent, agent.session);
      }
    }
  }, [selectedAgent, run, fetchAgentOutput]);

  useEffect(() => {
    if (!selectedAgent) return;
    const conversationId = agentConversations[selectedAgent];
    if (!conversationId) return;
    fetchAgentMessages(selectedAgent);
    const interval = setInterval(() => fetchAgentMessages(selectedAgent), 3000);
    return () => clearInterval(interval);
  }, [selectedAgent, agentConversations, fetchAgentMessages]);

  // fallback: when live conversation not found, load from captured artifacts
  useEffect(() => {
    if (!selectedAgent || !run) return;
    const agent = run.agents?.find((a) => a.id === selectedAgent);
    if (!agent) return;
    if (agentConversations[selectedAgent] !== null) return;
    // already have messages from a previous fallback
    if ((agentMessages[selectedAgent]?.length ?? 0) > 0) return;

    // fetch activity artifacts if not already loaded
    const activity = agentActivity[selectedAgent];
    if (activity === undefined) {
      fetchAgentActivity(selectedAgent);
      return;
    }
    if (!activity) return;

    // convert captured conversations to output tab format
    if (activity.conversations.length > 0) {
      const msgs = activityToMessages(activity);
      if (msgs.length > 0) {
        setAgentMessages((prev) => ({ ...prev, [selectedAgent]: msgs }));
        setAgentMsgTotals((prev) => ({ ...prev, [selectedAgent]: msgs.length }));
        // mark as having conversation so MessageList renders
        setAgentConversations((prev) => ({ ...prev, [selectedAgent]: "artifact" }));
      }
    }
    // also load captured output as fallback for raw output display
    if (activity.output && agent.session) {
      const session = agent.session;
      if (!outputsRef.current[session]) {
        outputsRef.current[session] = activity.output;
        setAgentOutputs({ ...outputsRef.current });
      }
    }
  }, [selectedAgent, run, agentConversations, agentMessages, agentActivity, fetchAgentActivity, activityToMessages]);

  // auto-switch to terminal view for live agents without conversation data
  // (raw pty output looks corrupt when rendered as plain text)
  useEffect(() => {
    if (!selectedAgent || !run) return;
    const agent = run.agents?.find((a) => a.id === selectedAgent);
    if (!agent?.session) return;
    const isAlive = agent.status === "running";
    const hasConv = agentConversations[selectedAgent] && (agentMessages[selectedAgent]?.length ?? 0) > 0;
    if (isAlive && !hasConv && outputView === "conversation") {
      outputAutoTerminalRef.current[selectedAgent] = true;
      setOutputView("terminal");
      return;
    }

    if (!isAlive || !hasConv) return;
    if (outputView === "terminal" && outputAutoTerminalRef.current[selectedAgent]) {
      delete outputAutoTerminalRef.current[selectedAgent];
      setOutputView("conversation");
    }
  }, [selectedAgent, run, agentConversations, agentMessages, outputView]);

  useEffect(() => {
    fetchCost();
  }, [fetchCost]);

  const checkOutputScrollPosition = useCallback(() => {
    const container = outputScrollRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
    outputNearBottomRef.current = nearBottom;
    // Disable auto-scroll if user manually scrolled up
    if (!nearBottom && autoScrollEnabled) {
      setAutoScrollEnabled(false);
    }
  }, [autoScrollEnabled]);

  const scrollToBottom = useCallback(() => {
    if (outputBottomRef.current) {
      outputBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
    setAutoScrollEnabled(true);
  }, []);

  useEffect(() => {
    if (autoScrollEnabled && outputNearBottomRef.current && outputBottomRef.current) {
      outputBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [agentMessages, agentOutputs, autoScrollEnabled]);

  // Auto-enable scroll when agent is running
  useEffect(() => {
    if (!run) return;
    const agent = run.agents?.find((a) => a.id === selectedAgent);
    if (agent?.status === "running" && !autoScrollEnabled) {
      setAutoScrollEnabled(true);
    }
  }, [selectedAgent, run, run?.agents, autoScrollEnabled]);

  const toggleExpand = (agentId: string) => {
    const newExpanded = new Set(expandedAgents);
    if (newExpanded.has(agentId)) {
      newExpanded.delete(agentId);
    } else {
      newExpanded.add(agentId);
      if (agentActivity[agentId] === undefined) {
        fetchAgentActivity(agentId);
      }
    }
    expandedAgentsRef.current = newExpanded;
    setExpandedAgents(newExpanded);
  };

  const toggleDiff = (agentId: string) => {
    const next = new Set(expandedDiffs);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    setExpandedDiffs(next);
  };

  const formatDuration = (start?: string, end?: string) => {
    if (!start) return "-";
    const diff = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
    return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
  };

  const handleCopyOutput = (sessionId: string) => {
    copyToClipboard(agentOutputs[sessionId] || "");
  };

  const handleStop = async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/stop`, { method: "POST" });
      if (res.ok) {
        // refetch full run to get updated agent statuses
        const runRes = await fetchWithNamespace(`/api/runs/${runId}`);
        if (runRes.ok) {
          const updated = await runRes.json() as { run: Run };
          setRun(updated.run);
        } else {
          setRun((prev) => prev ? { ...prev, status: "stopped", completed: new Date().toISOString() } : prev);
        }
      } else {
        console.error("failed to stop run:", res.status);
      }
    } catch (e) {
      console.error("failed to stop run:", e);
    }
  };

  const handleCleanup = async () => {
    try {
      await fetchWithNamespace(`/api/runs/${runId}/stop`, { method: "POST" });
      // refetch to get updated agent statuses
      const runRes = await fetchWithNamespace(`/api/runs/${runId}`);
      if (runRes.ok) {
        const updated = await runRes.json() as { run: Run };
        setRun(updated.run);
      }
    } catch (e) {
      console.error("failed to clean up run:", e);
    }
  };

  const handleStopLinkRun = async () => {
    if (!run?.id) return;
    try {
      await fetchWithNamespace(`/api/links/runs/${encodeURIComponent(run.id)}/stop`, {
        method: "POST",
      });
      // refresh run data
      fetchRun();
    } catch {
      // stop failure is visible in UI via status not changing
    }
  };

  const handleCancel = async () => {
    const res = await fetchWithNamespace(`/api/runs/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    if (res.ok) {
      const updated = await res.json() as { run: Run };
      setRun(updated.run);
    }
  };

  const handleResume = async () => {
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/resume`, { method: "POST" });
      if (res.ok) {
        // refetch the run to get updated state
        const runRes = await fetchWithNamespace(`/api/runs/${runId}`);
        if (runRes.ok) {
          const updated = await runRes.json() as { run: Run };
          setRun(updated.run);
        }
      } else {
        const raw = await res.json().catch(() => ({ error: "Resume failed" }));
        console.error("failed to resume run:", getApiErrorMessage(raw, "Resume failed"));
      }
    } catch (e) {
      console.error("failed to resume run:", e);
    }
  };

  const handleDelete = async () => {
    const res = await fetchWithNamespace(`/api/runs/${runId}`, { method: "DELETE" });
    if (res.ok) onDelete?.();
  };

  const handleRerun = async () => {
    if (!run) return;

    // link runs rerun via the links API
    if (run.type === "link" && run.linkId) {
      const res = await fetchWithNamespace("/api/links/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkId: run.linkId,
          goalOverride: run.goal || "",
          ...(run.workspaceId && { workspaceId: run.workspaceId }),
          ...(run.taskId && { taskId: run.taskId }),
        }),
      });
      if (res.ok) {
        const data = await res.json() as { data?: { runId?: string } };
        const newRunId = data?.data?.runId;
        if (newRunId) router.push(`/runs?runId=${newRunId}`);
      } else {
        console.error("failed to rerun link:", res.status);
      }
      return;
    }

    // chain runs rerun via the chains API
    const chainId = run.chainId || run.chain.toLowerCase().replace(/\s+/g, "-");
    const chainRes = await fetchWithNamespace(`/api/chains/${encodeURIComponent(chainId)}`);
    if (!chainRes.ok) {
      console.error("failed to fetch chain for rerun:", chainRes.status);
      return;
    }
    const chainData = await chainRes.json() as { chain?: unknown };
    const { chain } = chainData;
    if (!chain) {
      console.error("chain not found for rerun");
      return;
    }

    const res = await fetchWithNamespace("/api/chains/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain,
        chainId,
        userPrompt: run.goal || "",
        ...(run.workspacePath && { workspacePath: run.workspacePath }),
        ...(run.taskId && { taskId: run.taskId }),
        ...(run.debug && { debug: true }),
      }),
    });
    if (res.ok) {
      const data = await res.json() as { runId?: string };
      if (data.runId) {
        router.push(`/runs?runId=${data.runId}`);
      }
    } else {
      console.error("failed to rerun:", res.status);
    }
  };

  const handleDownloadLog = async () => {
    if (!run) return;

    try {
      // Fetch output text
      const outputRes = await fetchWithNamespace(`/api/runs/${runId}/output`);
      const outputText = outputRes.ok ? await outputRes.text() : "(No output available)";

      // Build markdown content
      const md: string[] = [
        `# Run: ${run.chain} - ${run.status.toUpperCase()}`,
        "",
        `**Run ID:** \`${run.id}\``,
        `**Started:** ${new Date(run.started).toLocaleString()}`,
        run.completed ? `**Completed:** ${new Date(run.completed).toLocaleString()}` : "",
        run.taskId ? `**Task:** ${run.taskId}` : "",
        "",
        "## Goal",
        "",
        run.goal || "(No goal specified)",
        "",
        "## Agents",
        "",
        "| Agent | Status | Started | Completed |",
        "|-------|--------|---------|-----------|",
      ];

      // Add agent table rows
      run.agents.forEach((agent) => {
        const started = agent.started ? new Date(agent.started).toLocaleTimeString() : "-";
        const completed = agent.completed ? new Date(agent.completed).toLocaleTimeString() : "-";
        md.push(`| ${agent.name} | ${agent.status} | ${started} | ${completed} |`);
      });

      md.push("", "## Output", "", "```", outputText, "```", "");

      // Create blob and download
      const blob = new Blob([md.join("\n")], { type: "text/markdown" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${run.chain}-${runId.slice(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      // ignore download errors
    }
  };

  const handleCopyRunId = () => {
    copyToClipboard(runId);
  };

  const handleApproval = async (action: "approve" | "reject") => {
    setSubmittingApproval(true);
    try {
      const res = await fetchWithNamespace(`/api/runs/${runId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: approvalReason || undefined }),
      });
      if (res.ok) {
        setApprovalReason("");
        fetchRun();
      }
    } catch {
      console.error("approval failed");
    } finally {
      setSubmittingApproval(false);
    }
  };

  const isActive = run?.status === "running" || run?.status === "pending";
  const isWaitingApproval = run?.status === "waiting_approval";
  const isLinkRun = run?.type === "link";
  const completedAgents = run?.agents?.filter((a) => a.status === "complete").length || 0;
  const totalAgents = run?.agents?.length || 0;

  // detect stale state: run is stopped/done but agents are still running/pending
  const hasStaleAgents = !isActive && run?.agents?.some(
    (a) => a.status === "running" || a.status === "pending"
  );

  // detect resumable: run is not active and has incomplete agents (not all completed)
  const hasIncompleteAgents = !isActive && run?.agents?.some(
    (a) => a.status !== "complete"
  );

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
        <polyline fill="none" stroke="url(#sparkline-gradient)" strokeWidth="2" points={points} />
        <defs>
          <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="1" />
          </linearGradient>
        </defs>
      </svg>
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
        {onBack && (
          <Button size="sm" variant="secondary" onClick={onBack}>back to runs</Button>
        )}
      </div>
    );
  }

  // Link run rendering
  if (isLinkRun) {
    if (isActive) {
      // Live link run - show PeerSplitView
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                {onBack && (
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onBack}>
                    <ArrowLeftFilled className="h-4 w-4" />
                  </Button>
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{run.goal}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{run.linkName || run.chain}</span>
                    <span>|</span>
                    <span>{run.mode || "collaboration"}</span>
                    <span>|</span>
                    <span>{run.agents?.length || 2} agents</span>
                  </div>
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-400/10 px-3"
              onClick={handleStopLinkRun}
            >
              Stop
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <PeerSplitView
              sessionA={run.agents?.[0]?.session || ""}
              sessionB={run.agents?.[1]?.session || ""}
              managerSession={run.managerSession || ""}
              labelA={run.agents?.[0]?.name || "Agent 1"}
              labelB={run.agents?.[1]?.name || "Agent 2"}
              runId={run.id}
            />
          </div>
        </div>
      );
    }
    // completed link runs get their own timeline view
    return (
      <LinkRunTimeline
        run={run}
        onBack={onBack}
        onDelete={handleDelete}
        onRerun={handleRerun}
      />
    );
  }

  // Normal chain run rendering
  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* header */}
      <DetailHeader className="mx-3 mt-2 shrink-0">
        <div className="relative flex items-center gap-3">
          {onBack && (
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onBack}>
              <ArrowLeftFilled className="h-4 w-4" />
            </Button>
          )}
          <div>
            <div className="flex items-center gap-2">
              {run.chainId ? (
                <Link href={`/chains/${encodeURIComponent(run.chainId)}/edit`} className="text-sm font-bold tracking-tighter hover:text-cyan-400 transition-colors">
                  {run.chain}
                </Link>
              ) : (
                <span className="text-sm font-bold tracking-tighter">{run.chain}</span>
              )}
              <StatusBadge status={run.status as Status} size="sm" />
              {connected && isActive && (
                <Badge variant="ghost" className="text-[9px] bg-green-500/10 text-green-400">live</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <CopyButton value={runId} fullValue={run} />
              {run.taskId && (
                <Link
                  href={`/tasks?task=${encodeURIComponent(run.taskId)}`}
                  className="flex items-center gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors font-mono"
                >
                  <TaskSquareFilled className="h-2.5 w-2.5" style={{ color: "#5b9ef5" }} />
                  {run.taskId}
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-foreground/40" />
            <span className="font-mono">{formatDuration(run.started, run.completed)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-foreground/40" />
            <span className="font-mono">{completedAgents}/{totalAgents}</span>
          </div>
          <div className="flex items-center gap-2">
            {isActive && (
              <>
                <Button size="sm" variant={debugPaused ? "default" : "secondary"} className="h-7 text-[10px]" onClick={() => setDebugPaused(!debugPaused)}>
                  {debugPaused ? <Pause className="h-3 w-3 mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  {debugPaused ? "paused" : "live"}
                </Button>
                {confirmStop ? (
                  <>
                    <span className="text-[10px] text-red-400">stop all agents?</span>
                    <Button size="sm" variant="ghost" className="h-7 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-400/10 px-2" onClick={() => { handleStop(); setConfirmStop(false); }} data-testid="confirm-stop-btn">
                      confirm
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={() => setConfirmStop(false)}>
                      cancel
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] text-red-400/70 hover:text-red-400 hover:bg-red-400/10 px-2" onClick={() => setConfirmStop(true)} title="Force stop run" data-testid="stop-run-btn">
                    <Square className="h-3 w-3 mr-1" />
                    stop
                  </Button>
                )}
              </>
            )}
            {!isActive && (
              <>
                {hasIncompleteAgents && (
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] text-emerald-400/70 hover:text-emerald-400 hover:bg-emerald-400/10 px-2" onClick={handleResume} title="Resume from where it left off" data-testid="resume-btn">
                    <Play className="h-3 w-3 mr-1" />
                    resume
                  </Button>
                )}
                {hasStaleAgents && (
                  <Button size="sm" variant="ghost" className="h-7 text-[10px] text-amber-400/70 hover:text-amber-400 hover:bg-amber-400/10 px-2" onClick={handleCleanup} title="Clean up stale agent states" data-testid="cleanup-btn">
                    <Square className="h-3 w-3 mr-1" />
                    clean up
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={handleRerun} title="Rerun from scratch" data-testid="rerun-btn">
                  <RotateCw className="h-3 w-3 mr-1" />
                  rerun
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Copy Run ID" onClick={handleCopyRunId}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" title="Download Log" onClick={handleDownloadLog}>
              <Download className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Log</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isActive && (
                  <DropdownMenuItem onClick={handleCancel} className="text-red-400 focus:text-red-400">
                    <XCircle className="h-4 w-4 mr-2" />Cancel Run
                  </DropdownMenuItem>
                )}
                {!isActive && (
                  <>
                    <DropdownMenuItem onClick={handleRerun}>
                      <RotateCw className="h-4 w-4 mr-2" />Rerun
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleDelete} className="text-red-400 focus:text-red-400">
                      <Trash2 className="h-4 w-4 mr-2" />Delete Run
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </DetailHeader>

      {/* tabs */}
      <div className="flex-1 overflow-hidden">
        <Tabs defaultValue="goal" className="h-full flex flex-col">
          <div className="px-4 pt-3 shrink-0">
            <TabsList className="bg-card">
              <TabsTrigger value="goal" className="text-xs">goal</TabsTrigger>
              <TabsTrigger value="agents" className="text-xs">agents</TabsTrigger>
              <TabsTrigger value="output" className="text-xs">output</TabsTrigger>
              <TabsTrigger value="metrics" className="text-xs">metrics</TabsTrigger>
              <TabsTrigger value="cost" className="text-xs">cost</TabsTrigger>
            </TabsList>
          </div>

          {/* approval banner */}
          {isWaitingApproval && (
            <div className="mx-4 mt-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-md shrink-0">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                    This run is waiting for your approval to continue
                  </p>
                  <textarea
                    value={approvalReason}
                    onChange={(e) => setApprovalReason(e.target.value)}
                    placeholder="Optional: add a reason for your decision..."
                    className="mt-3 w-full bg-card border border-foreground/10 rounded-md px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    rows={2}
                  />
                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white text-xs"
                      onClick={() => handleApproval("approve")}
                      disabled={submittingApproval}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="bg-red-500/10 hover:bg-red-500/20 text-red-600 hover:text-red-500 text-xs border border-red-500/20"
                      onClick={() => handleApproval("reject")}
                      disabled={submittingApproval}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Reject
                    </Button>
                    {submittingApproval && (
                      <span className="text-[10px] text-foreground/40">processing...</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* goal tab */}
          <TabsContent value="goal" className="flex-1 overflow-y-auto p-6 mt-0">
            <div className="max-w-2xl space-y-6">
              <div className="grid grid-cols-[110px_1fr] gap-y-2.5 text-xs">
                <span className="text-foreground/40">started</span>
                <span>{new Date(run.started).toLocaleString()}</span>
                {run.completed && (
                  <>
                    <span className="text-foreground/40">completed</span>
                    <span>{new Date(run.completed).toLocaleString()}</span>
                  </>
                )}
                {run.chainId && (
                  <>
                    <span className="text-foreground/40">chain id</span>
                    <CopyButton value={run.chainId} className="text-xs" />
                  </>
                )}
                {run.sessions?.length > 0 && (
                  <>
                    <span className="text-foreground/40">sessions</span>
                    <span className="font-mono text-[10px] text-foreground/60">{run.sessions.join(", ")}</span>
                  </>
                )}
              </div>
              <div className="border-t border-foreground/5 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-foreground/40">goal</span>
                  <CopyButton value={run.goal} showLabel={false} className="text-[10px] h-6 px-2" />
                </div>
                <GoalContent goal={run.goal} />
              </div>
            </div>
          </TabsContent>

          {/* agents tab */}
          <TabsContent value="agents" className="flex-1 overflow-y-auto p-4 mt-0">
            <AgentTimeline run={run} />
            {run.agents && run.agents.length > 1 && (
              <div className="flex justify-end mb-3 max-w-4xl">
                <button
                  className="text-[10px] text-foreground/40 hover:text-foreground/60 transition-colors"
                  onClick={() => {
                    const allIds = run.agents.map(a => a.id);
                    const allExpanded = allIds.every(id => expandedAgents.has(id));
                    if (allExpanded) {
                      setExpandedAgents(new Set());
                    } else {
                      const next = new Set(allIds);
                      allIds.forEach(id => {
                        if (!agentActivity[id]) fetchAgentActivity(id);
                      });
                      setExpandedAgents(next);
                    }
                  }}
                >
                  {run.agents.every(a => expandedAgents.has(a.id)) ? "collapse all" : "expand all"}
                </button>
              </div>
            )}
            <div className="grid gap-3 max-w-4xl">
              {run.agents?.map((agent) => {
                const isExpanded = expandedAgents.has(agent.id);
                const hasOutput = agentOutputs[agent.session || ""]?.length > 0;
                const timeline = metricsTimeline[agent.id] || [];
                const agentArtifacts = (run.artifacts || []).filter(a => a.agentId === agent.id);
                const hasDiffArtifact = agentArtifacts.some(a => a.type === "diff");
                const hasConvArtifact = agentArtifacts.some(a => a.type === "conversations");
                const hasFilesArtifact = agentArtifacts.some(a => a.type === "files-changed");
                const hasOutputArtifact = agentArtifacts.some(a => a.type === "output");
                const hasEventArtifact = agentArtifacts.some(a => a.type === "event" || a.type === "events");
                return (
                  <div key={agent.id} className="bg-card rounded-md overflow-hidden">
                    <div className="p-3 cursor-pointer hover:bg-accent transition-colors" onClick={() => toggleExpand(agent.id)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isExpanded ? <ArrowDown1Filled className="h-4 w-4 text-foreground/40" /> : <ArrowRight1Filled className="h-4 w-4 text-foreground/40" />}
                          <Terminal className="h-4 w-4 text-foreground/40" />
                          <div>
                            <p className="text-sm font-medium">{agent.name || agent.id}</p>
                            <CopyButton value={agent.id} fullValue={agent} />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isExpanded && hasFilesArtifact && (
                            <span className="text-[9px] text-green-400/50 font-mono">files</span>
                          )}
                          {!isExpanded && hasDiffArtifact && (
                            <span className="text-[9px] text-amber-400/60 font-mono">diff</span>
                          )}
                          {!isExpanded && hasConvArtifact && (
                            <span className="text-[9px] text-blue-400/50 font-mono">conv</span>
                          )}
                          {!isExpanded && hasEventArtifact && (
                            <span className="text-[9px] text-violet-400/40 font-mono">evt</span>
                          )}
                          {!isExpanded && !hasFilesArtifact && !hasDiffArtifact && !hasConvArtifact && hasOutputArtifact && (
                            <span className="text-[9px] text-foreground/20 font-mono">log</span>
                          )}
                          {agent.isStale && (
                            <span className="text-[9px] text-orange-400/70 font-mono" title="No heartbeat — agent may be stale">stale</span>
                          )}
                          {agent.emits && <Badge variant="ghost" className="text-[9px] bg-card">{agent.emits}</Badge>}
                          <StatusBadge status={agent.status as Status} size="sm" />
                          <span className="text-[10px] text-foreground/40 font-mono hidden sm:inline">
                            {formatDuration(agent.started, agent.completed)}
                          </span>
                        </div>
                      </div>
                      {timeline.length > 2 && !isExpanded && (
                        <div className="mt-2 flex items-center gap-2">
                          <Sparkline data={timeline} width={150} height={20} />
                          <span className="text-[9px] text-foreground/30">activity</span>
                        </div>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="border-t border-foreground/5 p-3 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                          <div className="bg-card rounded p-2">
                            <p className="text-foreground/40 uppercase">session</p>
                            {agent.session ? <CopyButton value={agent.session} fullValue={agent} /> : <p className="font-mono text-[10px]">-</p>}
                          </div>
                          <div className="bg-card rounded p-2">
                            <p className="text-foreground/40 uppercase">started</p>
                            <p>{agent.started ? new Date(agent.started).toLocaleTimeString() : "-"}</p>
                          </div>
                          <div className="bg-card rounded p-2">
                            <p className="text-foreground/40 uppercase">completed</p>
                            <p>{agent.completed ? new Date(agent.completed).toLocaleTimeString() : "-"}</p>
                          </div>
                          <div className="bg-card rounded p-2">
                            <p className="text-foreground/40 uppercase">duration</p>
                            <p className="font-mono">{formatDuration(agent.started, agent.completed)}</p>
                          </div>
                          {agent.lastHeartbeat && (
                            <div className={`bg-card rounded p-2 col-span-2 ${agent.isStale ? "border border-orange-400/30" : ""}`}>
                              <p className={`text-foreground/40 uppercase ${agent.isStale ? "text-orange-400/60" : ""}`}>last heartbeat</p>
                              <p className="font-mono text-[10px]">
                                {new Date(agent.lastHeartbeat).toLocaleTimeString()}
                                {agent.msSinceHeartbeat != null && (
                                  <span className="text-foreground/40 ml-1">
                                    ({Math.round(agent.msSinceHeartbeat / 1000 / 60)}m ago)
                                  </span>
                                )}
                                {agent.isStale && <span className="text-orange-400/70 ml-2">stale</span>}
                              </p>
                              {agent.lastMessage && (
                                <p className="text-foreground/50 mt-1 truncate">{agent.lastMessage}</p>
                              )}
                            </div>
                          )}
                        </div>
                        {timeline.length > 2 && (
                          <div className="bg-card rounded p-3">
                            <p className="text-[10px] text-foreground/40 uppercase mb-2">activity</p>
                            <Sparkline data={timeline} width={300} height={32} />
                          </div>
                        )}
                        {/* agent activity: files changed + diff + captured conversations */}
                        {(() => {
                          const activity = agentActivity[agent.id];
                          if (activity === undefined) return (
                            <div className="text-[10px] text-foreground/30 text-center py-2">loading activity...</div>
                          );
                          if (activity === null) return (
                            <div className="text-[10px] text-foreground/20 text-center py-1">no activity data</div>
                          );
                          const hasFiles = activity.filesChanged?.length > 0;
                          const hasDiff = !!(activity.diff?.trim());
                          const allMsgs = activity.conversations?.flatMap(c => c.messages) || [];
                          const hasMsgs = allMsgs.length > 0;
                          const hasStoredOutput = !!(activity.output?.trim()) && !hasOutput;
                          const hasEvent = !!activity.event;
                          const hasSummary = !!(activity.summary?.executiveSummary || activity.summaryMarkdown?.trim());
                          if (!hasSummary && !hasFiles && !hasDiff && !hasMsgs && !hasStoredOutput && !hasEvent) return (
                            <div className="text-[10px] text-foreground/20 text-center py-1">no activity captured</div>
                          );
                          return (
                            <div className="space-y-3">
                              {hasSummary && (
                                <div>
                                  <p className="text-[10px] text-foreground/40 uppercase mb-1.5">summary</p>
                                  <div className="bg-card rounded p-2 text-[11px] text-foreground/70">
                                    {activity.summary?.executiveSummary ? (
                                      <p className="whitespace-pre-wrap break-words">{activity.summary.executiveSummary}</p>
                                    ) : (
                                      <Markdown content={activity.summaryMarkdown || ""} compact />
                                    )}
                                    {activity.summary?.nextAgentHints && activity.summary.nextAgentHints.length > 0 && (
                                      <div className="mt-2 pt-2 border-t border-foreground/10">
                                        <p className="text-[9px] text-foreground/35 uppercase mb-1">next</p>
                                        <ul className="space-y-0.5">
                                          {activity.summary.nextAgentHints.slice(0, 3).map((hint, i) => (
                                            <li key={i} className="text-foreground/55 break-words">{hint}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                              {hasFiles && (() => {
                                const FILES_LIMIT = 20;
                                const visible = activity.filesChanged.slice(0, FILES_LIMIT);
                                const hidden = activity.filesChanged.length - FILES_LIMIT;
                                return (
                                  <div>
                                    <p className="text-[10px] text-foreground/40 uppercase mb-1.5">
                                      files changed ({activity.filesChanged.length})
                                    </p>
                                    <div className="space-y-0.5">
                                      {visible.map((f, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                                          <span className={`w-3 shrink-0 font-bold ${
                                            f.status === "M" ? "text-amber-400" :
                                            f.status === "A" ? "text-green-400" :
                                            f.status === "D" ? "text-red-400" : "text-foreground/40"
                                          }`}>{f.status}</span>
                                          <span className="text-foreground/70 truncate">{f.file}</span>
                                        </div>
                                      ))}
                                      {hidden > 0 && (
                                        <p className="text-[10px] text-foreground/20 pt-1">+{hidden} more (see diff)</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })()}
                              {hasDiff && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <button
                                      onClick={() => toggleDiff(agent.id)}
                                      className="flex items-center gap-1 text-[10px] text-foreground/40 uppercase hover:text-foreground/60 transition-colors"
                                    >
                                      {expandedDiffs.has(agent.id) ? <ArrowDown1Filled className="h-3 w-3" /> : <ArrowRight1Filled className="h-3 w-3" />}
                                      diff ({activity.diff!.split("\n").length} lines)
                                    </button>
                                    <button
                                      className="text-[9px] text-foreground/30 hover:text-foreground/50 transition-colors"
                                      onClick={() => {
                                        const blob = new Blob([activity.diff!], { type: "text/plain" });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = `${agent.id}-diff.patch`;
                                        a.click();
                                        URL.revokeObjectURL(url);
                                      }}
                                    >
                                      download
                                    </button>
                                  </div>
                                  {expandedDiffs.has(agent.id) && (() => {
                                    const diffLines = activity.diff!.split("\n");
                                    const DIFF_LIMIT = 300;
                                    const capped = diffLines.length > DIFF_LIMIT;
                                    const visibleLines = capped ? diffLines.slice(0, DIFF_LIMIT) : diffLines;
                                    return (
                                      <div className="bg-card rounded p-2 overflow-x-auto max-h-64 overflow-y-auto no-scrollbar">
                                        <pre className="text-[10px] font-mono whitespace-pre">
                                          {visibleLines.map((line, i) => (
                                            <span key={i} className={`block ${
                                              line.startsWith("+") && !line.startsWith("+++") ? "text-green-400" :
                                              line.startsWith("-") && !line.startsWith("---") ? "text-red-400" :
                                              line.startsWith("@@") ? "text-cyan-400" : "text-foreground/50"
                                            }`}>{line}</span>
                                          ))}
                                          {capped && (
                                            <span className="block text-foreground/20 text-center py-1">
                                              ··· {diffLines.length - DIFF_LIMIT} more lines (download diff for full view)
                                            </span>
                                          )}
                                        </pre>
                                      </div>
                                    );
                                  })()}
                                </div>
                              )}
                              {hasMsgs && (
                                <div>
                                  <p className="text-[10px] text-foreground/40 uppercase mb-1.5">conversation ({allMsgs.length} messages)</p>
                                  <div className="space-y-1.5 max-h-96 overflow-y-auto no-scrollbar">
                                    {allMsgs.map((msg, i) => {
                                      const hasText = msg.content.trim().length > 0;
                                      const hasTools = (msg.toolCalls?.length ?? 0) > 0;
                                      return (
                                        <div key={i} className={`text-[11px] rounded px-2 py-1.5 ${
                                          msg.role === "user" ? "bg-accent text-foreground/60" : "bg-card text-foreground/80"
                                        }`}>
                                          <span className="text-[9px] uppercase text-foreground/30 mr-2">{msg.role}</span>
                                          {hasText && (
                                            <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                                          )}
                                          {hasTools && (() => {
                                            // filter out meta/internal tool calls that are noise for auditing
                                            const HIDDEN_TOOLS = new Set(["ToolSearch", "AskUserQuestion", "Skill"]);
                                            const visible = msg.toolCalls!.filter(tc => !HIDDEN_TOOLS.has(tc.name));
                                            if (visible.length === 0) return null;
                                            return (
                                              <div className={`flex flex-wrap gap-1 ${hasText ? "mt-1" : ""}`}>
                                                {visible.map((tc, j) => {
                                                  const toolColor =
                                                    tc.name === "Read" ? "text-blue-400" :
                                                    tc.name === "Write" || tc.name === "Edit" ? "text-amber-400" :
                                                    tc.name === "Bash" ? "text-violet-400" :
                                                    tc.name === "WebFetch" ? "text-cyan-400" :
                                                    "text-foreground/40";
                                                  return (
                                                    <span key={j} className={`inline-flex items-center gap-1 text-[9px] bg-background/60 rounded px-1.5 py-0.5 font-mono ${toolColor}`}>
                                                      <span className="text-foreground/30">{tc.name}</span>
                                                      <span className="max-w-[200px] truncate">{tc.label}</span>
                                                    </span>
                                                  );
                                                })}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              {hasStoredOutput && (() => {
                                const out = activity.output!;
                                return (
                                  <div>
                                    <p className="text-[10px] text-foreground/40 uppercase mb-1.5">session output</p>
                                    <div className="bg-card text-foreground p-2 rounded max-h-48 overflow-y-auto no-scrollbar">
                                      <Markdown content={out} compact />
                                    </div>
                                  </div>
                                );
                              })()}
                              {hasEvent && (
                                <div className="flex items-center gap-2 text-[10px] text-foreground/40">
                                  <span className="uppercase">event fired</span>
                                  <span className="font-mono text-violet-400/70">{activity.event!.event}</span>
                                  <span className="text-foreground/20">{new Date(activity.event!.timestamp).toLocaleTimeString()}</span>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {hasOutput && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] text-foreground/40 uppercase">output</p>
                              <Button size="sm" variant="ghost" className="h-6 text-[9px]" onClick={() => handleCopyOutput(agent.session || "")}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="bg-card text-foreground p-3 rounded h-32 overflow-y-auto">
                              <Markdown content={agentOutputs[agent.session || ""] || ""} compact />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* output tab */}
          <TabsContent value="output" className="flex-1 overflow-hidden flex flex-col mt-0">
            <div className="flex-1 flex min-h-0">
              <div className="w-40 md:w-48 border-r border-foreground/5 overflow-y-auto p-2 space-y-1">
                <p className="text-[10px] text-foreground/40 uppercase px-2 mb-2">agents</p>
                {run.agents?.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                      selectedAgent === agent.id ? "bg-accent" : "hover:bg-card"
                    }`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${
                      agent.status === "running" ? "bg-amber-400" :
                      agent.status === "complete" ? "bg-green-400" :
                      agent.status === "error" ? "bg-red-400" : "bg-gray-400"
                    }`} />
                    <span className="font-mono truncate flex-1">{agent.id}</span>
                    {agentMsgTotals[agent.id] > 0 && (
                      <span className="text-[9px] text-foreground/30">{agentMsgTotals[agent.id]}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                {selectedAgent ? (() => {
                  const agent = run.agents?.find((a) => a.id === selectedAgent);
                  const messages = agentMessages[selectedAgent] || [];
                  const conversationId = agentConversations[selectedAgent];
                  const rawOutput = agentOutputs[agent?.session || ""] || "";
                  const hasConversation = conversationId && messages.length > 0;
                  const agentAlive = agent?.status === "running";

                  return (
                    <>
                      <div className="flex items-center justify-between px-4 py-2 shrink-0">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h1 className="text-sm truncate">{agent?.name || agent?.id}</h1>
                            <StatusBadge status={(agent?.status || "pending") as Status} size="sm" />
                          </div>
                          <p className="text-xs text-foreground/50">
                            {outputView === "terminal" ? agent?.session || "no session" : hasConversation ? `${agentMsgTotals[selectedAgent] || messages.length} messages` : agent?.session || "no session"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-4 shrink-0">
                          {agent?.session && (
                            <Button
                              variant={outputView === "terminal" ? "default" : "ghost"}
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                const nextView = outputView === "terminal" ? "conversation" : "terminal";
                                if (selectedAgent) {
                                  if (nextView === "terminal") {
                                    outputAutoTerminalRef.current[selectedAgent] = false;
                                  } else {
                                    delete outputAutoTerminalRef.current[selectedAgent];
                                  }
                                }
                                setOutputView(nextView);
                              }}
                            >
                              <Terminal className="mr-1 h-3 w-3" />Terminal
                            </Button>
                          )}
                          {outputView === "conversation" && (
                            <>
                              {hasConversation && (
                                <Button variant={showToolResults ? "default" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setShowToolResults(!showToolResults)}>
                                  <Wrench className="mr-1 h-3 w-3" />Results
                                </Button>
                              )}
                              <Button variant={autoScrollEnabled ? "default" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => { setAutoScrollEnabled(!autoScrollEnabled); if (!autoScrollEnabled && outputBottomRef.current) outputBottomRef.current.scrollIntoView({ behavior: "smooth" }); }}>
                                <ArrowDown className="mr-1 h-3 w-3" />Scroll
                              </Button>
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { if (hasConversation) fetchAgentMessages(selectedAgent); if (agent?.session) fetchAgentOutput(selectedAgent, agent.session); }}>
                                <RefreshCw className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 overflow-hidden relative">
                        {outputView === "terminal" && agent?.session ? (
                          <TerminalPanel session={agent.session} sessionAlive={agentAlive} fallbackOutput={rawOutput} readOnly={true} />
                        ) : hasConversation ? (
                          <div ref={outputScrollRef} onScroll={checkOutputScrollPosition} className="h-full overflow-y-auto px-4 py-2">
                            <div className="max-w-3xl mx-auto">
                              <MessageList messages={messages} showToolResults={showToolResults} />
                              <div ref={outputBottomRef} />
                            </div>
                          </div>
                        ) : rawOutput ? (
                          <div ref={outputScrollRef} onScroll={checkOutputScrollPosition} className="h-full overflow-y-auto px-4 py-2">
                            <div className="max-w-3xl mx-auto">
                              <Markdown content={rawOutput || ""} compact />
                              <div ref={outputBottomRef} />
                            </div>
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center text-xs text-foreground/40">
                            {agentConversations[selectedAgent] === undefined ? "loading conversation..." : "no output yet..."}
                          </div>
                        )}
                        {/* Floating jump to bottom button */}
                        {!autoScrollEnabled && (hasConversation || rawOutput) && (
                          <button
                            onClick={scrollToBottom}
                            className="absolute bottom-4 right-4 bg-card hover:bg-accent text-foreground rounded-full p-2 transition-colors"
                            title="Jump to bottom"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
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

          {/* metrics tab */}
          <TabsContent value="metrics" className="flex-1 overflow-y-auto p-4 mt-0">
            {/* agent execution timeline */}
            <div className="max-w-4xl mb-6">
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-3 px-1">agent timeline</p>
              <div className="bg-card rounded-sm p-3">
                <div className="flex items-center gap-1 text-[9px] text-foreground/30 mb-2 ml-28">
                  <span>0%</span>
                  <div className="flex-1 h-px bg-foreground/10 mx-2" />
                  <span>total: {formatDuration(run.started, run.completed)}</span>
                  <div className="flex-1 h-px bg-foreground/10 mx-2" />
                  <span>100%</span>
                </div>
                {(() => {
                  const runStart = new Date(run.started).getTime();
                  const runEnd = run.completed ? new Date(run.completed).getTime() : Date.now();
                  const totalDuration = runEnd - runStart;
                  const hasTimestamps = run.agents?.some(a => a.started);

                  if (!hasTimestamps) return null;

                  return run.agents?.map((agent) => {
                    if (!agent.started) return null;

                    const agentStart = new Date(agent.started).getTime();
                    const agentEnd = agent.completed ? new Date(agent.completed).getTime() : runEnd;
                    const leftPercent = ((agentStart - runStart) / totalDuration) * 100;
                    const rawWidth = ((agentEnd - agentStart) / totalDuration) * 100;
                    const widthPercent = Math.max(rawWidth, 2); // min 2% visibility

                    const statusColor: Record<string, string> = {
                      complete: "bg-green-500",
                      running: "bg-blue-500",
                      failed: "bg-red-500",
                      error: "bg-red-500",
                      pending: "bg-muted-foreground/30",
                      idle: "bg-muted-foreground/30",
                    };

                    const durationText = formatDuration(agent.started, agent.completed);
                    const showInside = rawWidth > 5;

                    return (
                      <div key={agent.id} className="flex items-center gap-2 py-1">
                        <span className="w-28 text-[10px] text-foreground/60 truncate" title={agent.name || agent.id}>{agent.name || agent.id}</span>
                        <div className="flex-1 relative h-5 bg-accent/30 rounded-sm">
                          <div
                            className={cn("h-full rounded-sm flex items-center justify-end px-1.5 text-[9px] text-white font-mono truncate", statusColor[agent.status] || "bg-muted")}
                            style={{ left: `${Math.max(leftPercent, 0)}%`, width: `${Math.min(widthPercent, 100 - leftPercent)}%`, position: "absolute" }}
                          >
                            {showInside && <span className="drop-shadow-sm">{durationText}</span>}
                          </div>
                        </div>
                        {!showInside && <span className="w-16 text-[10px] text-foreground/40 font-mono text-right">{durationText}</span>}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 max-w-4xl">
              <div className="bg-card rounded-md p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="h-4 w-4 text-foreground/40" />
                  <p className="text-[10px] text-foreground/40 uppercase">duration</p>
                </div>
                <p className="text-lg font-mono">{formatDuration(run.started, run.completed)}</p>
              </div>
              <div className="bg-card rounded-md p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-4 w-4 text-foreground/40" />
                  <p className="text-[10px] text-foreground/40 uppercase">progress</p>
                </div>
                <p className="text-lg font-mono">{completedAgents}/{totalAgents}</p>
                <div className="w-full bg-accent rounded-full h-1 mt-2">
                  <div className="bg-green-500 h-1 rounded-full transition-all" style={{ width: `${totalAgents > 0 ? (completedAgents / totalAgents) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="bg-card rounded-md p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Cpu className="h-4 w-4 text-foreground/40" />
                  <p className="text-[10px] text-foreground/40 uppercase">active agents</p>
                </div>
                <p className="text-lg font-mono">{run.agents?.filter((a) => a.status === "running").length || 0}</p>
              </div>
              <div className="bg-card rounded-md p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Terminal className="h-4 w-4 text-foreground/40" />
                  <p className="text-[10px] text-foreground/40 uppercase">total agents</p>
                </div>
                <p className="text-lg font-mono">{totalAgents}</p>
              </div>
            </div>
            <div className="max-w-4xl">
              <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-3 px-1">agent metrics</p>
              <div className="grid gap-2">
                {run.agents?.map((agent) => {
                  const timeline = metricsTimeline[agent.id] || [];
                  return (
                    <div key={agent.id} className="bg-card rounded-md p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{agent.name || agent.id}</span>
                          <StatusBadge status={agent.status as Status} size="sm" />
                        </div>
                        <span className="text-[10px] text-foreground/40 font-mono">{formatDuration(agent.started, agent.completed)}</span>
                      </div>
                      {timeline.length > 2 ? (
                        <Sparkline data={timeline} width={300} height={32} />
                      ) : (
                        <div className="h-8 flex items-center text-[9px] text-foreground/30">no activity data yet</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* cost tab */}
          <TabsContent value="cost" className="flex-1 overflow-y-auto p-4 mt-0">
            <div className="max-w-4xl">
              {!costData ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <DollarSign className="h-10 w-10 text-foreground/10 mb-3" />
                  <p className="text-xs text-muted-foreground">no cost data available for this run</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* totals */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-card rounded-md p-4">
                      <p className="text-[10px] text-foreground/40 uppercase mb-1">total cost</p>
                      <p className="text-2xl font-mono">{costData.totalCostDisplay}</p>
                    </div>
                    <div className="bg-card rounded-md p-4">
                      <p className="text-[10px] text-foreground/40 uppercase mb-1">input tokens</p>
                      <p className="text-lg font-mono">{costData.totalInputTokens.toLocaleString()}</p>
                    </div>
                    <div className="bg-card rounded-md p-4">
                      <p className="text-[10px] text-foreground/40 uppercase mb-1">output tokens</p>
                      <p className="text-lg font-mono">{costData.totalOutputTokens.toLocaleString()}</p>
                    </div>
                    <div className="bg-card rounded-md p-4">
                      <p className="text-[10px] text-foreground/40 uppercase mb-1">total tokens</p>
                      <p className="text-lg font-mono">{(costData.totalInputTokens + costData.totalOutputTokens).toLocaleString()}</p>
                    </div>
                  </div>

                  {/* agent breakdown */}
                  <div>
                    <p className="text-[10px] text-foreground/40 uppercase tracking-wider mb-3 px-1">agent breakdown</p>
                    <div className="grid gap-2">
                      {costData.agentBreakdown.map((agent) => (
                        <div key={agent.agentId} className="bg-card rounded-md p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">{agent.agentName || agent.agentId}</span>
                              <span className="text-[9px] text-foreground/30 font-mono">{agent.model}</span>
                            </div>
                            <span className="text-xs font-mono">{agent.costDisplay}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[10px] text-foreground/50">
                            <div>input: {agent.inputTokens.toLocaleString()}</div>
                            <div>output: {agent.outputTokens.toLocaleString()}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// --- Link Run Transcript Component ---

interface TranscriptEntryLegacy {
  agent: string;
  round: number;
  timestamp: number;
  content: string;
}

// intentionally kept for legacy/wip link-transcript wiring
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LinkRunTranscript({
  run,
  onBack,
  fetchWithNamespace,
}: {
  run: Run;
  onBack?: () => void;
  fetchWithNamespace: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [transcript, setTranscript] = useState<TranscriptEntryLegacy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!run?.id) return;
    let mounted = true;
    const fetchTranscript = async () => {
      setLoading(true);
      try {
        const response = await fetchWithNamespace(`/api/links/runs/${encodeURIComponent(run.id)}/transcript`);
        if (!mounted) return;
        if (!response.ok) {
          setTranscript([]);
          return;
        }
        const data = await response.json();
        if (!mounted) return;
        const entries = data?.data?.transcript || data?.transcript || [];
        setTranscript(entries);
      } catch {
        if (mounted) setTranscript([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void fetchTranscript();
    return () => {
      mounted = false;
    };
  }, [run?.id, fetchWithNamespace]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0">
        {onBack && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onBack}>
            <ArrowLeftFilled className="h-4 w-4" />
          </Button>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{run.goal}</div>
          <div className="text-xs text-muted-foreground">
            {run.linkName || run.chain} | {run.mode || "collaboration"} | {run.rounds ? `${run.rounds} rounds` : "completed"}
          </div>
        </div>
      </div>

      {/* escalation history */}
      {run.escalations && run.escalations.length > 0 && (
        <div className="px-4 mb-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Escalations</div>
          {run.escalations.map((esc: { id?: string; round: number; trigger: string; haiku_summary?: string; human_reply?: string }, i: number) => (
            <div key={esc.id || i} className="text-xs p-2 bg-muted/30 rounded">
              <span className="text-amber-400">Round {esc.round}: {esc.trigger}</span>
              {esc.haiku_summary && <div className="mt-1 opacity-70">{esc.haiku_summary}</div>}
              {esc.human_reply && <div className="mt-1 text-blue-400">Steering: {esc.human_reply}</div>}
            </div>
          ))}
        </div>
      )}

      {/* transcript */}
      <div className="flex-1 overflow-auto px-4 pb-4 space-y-4">
        {loading ? (
          <div className="text-xs text-muted-foreground animate-pulse">Loading transcript...</div>
        ) : transcript.length === 0 ? (
          <div className="text-xs text-muted-foreground">No transcript data available.</div>
        ) : (
          transcript.map((entry, i) => {
            const isPrompt = entry.agent === "Prompt";
            const isAgent1 = run.agents?.[0]?.name === entry.agent;
            const dotColor = isPrompt ? "#10b981" : isAgent1 ? "#3b82f6" : "#f59e0b";
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="text-xs font-medium">{isPrompt ? "Goal" : entry.agent}</span>
                  {!isPrompt && <span className="text-[10px] text-muted-foreground">Round {entry.round}</span>}
                </div>
                <div className={`ml-4 text-sm whitespace-pre-wrap rounded-md p-3 leading-relaxed ${isPrompt ? "bg-accent/30 border border-accent/20" : "bg-muted/20"}`}>
                  {entry.content}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
