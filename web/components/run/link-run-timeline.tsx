"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Status } from "@/components/status-badge";
import { CopyButton } from "@/components/ui/copy-button";
import {
  MessageList,
  type ConversationMessage,
} from "@/components/conversation/message-renderer";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";
import { unwrapApiData } from "@/lib/api/api-client";
import { cn } from "@/lib/utils";
import { ArrowLeftFilled } from "@aliimam/icons";
import {
  ClockFilled as Clock,
  RotateRightFilled as RotateCw,
  TrashFilled as Trash2,
  FlashFilled as Zap,
  ArrowDown2Filled as ChevronDown,
} from "@aliimam/icons";

interface LinkRunAgent {
  id: string;
  name?: string;
  status: string;
  session?: string;
}

interface LinkRunData {
  id: string;
  chain: string;
  linkId?: string;
  linkName?: string;
  goal: string;
  started: string;
  completed?: string;
  status: string;
  mode?: string;
  rounds?: number;
  agents: LinkRunAgent[];
  workspaceId?: string;
  workspacePath?: string;
  taskId?: string;
  escalations?: Array<{
    id: string;
    round: number;
    trigger: string;
    haiku_summary?: string;
    human_reply?: string;
  }>;
}

interface LinkRunActivityMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    name: string;
    label: string;
    input: Record<string, unknown>;
  }>;
  ts?: string;
}

interface LinkRunActivityConversation {
  path: string;
  messages: LinkRunActivityMessage[];
}

interface LinkRunActivityResponse {
  conversations?: LinkRunActivityConversation[];
}

interface TranscriptEntry {
  agent: string;
  round: number;
  timestamp: number;
  content: string;
}

interface LinkSummaryData {
  headline: string;
  outcome: "consensus" | "disagreement" | "partial" | "inconclusive";
  goal?: string;
  mode?: string;
  rounds?: {
    total: number;
    breakdown: Array<{
      round: number;
      summary: string;
      agent1_stance: string;
      agent2_stance: string;
      status: "progress" | "escalation" | "consensus" | "disagreement";
    }>;
  };
  key_points?: Array<{
    topic: string;
    agent1_position: string;
    agent2_position: string;
    resolution: "agreed" | "disputed" | "deferred";
  }>;
  decisions?: Array<{
    decision: string;
    rationale: string;
    decided_by: "agents" | "escalation" | "human";
  }>;
  escalations?: Array<{
    round: number;
    trigger: string;
    human_input?: string;
    resolution: string;
  }>;
  files_touched?: string[];
  agent_summaries?: {
    agent1?: {
      name: string;
      contribution: string;
      strengths: string[];
      weaknesses: string[];
    };
    agent2?: {
      name: string;
      contribution: string;
      strengths: string[];
      weaknesses: string[];
    };
  };
  recommendations?: string[];
}

interface LinkRunTimelineProps {
  run: LinkRunData;
  onBack?: () => void;
  onDelete?: () => void;
  onRerun?: () => void;
}

interface RelayMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface RelaySession {
  id: string;
  createdAt: number;
  messages: RelayMessage[];
}

const AGENT_STYLES = [
  {
    accent: "text-cyan-400",
    dot: "bg-cyan-400",
    headerBg: "bg-cyan-500/5",
  },
  {
    accent: "text-amber-400",
    dot: "bg-amber-400",
    headerBg: "bg-amber-500/5",
  },
];

function modeLabel(mode?: string) {
  if (mode === "debate") return "debate";
  if (mode === "review") return "review";
  return "collab";
}

function modeBg(mode?: string) {
  if (mode === "debate") return "bg-red-500/12 text-red-400";
  if (mode === "review") return "bg-violet-500/12 text-violet-400";
  return "bg-cyan-500/12 text-cyan-400";
}

function formatDuration(start?: string, end?: string) {
  if (!start) return "-";
  const diff = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${(diff / 1000).toFixed(0)}s`;
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toConversationMessages(activity: LinkRunActivityResponse): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const conv of activity.conversations || []) {
    if (!conv?.messages?.length) continue;
    for (const raw of conv.messages) {
      if (raw.content) {
        messages.push({ type: raw.role, timestamp: raw.ts, text: raw.content });
      }
      if (raw.toolCalls && raw.toolCalls.length > 0) {
        for (const tc of raw.toolCalls) {
          messages.push({
            type: "tool_use",
            timestamp: raw.ts,
            toolName: tc.name,
            toolInput: tc.input,
          });
        }
      }
    }
  }
  return messages;
}

function formatTranscriptTime(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// moderator relay session card
function RelayCard({
  session,
  index,
  isExpanded,
  onToggle,
}: {
  session: RelaySession;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const userMsg = session.messages.find((m) => m.role === "user");
  const assistantMsg = session.messages.find((m) => m.role === "assistant");

  // extract what was sent (the terminal capture) vs the response
  const prompt = userMsg?.content || "";
  const response = assistantMsg?.content || "(no response)";

  // extract just the terminal capture portion (between --- TERMINAL CAPTURE --- and end)
  const captureMatch = prompt.match(/--- TERMINAL CAPTURE ---\n([\s\S]*?)$/);
  const capture = captureMatch ? captureMatch[1].trim() : "";
  const instructions = prompt.split("--- TERMINAL CAPTURE ---")[0].trim();

  // detect STATUS in response
  const statusMatch = response.match(/STATUS:(DONE|CONTINUE)/);
  const status = statusMatch ? statusMatch[1] : null;

  // response without the status line
  const responseBody = response.replace(/\n?STATUS:(DONE|CONTINUE)\s*$/, "").trim();

  return (
    <div className="mb-3">
      {/* clickable header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md bg-foreground/[0.03] hover:bg-foreground/[0.05] transition-colors text-left"
      >
        <span className="text-[10px] text-foreground/20 font-mono w-6 shrink-0">
          #{index + 1}
        </span>
        <span className="text-[9px] text-foreground/20 font-mono shrink-0">
          {formatTime(session.createdAt)}
        </span>
        <div className="flex-1 min-w-0">
          <span className="text-[11px] text-foreground/50 truncate block">
            {responseBody
              ? responseBody.slice(0, 100).replace(/\n/g, " ")
              : "(empty extraction)"}
          </span>
        </div>
        {status && (
          <span
            className={cn(
              "text-[9px] px-1.5 py-0.5 rounded-sm font-mono shrink-0",
              status === "DONE"
                ? "bg-emerald-500/12 text-emerald-400"
                : "bg-amber-500/12 text-amber-400"
            )}
          >
            {status}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3 w-3 text-foreground/20 transition-transform shrink-0",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      {/* expanded content */}
      {isExpanded && (
        <div className="mt-1 ml-10 space-y-3">
          {/* what was sent to moderator (terminal capture) */}
          <div>
            <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-1">
              terminal capture sent to moderator ({capture.length} chars)
            </span>
            <pre className="text-[11px] font-mono text-foreground/40 bg-foreground/[0.02] rounded-md px-3 py-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
              {capture || "(empty capture)"}
            </pre>
          </div>

          {/* moderator instructions */}
          <div>
            <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-1">
              extraction prompt
            </span>
            <pre className="text-[11px] font-mono text-foreground/30 bg-foreground/[0.02] rounded-md px-3 py-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
              {instructions}
            </pre>
          </div>

          {/* moderator response */}
          <div>
            <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-1">
              moderator extracted
            </span>
            <div
              className={cn(
                "rounded-md px-3 py-2",
                responseBody
                  ? "bg-violet-500/5"
                  : "bg-red-500/5"
              )}
            >
              <pre className="text-[12px] font-mono text-foreground/60 whitespace-pre-wrap break-words">
                {responseBody || "(empty - moderator extracted nothing)"}
              </pre>
              {status && (
                <div className="mt-2 pt-2 border-t border-foreground/5">
                  <span
                    className={cn(
                      "text-[10px] font-mono",
                      status === "DONE"
                        ? "text-emerald-400/60"
                        : "text-amber-400/60"
                    )}
                  >
                    STATUS:{status}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function LinkRunTimeline({ run, onBack, onDelete, onRerun }: LinkRunTimelineProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [activeTab, setActiveTab] = useState<"summary" | "agents" | "moderator" | "transcript">("summary");
  const [agent1Messages, setAgent1Messages] = useState<ConversationMessage[]>([]);
  const [agent2Messages, setAgent2Messages] = useState<ConversationMessage[]>([]);
  const [loading1, setLoading1] = useState(true);
  const [loading2, setLoading2] = useState(true);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [relaySessions, setRelaySessions] = useState<RelaySession[]>([]);
  const [loadingRelay, setLoadingRelay] = useState(false);
  const [expandedRelays, setExpandedRelays] = useState<Set<number>>(new Set());
  const [summaryData, setSummaryData] = useState<LinkSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryGenerating, setSummaryGenerating] = useState(false);

  const agent1 = run.agents?.[0];
  const agent2 = run.agents?.[1];
  const agent1Name = agent1?.name || agent1?.id || "Agent 1";
  const agent2Name = agent2?.name || agent2?.id || "Agent 2";
  const style1 = AGENT_STYLES[0];
  const style2 = AGENT_STYLES[1];

  const loadFromActivity = useCallback(
    async (
      agentId: string,
      setMessages: (msgs: ConversationMessage[]) => void
    ) => {
      try {
        const activityRes = await fetchWithNamespace(
          `/api/runs/${encodeURIComponent(run.id)}/agents/${encodeURIComponent(agentId)}/activity`
        );
        if (!activityRes.ok) return;
        const activityRaw = await activityRes.json();
        const activity = unwrapApiData<LinkRunActivityResponse>(activityRaw);
        setMessages(toConversationMessages(activity));
      } catch (e) {
        console.error("failed to load activity fallback", e);
      }
    },
    [run.id, fetchWithNamespace]
  );

  const loadAgentConversation = useCallback(
    async (
      agent: LinkRunAgent | undefined,
      setMessages: (msgs: ConversationMessage[]) => void,
      setLoading: (v: boolean) => void
    ) => {
      if (!agent) {
        setLoading(false);
        return;
      }

      try {
        const agentName = agent.name || agent.id;
        const params = new URLSearchParams({
          name: agentName,
          since: run.started || "",
        });
        params.set("runId", run.id);
        params.set("agentId", agent.id);
        if (run.workspacePath) params.set("cwd", run.workspacePath);

        const findRes = await fetchWithNamespace(
          `/api/conversations/find-by-agent?${params.toString()}`
        );
        if (!findRes.ok) {
          await loadFromActivity(agent.id, setMessages);
          setLoading(false);
          return;
        }

        const findRaw = await findRes.json();
        const findData = unwrapApiData<{ conversationId?: string }>(findRaw);
        const conversationId = findData.conversationId;

        if (!conversationId) {
          await loadFromActivity(agent.id, setMessages);
          setLoading(false);
          return;
        }

        const cwdParam = run.workspacePath
          ? `&cwd=${encodeURIComponent(run.workspacePath)}`
          : "";
        const msgRes = await fetchWithNamespace(
          `/api/conversations/${conversationId}?mode=paginated&limit=2000${cwdParam}`
        );
        if (msgRes.ok) {
          const msgRaw = await msgRes.json();
          const msgData = unwrapApiData<{ messages?: ConversationMessage[] }>(msgRaw);
          const fallbackMessages = msgData.messages || [];
          if (fallbackMessages.length > 0) {
            setMessages(fallbackMessages);
          } else {
            await loadFromActivity(agent.id, setMessages);
          }
        } else {
          await loadFromActivity(agent.id, setMessages);
        }
      } catch (e) {
        console.error("failed to load agent conversation", e);
        await loadFromActivity(agent.id, setMessages);
      } finally {
        setLoading(false);
      }
    },
    [run.id, run.started, run.workspacePath, fetchWithNamespace, loadFromActivity]
  );

  const loadModeratorSessions = useCallback(async () => {
    setLoadingRelay(true);
    try {
      const res = await fetchWithNamespace(
        `/api/links/runs/${encodeURIComponent(run.id)}/moderator`
      );
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ sessions: RelaySession[] }>(raw);
        setRelaySessions(data.sessions || []);
      }
    } catch (e) {
      console.error("failed to load moderator sessions", e);
    } finally {
      setLoadingRelay(false);
    }
  }, [run.id, fetchWithNamespace]);

  const loadTranscript = useCallback(async () => {
    setTranscriptLoading(true);
    try {
      const res = await fetchWithNamespace(
        `/api/links/runs/${encodeURIComponent(run.id)}/transcript`
      );
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ transcript?: TranscriptEntry[] }>(raw);
        setTranscriptEntries(data.transcript || []);
      } else {
        setTranscriptEntries([]);
      }
    } catch (e) {
      console.error("failed to load link transcript", e);
      setTranscriptEntries([]);
    } finally {
      setTranscriptLoading(false);
    }
  }, [run.id, fetchWithNamespace]);

  // load agent conversations sequentially to avoid rate limiting
  useEffect(() => {
    let cancelled = false;
    async function load() {
      await loadAgentConversation(agent1, setAgent1Messages, setLoading1);
      if (cancelled) return;
      await loadAgentConversation(agent2, setAgent2Messages, setLoading2);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  // load moderator sessions when tab is switched (once only)
  const moderatorLoadedRef = useRef(false);
  useEffect(() => {
    if (activeTab === "moderator" && !moderatorLoadedRef.current) {
      moderatorLoadedRef.current = true;
      loadModeratorSessions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const transcriptLoadedRef = useRef(false);
  useEffect(() => {
    if (activeTab === "transcript" && !transcriptLoadedRef.current) {
      transcriptLoadedRef.current = true;
      loadTranscript();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // load summary on mount
  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      try {
        const res = await fetchWithNamespace(
          `/api/links/runs/${encodeURIComponent(run.id)}/summary`
        );
        if (cancelled) return;
        if (res.ok) {
          const raw = await res.json();
          const data = unwrapApiData<{
            summary: LinkSummaryData | null;
            hasSummary: boolean;
            hasPendingJob: boolean;
          }>(raw);
          if (data.summary) {
            setSummaryData(data.summary);
          } else if (data.hasPendingJob) {
            setSummaryGenerating(true);
            pollSummaryJob();
          }
        }
      } catch {
        // not critical
      } finally {
        setSummaryLoading(false);
      }
    }

    async function pollSummaryJob() {
      let attempts = 0;
      while (attempts < 40 && !cancelled) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) return;
        try {
          const res = await fetchWithNamespace(
            `/api/links/runs/${encodeURIComponent(run.id)}/summary`
          );
          if (res.ok) {
            const raw = await res.json();
            const data = unwrapApiData<{
              summary: LinkSummaryData | null;
              hasPendingJob: boolean;
            }>(raw);
            if (data.summary) {
              setSummaryData(data.summary);
              setSummaryGenerating(false);
              return;
            }
            if (!data.hasPendingJob) {
              setSummaryGenerating(false);
              return;
            }
          }
        } catch { /* retry */ }
        attempts++;
      }
      setSummaryGenerating(false);
    }

    loadSummary();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  const handleGenerateSummary = useCallback(async () => {
    setSummaryGenerating(true);
    try {
      const res = await fetchWithNamespace(
        `/api/links/runs/${encodeURIComponent(run.id)}/generate-summary`,
        { method: "POST" }
      );
      if (res.ok) {
        const raw = await res.json();
        const data = unwrapApiData<{ jobId: string | null; status: string }>(raw);
        if (data.jobId) {
          // poll until done
          let attempts = 0;
          while (attempts < 40) {
            await new Promise((r) => setTimeout(r, 3000));
            const checkRes = await fetchWithNamespace(
              `/api/links/runs/${encodeURIComponent(run.id)}/summary`
            );
            if (checkRes.ok) {
              const checkRaw = await checkRes.json();
              const checkData = unwrapApiData<{
                summary: LinkSummaryData | null;
                hasPendingJob: boolean;
              }>(checkRaw);
              if (checkData.summary) {
                setSummaryData(checkData.summary);
                setSummaryGenerating(false);
                return;
              }
              if (!checkData.hasPendingJob) {
                setSummaryGenerating(false);
                return;
              }
            }
            attempts++;
          }
        } else if (data.status === "already_exists") {
          // fetch it
          const sumRes = await fetchWithNamespace(
            `/api/links/runs/${encodeURIComponent(run.id)}/summary`
          );
          if (sumRes.ok) {
            const sumRaw = await sumRes.json();
            const sumData = unwrapApiData<{ summary: LinkSummaryData | null }>(sumRaw);
            if (sumData.summary) setSummaryData(sumData.summary);
          }
          setSummaryGenerating(false);
        }
      }
    } catch (e) {
      console.error("failed to generate summary", e);
      setSummaryGenerating(false);
    }
  }, [run.id, fetchWithNamespace]);

  const toggleRelay = (idx: number) => {
    setExpandedRelays((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const loading = loading1 || loading2;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* header */}
      <div className="shrink-0 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={onBack}>
                <ArrowLeftFilled className="h-4 w-4" />
              </Button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-medium truncate">
                  {run.linkName || run.chain}
                </span>
                <StatusBadge status={run.status as Status} size="sm" />
                <span
                  className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded-sm font-medium uppercase tracking-wider",
                    modeBg(run.mode)
                  )}
                >
                  {modeLabel(run.mode)}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <CopyButton value={run.id} fullValue={run} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs shrink-0">
            <div className="flex items-center gap-1.5 text-foreground/40">
              <Clock className="h-3 w-3" />
              <span className="font-mono text-foreground/60">
                {formatDuration(run.started, run.completed)}
              </span>
            </div>
            {run.rounds != null && run.rounds > 0 && (
              <div className="flex items-center gap-1.5 text-foreground/40">
                <Zap className="h-3 w-3" />
                <span className="font-mono text-foreground/60">{run.rounds} rounds</span>
              </div>
            )}
            {onRerun && (
              <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={onRerun}>
                <RotateCw className="h-3 w-3 mr-1" />
                rerun
              </Button>
            )}
            {onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[10px] px-2 text-red-400/50 hover:text-red-400 hover:bg-red-400/10"
                onClick={onDelete}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* tab bar */}
      <div className="shrink-0 flex px-5 gap-1">
        <button
          onClick={() => setActiveTab("summary")}
          className={cn(
            "px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors",
            activeTab === "summary"
              ? "bg-foreground/10 text-foreground/80"
              : "text-foreground/30 hover:text-foreground/50"
          )}
        >
          summary
          {summaryData && (
            <span className="ml-1.5 text-[9px] text-emerald-400/60 font-mono">
              done
            </span>
          )}
          {summaryGenerating && (
            <span className="ml-1.5 text-[9px] text-amber-400/60 font-mono">
              generating...
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("agents")}
          className={cn(
            "px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors",
            activeTab === "agents"
              ? "bg-foreground/10 text-foreground/80"
              : "text-foreground/30 hover:text-foreground/50"
          )}
        >
          agents
        </button>
        <button
          onClick={() => setActiveTab("transcript")}
          className={cn(
            "px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors",
            activeTab === "transcript"
              ? "bg-violet-500/15 text-violet-400"
              : "text-foreground/30 hover:text-foreground/50"
          )}
        >
          transcript
          {transcriptEntries.length > 0 && (
            <span className="ml-1.5 text-[9px] text-foreground/20 font-mono">
              {transcriptEntries.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("moderator")}
          className={cn(
            "px-3 py-1.5 text-[11px] font-medium rounded-sm transition-colors",
            activeTab === "moderator"
              ? "bg-violet-500/15 text-violet-400"
              : "text-foreground/30 hover:text-foreground/50"
          )}
        >
          moderator
          {relaySessions.length > 0 && (
            <span className="ml-1.5 text-[9px] text-foreground/20 font-mono">
              {relaySessions.length}
            </span>
          )}
        </button>
      </div>

      {/* summary tab */}
      {activeTab === "summary" && (
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {summaryLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-2 text-foreground/30 text-xs">
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                loading summary...
              </div>
            </div>
          ) : summaryGenerating ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-2 text-foreground/30 text-xs">
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                generating summary...
              </div>
            </div>
          ) : !summaryData ? (
            <div className="flex flex-col items-center justify-center py-20 text-foreground/30">
              <p className="text-sm">no summary yet</p>
              <p className="text-xs mt-1 mb-4">generate an AI summary of what happened during this link run</p>
              <Button
                size="sm"
                onClick={handleGenerateSummary}
                className="text-[11px]"
              >
                generate summary
              </Button>
            </div>
          ) : (
            <div className="max-w-3xl space-y-5">
              {/* headline + outcome */}
              <div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {summaryData.headline}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded-sm font-medium uppercase tracking-wider",
                      summaryData.outcome === "consensus"
                        ? "bg-emerald-500/12 text-emerald-400"
                        : summaryData.outcome === "disagreement"
                          ? "bg-red-500/12 text-red-400"
                          : summaryData.outcome === "partial"
                            ? "bg-amber-500/12 text-amber-400"
                            : "bg-foreground/10 text-foreground/40"
                    )}
                  >
                    {summaryData.outcome}
                  </span>
                  {summaryData.mode && (
                    <span
                      className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded-sm font-medium uppercase tracking-wider",
                        modeBg(summaryData.mode)
                      )}
                    >
                      {modeLabel(summaryData.mode)}
                    </span>
                  )}
                  {summaryData.rounds && (
                    <span className="text-[9px] text-foreground/20 font-mono">
                      {summaryData.rounds.total} rounds
                    </span>
                  )}
                </div>
              </div>

              {/* round breakdown */}
              {summaryData.rounds?.breakdown && summaryData.rounds.breakdown.length > 0 && (
                <div>
                  <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-2">
                    round breakdown
                  </span>
                  <div className="space-y-2">
                    {summaryData.rounds.breakdown.map((r) => (
                      <div
                        key={r.round}
                        className="px-3 py-2.5 bg-foreground/[0.03] rounded-md"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-mono text-foreground/25">
                            round {r.round}
                          </span>
                          <span
                            className={cn(
                              "text-[9px] px-1 py-0.5 rounded-sm font-medium",
                              r.status === "consensus"
                                ? "bg-emerald-500/12 text-emerald-400"
                                : r.status === "escalation"
                                  ? "bg-amber-500/12 text-amber-400"
                                  : r.status === "disagreement"
                                    ? "bg-red-500/12 text-red-400"
                                    : "bg-foreground/5 text-foreground/30"
                            )}
                          >
                            {r.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-foreground/50 leading-relaxed">
                          {r.summary}
                        </p>
                        <div className="flex gap-4 mt-2">
                          <div className="flex-1">
                            <span className={cn("text-[9px] font-medium", AGENT_STYLES[0].accent)}>
                              {agent1Name}
                            </span>
                            <p className="text-[10px] text-foreground/35 mt-0.5 leading-relaxed">
                              {r.agent1_stance}
                            </p>
                          </div>
                          <div className="w-px bg-foreground/5 shrink-0" />
                          <div className="flex-1">
                            <span className={cn("text-[9px] font-medium", AGENT_STYLES[1].accent)}>
                              {agent2Name}
                            </span>
                            <p className="text-[10px] text-foreground/35 mt-0.5 leading-relaxed">
                              {r.agent2_stance}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* key points */}
              {summaryData.key_points && summaryData.key_points.length > 0 && (
                <div>
                  <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-2">
                    key points
                  </span>
                  <div className="space-y-2">
                    {summaryData.key_points.map((kp, i) => (
                      <div
                        key={i}
                        className="px-3 py-2.5 bg-foreground/[0.03] rounded-md"
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[11px] font-medium text-foreground/60">
                            {kp.topic}
                          </span>
                          <span
                            className={cn(
                              "text-[9px] px-1 py-0.5 rounded-sm",
                              kp.resolution === "agreed"
                                ? "bg-emerald-500/10 text-emerald-400/70"
                                : kp.resolution === "disputed"
                                  ? "bg-red-500/10 text-red-400/70"
                                  : "bg-foreground/5 text-foreground/30"
                            )}
                          >
                            {kp.resolution}
                          </span>
                        </div>
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <span className={cn("text-[9px] font-medium", AGENT_STYLES[0].accent)}>
                              {agent1Name}
                            </span>
                            <p className="text-[10px] text-foreground/35 mt-0.5 leading-relaxed">
                              {kp.agent1_position}
                            </p>
                          </div>
                          <div className="w-px bg-foreground/5 shrink-0" />
                          <div className="flex-1">
                            <span className={cn("text-[9px] font-medium", AGENT_STYLES[1].accent)}>
                              {agent2Name}
                            </span>
                            <p className="text-[10px] text-foreground/35 mt-0.5 leading-relaxed">
                              {kp.agent2_position}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* decisions */}
              {summaryData.decisions && summaryData.decisions.length > 0 && (
                <div>
                  <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-2">
                    decisions
                  </span>
                  <div className="space-y-2">
                    {summaryData.decisions.map((d, i) => (
                      <div
                        key={i}
                        className="px-3 py-2.5 bg-foreground/[0.03] rounded-md"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-medium text-foreground/60">
                            {d.decision}
                          </span>
                          <span className="text-[9px] text-foreground/20 font-mono">
                            by {d.decided_by}
                          </span>
                        </div>
                        <p className="text-[10px] text-foreground/35 leading-relaxed">
                          {d.rationale}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* agent summaries */}
              {summaryData.agent_summaries && (
                <div>
                  <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-2">
                    agent performance
                  </span>
                  <div className="flex gap-3">
                    {(["agent1", "agent2"] as const).map((key) => {
                      const a = summaryData.agent_summaries?.[key];
                      if (!a) return null;
                      const style = key === "agent1" ? AGENT_STYLES[0] : AGENT_STYLES[1];
                      return (
                        <div
                          key={key}
                          className={cn("flex-1 px-3 py-2.5 rounded-md", style.headerBg)}
                        >
                          <span className={cn("text-[11px] font-medium block mb-1", style.accent)}>
                            {a.name}
                          </span>
                          <p className="text-[10px] text-foreground/40 leading-relaxed mb-2">
                            {a.contribution}
                          </p>
                          {a.strengths.length > 0 && (
                            <div className="mb-1">
                              {a.strengths.map((s, j) => (
                                <span
                                  key={j}
                                  className="text-[9px] text-emerald-400/60 block"
                                >
                                  + {s}
                                </span>
                              ))}
                            </div>
                          )}
                          {a.weaknesses.length > 0 && (
                            <div>
                              {a.weaknesses.map((w, j) => (
                                <span
                                  key={j}
                                  className="text-[9px] text-amber-400/50 block"
                                >
                                  - {w}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* recommendations */}
              {summaryData.recommendations && summaryData.recommendations.length > 0 && (
                <div>
                  <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-2">
                    recommendations
                  </span>
                  <div className="space-y-1.5">
                    {summaryData.recommendations.map((r, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-[9px] text-foreground/15 font-mono shrink-0">
                          {i + 1}.
                        </span>
                        <span className="text-[11px] text-foreground/50 leading-relaxed">
                          {r}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* files touched */}
              {summaryData.files_touched && summaryData.files_touched.length > 0 && (
                <div>
                  <span className="text-[9px] text-foreground/25 uppercase tracking-wider block mb-2">
                    files touched
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {summaryData.files_touched.map((f, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono text-foreground/40 bg-foreground/[0.03] px-2 py-0.5 rounded-sm"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* regenerate */}
              <div className="pt-2 border-t border-foreground/5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[10px] text-foreground/25 hover:text-foreground/40"
                  onClick={() => {
                    setSummaryData(null);
                    handleGenerateSummary();
                  }}
                >
                  regenerate summary
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* agents tab */}
      {activeTab === "agents" && (
        <>
          {/* column headers */}
          <div className="shrink-0 flex mt-2">
            <div className={cn("flex-1 px-5 py-2", style1.headerBg)}>
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", style1.dot)} />
                <span className={cn("text-[11px] font-medium", style1.accent)}>{agent1Name}</span>
                <span className="text-[9px] text-foreground/20 font-mono ml-auto">
                  {agent1Messages.length} msgs
                </span>
              </div>
            </div>
            <div className="w-px bg-foreground/5 shrink-0" />
            <div className={cn("flex-1 px-5 py-2", style2.headerBg)}>
              <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", style2.dot)} />
                <span className={cn("text-[11px] font-medium", style2.accent)}>{agent2Name}</span>
                <span className="text-[9px] text-foreground/20 font-mono ml-auto">
                  {agent2Messages.length} msgs
                </span>
              </div>
            </div>
          </div>

          {/* split conversation panels */}
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-2 text-foreground/30 text-xs">
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                loading conversations...
              </div>
            </div>
          ) : (
            <div className="flex-1 flex min-h-0">
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {agent1Messages.length > 0 ? (
                  <MessageList messages={agent1Messages} showToolResults={false} />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-[11px] text-foreground/20 italic">
                      no conversation found
                    </span>
                  </div>
                )}
              </div>
              <div className="w-px bg-foreground/5 shrink-0" />
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {agent2Messages.length > 0 ? (
                  <MessageList messages={agent2Messages} showToolResults={false} />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-[11px] text-foreground/20 italic">
                      no conversation found
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* transcript tab */}
      {activeTab === "transcript" && (
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {transcriptLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-2 text-foreground/30 text-xs">
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                loading transcript...
              </div>
            </div>
          ) : transcriptEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-foreground/30">
              <p className="text-sm">no transcript data available</p>
              <p className="text-xs mt-1">peer output files may have been cleaned up</p>
            </div>
          ) : (
            <div className="max-w-4xl space-y-4">
              {run.escalations && run.escalations.length > 0 && (
                <div className="px-3 py-2 bg-foreground/[0.03] rounded-sm">
                  <p className="text-[11px] uppercase tracking-wider text-foreground/30">escalations</p>
                  {run.escalations.map((esc, idx) => (
                    <div key={esc.id || `${idx}`} className="text-[10px] mt-2 text-foreground/60">
                      <span className="text-amber-400">round {esc.round}: </span>
                      <span>{esc.trigger}</span>
                      {esc.haiku_summary ? (
                        <div className="mt-1 text-foreground/50">{esc.haiku_summary}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {transcriptEntries.map((entry, i) => {
                const isPrompt = entry.agent === "Prompt";
                const isAgent1 = run.agents?.[0]?.name === entry.agent;
                return (
                  <div key={`${entry.agent}-${i}-${entry.timestamp}`} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isPrompt ? "bg-emerald-400" : isAgent1 ? "bg-cyan-400" : "bg-amber-400"
                        }`}
                      />
                      <span
                        className={`text-xs font-medium ${
                          isPrompt ? "text-emerald-400" : isAgent1 ? "text-cyan-400" : "text-amber-400"
                        }`}
                      >
                        {isPrompt ? "Prompt" : entry.agent}
                      </span>
                      <span className="text-[10px] text-foreground/30">Round {entry.round}</span>
                      <span className="text-[9px] text-foreground/25 font-mono ml-auto">
                        {formatTranscriptTime(entry.timestamp)}
                      </span>
                    </div>
                    <pre className="ml-5 text-xs text-foreground/75 bg-foreground/[0.03] rounded-md p-3 whitespace-pre-wrap break-words">
                      {entry.content}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* moderator tab */}
      {activeTab === "moderator" && (
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loadingRelay ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-2 text-foreground/30 text-xs">
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                loading moderator sessions...
              </div>
            </div>
          ) : relaySessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-foreground/30">
              <p className="text-sm">no moderator sessions found</p>
              <p className="text-xs mt-1">relay JSONL files may have been cleaned up</p>
            </div>
          ) : (
            <div className="max-w-4xl">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-violet-400" />
                <span className="text-[11px] font-medium text-violet-400">
                  moderator relay log
                </span>
                <span className="text-[9px] text-foreground/20 font-mono">
                  {relaySessions.length} extractions
                </span>
              </div>
              <p className="text-[11px] text-foreground/25 mb-4">
                each entry shows what the moderator received from an agent&apos;s terminal,
                and what it extracted to relay to the other agent.
              </p>
              {relaySessions.map((session, idx) => (
                <RelayCard
                  key={session.id}
                  session={session}
                  index={idx}
                  isExpanded={expandedRelays.has(idx)}
                  onToggle={() => toggleRelay(idx)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* status bar */}
      <div className="shrink-0 px-5 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              run.status === "completed" || run.status === "complete"
                ? "bg-emerald-400"
                : run.status === "stopped"
                ? "bg-orange-400"
                : "bg-foreground/20"
            )}
          />
          <span className="text-[9px] text-foreground/25 uppercase tracking-widest font-medium">
            {run.status === "completed" || run.status === "complete" ? "completed" : run.status}
          </span>
        </div>
        <span className="text-[9px] text-foreground/20 font-mono">
          {activeTab === "summary"
            ? summaryData
              ? "summary loaded"
              : summaryGenerating
                ? "generating..."
                : "no summary"
            : activeTab === "agents"
              ? `${agent1Messages.length + agent2Messages.length} total messages`
              : activeTab === "transcript"
                ? `${transcriptEntries.length} transcript entries`
                : `${relaySessions.length} relay sessions`}
        </span>
      </div>
    </div>
  );
}
