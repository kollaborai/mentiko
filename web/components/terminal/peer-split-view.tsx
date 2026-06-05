"use client";

/**
 * peer-split-view.tsx - split terminal view for peer collaboration
 *
 * three panes:
 *   left:   peer-1 terminal
 *   right:  peer-2 terminal
 *   bottom: manager/escalation chat (collapsible)
 */

import { TerminalPanel } from "./terminal-panel";
import { useCallback, useEffect, useState } from "react";
import {
  CopyFilled as Copy,
  TickCircleFilled as Check,
  ArrowDown2Filled as ChevronDown,
  ArrowUp2Filled as ChevronUp,
  SendFilled as Send,
} from "@aliimam/icons";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import { useNamespaceFetch } from "@/lib/hooks/use-namespace-fetch";

interface EscalationEvent {
  id: string;
  round: number;
  trigger: "STATUS:ESCALATE" | "STALL" | "MAX_ROUNDS";
  haiku_summary?: string;
  human_reply?: string;
  replied_at?: string;
}

function triggerLabel(trigger: EscalationEvent["trigger"]): string {
  if (trigger === "STATUS:ESCALATE") return "loop detected";
  if (trigger === "STALL") return "stalled";
  return "max rounds hit";
}

interface PeerSplitViewProps {
  sessionA: string;
  sessionB: string;
  managerSession?: string;
  runId?: string;
  labelA?: string;
  labelB?: string;
  wsUrl?: string;
  className?: string;
}

type AgentActivity = "idle" | "active";

export function PeerSplitView({
  sessionA,
  sessionB,
  managerSession,
  runId,
  labelA = "Peer 1",
  labelB = "Peer 2",
  wsUrl,
  className = "",
}: PeerSplitViewProps) {
  const { fetchWithNamespace } = useNamespaceFetch();
  const [aliveA, setAliveA] = useState(true);
  const [aliveB, setAliveB] = useState(true);
  const [aliveManager, setAliveManager] = useState(!!managerSession);
  const [activityA, setActivityA] = useState<AgentActivity>("idle");
  const [activityB, setActivityB] = useState<AgentActivity>("idle");
  const [managerOpen, setManagerOpen] = useState(true);
  const [escalations, setEscalations] = useState<EscalationEvent[]>([]);
  const [pending, setPending] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  // poll escalation state
  useEffect(() => {
    if (!managerSession) return;
    const poll = async () => {
      try {
        const escUrl = runId
          ? `/api/links/runs/${encodeURIComponent(runId)}/escalations`
          : `/api/swarm/${encodeURIComponent(managerSession)}/escalations`;
        const res = await fetchWithNamespace(escUrl);
        if (!res.ok) return;
        const data = await res.json();
        setEscalations(data.escalations || []);
        setPending(data.pending || false);
        setTelegramConnected(data.telegram_connected || false);
        if (data.pending) setManagerOpen(true);
      } catch {}
    };
    const interval = setInterval(poll, 3000);
    poll();
    return () => clearInterval(interval);
  }, [managerSession, runId, fetchWithNamespace]);

  const handleReply = async () => {
    if (!replyText.trim() || !managerSession) return;
    setReplying(true);
    try {
      const replyUrl = runId
        ? `/api/links/runs/${encodeURIComponent(runId)}/reply`
        : `/api/swarm/${encodeURIComponent(managerSession)}/reply`;
      const res = await fetchWithNamespace(replyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reply: replyText }),
      });
      if (res.ok) {
        setReplyText("");
        setPending(false);
      }
    } catch {} finally {
      setReplying(false);
    }
  };

  // poll for session status
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetchWithNamespace("/api/terminal/status");
        if (!res.ok) return;
        const data = await res.json();
        const sessions: string[] = data.sessions || [];
        setAliveA(sessions.includes(sessionA));
        setAliveB(sessions.includes(sessionB));
        if (managerSession) {
          setAliveManager(sessions.includes(managerSession));
        }
      } catch {}
    };

    const interval = setInterval(check, 2000);
    check();
    return () => clearInterval(interval);
  }, [sessionA, sessionB, managerSession, fetchWithNamespace]);

  const handleActivityA = useCallback((activity: { type: string; at: number }) => {
    setActivityA(activity.type === "active" ? "active" : "idle");
  }, []);

  const handleActivityB = useCallback((activity: { type: string; at: number }) => {
    setActivityB(activity.type === "active" ? "active" : "idle");
  }, []);

  const [copiedA, setCopiedA] = useState(false);
  const [copiedB, setCopiedB] = useState(false);

  const handleCopy = useCallback(async (session: string, side: "a" | "b") => {
    try {
      const res = await fetchWithNamespace(`/api/terminal/capture?session=${session}&lines=200`);
      if (!res.ok) return;
      const data = await res.json();
      copyToClipboard(data.output || "");
      if (side === "a") {
        setCopiedA(true);
        setTimeout(() => setCopiedA(false), 2000);
      } else {
        setCopiedB(true);
        setTimeout(() => setCopiedB(false), 2000);
      }
    } catch {}
  }, [fetchWithNamespace]);

  const getActivityLabel = (activity: AgentActivity) => {
    return activity === "active" ? "working..." : "";
  };

  const getActivityColor = (activity: AgentActivity) => {
    return activity === "active" ? "bg-blue-400 animate-pulse" : "bg-foreground/20";
  };

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* header */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-card shrink-0 border-b border-border/10">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-medium">peer collaboration</h1>
          <div className="flex items-center gap-3 text-xs text-foreground/50">
            <span>{labelA}</span>
            <span className="text-foreground/20">↔</span>
            <span>{labelB}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-foreground/40 font-mono">
          <span className={aliveA ? "text-green-400" : "text-foreground/20"}>
            {aliveA ? "●" : "○"} {sessionA.slice(0, 20)}
          </span>
          <span className="text-foreground/20">|</span>
          <span className={aliveB ? "text-green-400" : "text-foreground/20"}>
            {aliveB ? "●" : "○"} {sessionB.slice(0, 20)}
          </span>
          {managerSession && (
            <>
              <span className="text-foreground/20">|</span>
              <span className={aliveManager ? "text-amber-400" : "text-foreground/20"}>
                {aliveManager ? "●" : "○"} manager
              </span>
            </>
          )}
        </div>
      </div>

      {/* peer terminals - top */}
      <div className="flex-1 min-h-0 flex gap-1 bg-border/10 p-1">
        {/* peer-1 - left */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#1a1a1a] rounded-sm overflow-hidden">
          <div className="px-3 py-1 bg-muted/30 text-[10px] font-mono text-foreground/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              {labelA}
            </div>
            <div className="flex items-center gap-2">
              {activityA !== "idle" && (
                <div className="flex items-center gap-1.5">
                  <div className={`w-1 h-1 rounded-full ${getActivityColor(activityA)}`} />
                  <span className="text-[9px] text-foreground/50">{getActivityLabel(activityA)}</span>
                </div>
              )}
              <button
                onClick={() => handleCopy(sessionA, "a")}
                className="p-0.5 rounded hover:bg-foreground/10 transition-colors"
                title="copy terminal output"
              >
                {copiedA ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-foreground/40" />}
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 min-h-0">
            <TerminalPanel
              session={sessionA}
              sessionAlive={aliveA}
              wsUrl={wsUrl}
              readOnly={false}
              compact
              onActivity={handleActivityA}
            />
          </div>
        </div>

        {/* peer-2 - right */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#1a1a1a] rounded-sm overflow-hidden">
          <div className="px-3 py-1 bg-muted/30 text-[10px] font-mono text-foreground/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              {labelB}
            </div>
            <div className="flex items-center gap-2">
              {activityB !== "idle" && (
                <div className="flex items-center gap-1.5">
                  <div className={`w-1 h-1 rounded-full ${getActivityColor(activityB)}`} />
                  <span className="text-[9px] text-foreground/50">{getActivityLabel(activityB)}</span>
                </div>
              )}
              <button
                onClick={() => handleCopy(sessionB, "b")}
                className="p-0.5 rounded hover:bg-foreground/10 transition-colors"
                title="copy terminal output"
              >
                {copiedB ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-foreground/40" />}
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 min-h-0">
            <TerminalPanel
              session={sessionB}
              sessionAlive={aliveB}
              wsUrl={wsUrl}
              readOnly={false}
              compact
              onActivity={handleActivityB}
            />
          </div>
        </div>
      </div>

      {/* manager/escalation pane - bottom */}
      {managerSession && (
        <div className={`${managerOpen ? "h-44 shrink-0" : "h-8 shrink-0"} min-h-0 p-4 flex flex-col bg-[#1a1a1a] mx-1 mb-1 rounded-sm overflow-hidden transition-all`}>
          {/* header */}
          <div
            className="px-3 py-1.5 bg-muted/30 text-[10px] font-mono text-foreground/60 flex items-center justify-between cursor-pointer shrink-0"
            onClick={() => setManagerOpen(!managerOpen)}
          >
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full bg-amber-400 ${pending ? "animate-pulse" : ""}`} />
              Manager
              <span className="text-foreground/30">escalation channel</span>
              {escalations.length > 0 && (
                <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-px rounded-full">
                  {escalations.length}
                </span>
              )}
              {telegramConnected && (
                <span className="text-[9px] text-foreground/30">via Telegram</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {managerOpen
                ? <ChevronDown className="h-3 w-3 text-foreground/40" />
                : <ChevronUp className="h-3 w-3 text-foreground/40" />
              }
            </div>
          </div>

          {managerOpen && (
            <>
              {/* amber banner when pending */}
              {pending && escalations.length > 0 && (() => {
                const last = escalations[escalations.length - 1];
                return (
                  <div className="shrink-0 px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-amber-400">
                        round {last.round} — {triggerLabel(last.trigger)} — reply to unblock
                      </span>
                      {last.haiku_summary && (
                        <p className="text-[10px] text-foreground/40 truncate mt-0.5">{last.haiku_summary}</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* terminal logs */}
              <div className="flex-1 min-h-0">
                <TerminalPanel
                  session={managerSession}
                  sessionAlive={aliveManager}
                  wsUrl={wsUrl}
                  readOnly={false}
                  compact
                />
              </div>

              {/* steer input — always visible */}
              <div className={`shrink-0 flex items-center gap-2 px-3 py-2 border-t ${pending ? "border-amber-500/20" : "border-foreground/5"} bg-[#1c1c1c]`}>
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(); } }}
                  placeholder={pending ? "reply to unblock, or 'continue' to resume..." : "steer the conversation..."}
                  className="flex-1 text-[11px] bg-muted/20 px-2 py-1.5 rounded-sm border-0 focus:outline-none focus:ring-1 focus:ring-amber-500/40 text-foreground/80 placeholder:text-foreground/30"
                />
                <button
                  onClick={handleReply}
                  disabled={!replyText.trim() || replying}
                  className="p-1.5 rounded-sm bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-40 transition-colors"
                  title="steer conversation"
                >
                  <Send className="h-3 w-3" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
