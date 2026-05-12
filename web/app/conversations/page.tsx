
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { DetailHeader } from "@/components/ui/detail-header";
import { Input } from "@/components/ui/input";
import { SessionComposer } from "@/components/ui/session-composer";
import {
  WorkflowSidebarPane,
  WorkflowSidebarFilters,
  WorkflowSidebarSearchInput,
  WorkflowSidebarItem,
  WorkflowSidebarResizeHandle,
} from "@/components/ui/workflow-sidebar";
import { EmptyState } from "@/components/empty-state";
import {
  Setting2Filled,
  ProfileCircleFilled,
  BotMessageSquare,
  ArrowDown1Filled,
  TickCircleFilled,
  CloseCircleFilled,
  MessageCircleFilled,
  RouteSquareFilled,
  TaskSquareFilled,
} from "@aliimam/icons";
import { TimeAgo } from "@/components/shared/time-ago";
import { useWorkspace } from "@/lib/workspace-context";
import { useNamespaceFetch } from "@/lib/use-namespace-fetch";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import { PageBanner } from "@/components/ui/page-banner";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api-client";

function getAgentAccent(role: string): string {
  const r = role.toLowerCase();
  if (r === "claude") return "bg-violet-400";
  if (r === "codex") return "bg-sky-400";
  if (r === "kollabor") return "bg-amber-400";
  if (r === "aider") return "bg-rose-400";
  // chain-spawned agents get a muted accent
  if (r) return "bg-sky-300";
  return "bg-foreground/20";
}

interface Conversation {
  sessionId: string;
  slug: string;
  startTime: string;
  lastModified: string;
  sizeKb: number;
  messageCount: number;
  firstMessage: string;
  agentRole: string;
}

interface Message {
  type: "user" | "assistant" | "tool_use" | "tool_result";
  timestamp?: string;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
}

interface PtySession {
  name: string;
  created: string;
}

const SCROLL_THRESHOLD = 100;
const SIDEBAR_KEY = "conversations-sidebar-width";
const MIN_W = 280;
const MAX_W = 600;
const DEFAULT_W = 340;

export default function ConversationsPage() {
  const { workspacePath, workspaceReady } = useWorkspace();
  const { fetchWithNamespace } = useNamespaceFetch();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [cwd, setCwd] = useState("");
  const [inputCwd, setInputCwd] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgTotal, setMsgTotal] = useState(0);
  const [msgLoading, setMsgLoading] = useState(false);
  const [showToolResults, setShowToolResults] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_W);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const prevMsgTotalRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const [sessions, setSessions] = useState<PtySession[]>([]);
  const [editingId, setEditingId] = useState<string>("");
  const [editSlug, setEditSlug] = useState<string>("");

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(DEFAULT_W);
  const selectedRef = useRef<string>("");

  // sync cwd with workspace context and clear stale selection
  useEffect(() => {
    if (workspacePath) {
      setCwd(workspacePath);
      setInputCwd(workspacePath);
    }
    // clear selection when workspace changes to avoid showing
    // stale detail panel from the previous workspace
    setSelected("");
    selectedRef.current = "";
    setMessages([]);
    setMsgTotal(0);
    setMobileView("list");
    hasLoadedRef.current = false;
  }, [workspacePath]);

  // load saved sidebar width
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved) {
      const width = parseInt(saved, 10);
      if (width >= MIN_W && width <= MAX_W) setSidebarWidth(width);
    }
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  // Check if a conversation has a live session
  const checkHasLiveSession = useCallback((conv: Conversation) => {
    const idLower = conv.sessionId.toLowerCase();
    const slugLower = conv.slug.toLowerCase();
    const roleLower = conv.agentRole.toLowerCase();
    return sessions.some((s) => {
      const n = s.name.toLowerCase();
      return n === idLower || n.startsWith(idLower) || n.includes(idLower)
        || (slugLower && n.includes(slugLower))
        || (roleLower && n.includes(roleLower));
    });
  }, [sessions]);

  const sendSteerMessage = useCallback(async (message: string) => {
    if (!message.trim() || !selected) return;
    try {
      const res = await fetchWithNamespace(`/api/conversations/${encodeURIComponent(selected)}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, cwd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error("steer failed:", getApiErrorMessage(data, String(res.status)));
      }
    } catch (err) {
      console.error("steer error:", err);
    }
  }, [selected, cwd, fetchWithNamespace]);

  const fetchConversations = useCallback(async (projectCwd?: string) => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const res = await fetchWithNamespace(
        `/api/conversations?cwd=${encodeURIComponent(projectCwd || cwd)}&limit=50&countAll=true`
      );
      const data = await res.json();
      const sorted = (data.conversations || []).sort((a: Conversation, b: Conversation) => {
        const aHour = a.lastModified ? Math.floor(new Date(a.lastModified).getTime() / (1000 * 60 * 60)) : 0;
        const bHour = b.lastModified ? Math.floor(new Date(b.lastModified).getTime() / (1000 * 60 * 60)) : 0;
        if (aHour !== bHour) return bHour - aHour;
        return (b.messageCount ?? 0) - (a.messageCount ?? 0);
      });
      setConversations((prev) => {
        if (prev.length !== sorted.length) return sorted;
        const changed = sorted.some(
          (s: Conversation, i: number) =>
            s.sessionId !== prev[i].sessionId || s.messageCount !== prev[i].messageCount
        );
        return changed ? sorted : prev;
      });
    } catch {
      // don't wipe conversations on poll error
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [cwd, fetchWithNamespace]);

  useEffect(() => {
    if (!workspaceReady) return;
    fetchConversations();
    const interval = setInterval(() => fetchConversations(), 10000);
    return () => clearInterval(interval);
  }, [cwd, workspaceReady, fetchConversations]);

  // Fetch live sessions for steering
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetchWithNamespace("/api/pty/sessions");
        const data = await res.json();
        setSessions(data.sessions || []);
      } catch {
        setSessions([]);
      }
    };
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchWithNamespace]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async () => {
    if (!selected) return;
    try {
      const res = await fetchWithNamespace(
        `/api/conversations/${selected}?cwd=${encodeURIComponent(cwd)}&mode=tail&tail=100`
      );
      if (!res.ok) return;
      const data = await res.json();
      const newTotal = data.total || 0;

      if (newTotal === prevMsgTotalRef.current && prevMsgTotalRef.current > 0) {
        return;
      }

      prevMsgTotalRef.current = newTotal;
      setMessages(data.messages || []);
      setMsgTotal(newTotal);
    } catch {
      // ignore
    } finally {
      setMsgLoading(false);
    }
  }, [selected, cwd, fetchWithNamespace]);

  useEffect(() => {
    if (!selected) return;
    prevMsgTotalRef.current = 0;
    setMsgLoading(true);
    setMessages([]);
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000);
    return () => clearInterval(interval);
  }, [selected, cwd, fetchMessages]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && nearBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, autoScroll]);

  const checkScroll = () => {
    const c = scrollRef.current;
    if (!c) return;
    const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
    nearBottomRef.current = dist < SCROLL_THRESHOLD;
  };

  const handleSearch = () => {
    setCwd(inputCwd);
    setSelected("");
    setMobileView("list");
    fetchConversations(inputCwd);
  };

  const selectedConv = conversations.find((c) => c.sessionId === selected);

  const startEdit = (conv: Conversation) => {
    setEditingId(conv.sessionId);
    setEditSlug(conv.slug || "");
  };

  const cancelEdit = () => {
    setEditingId("");
    setEditSlug("");
  };

  const saveSlug = async (sessionId: string) => {
    try {
      const res = await fetchWithNamespace(`/api/conversations/${encodeURIComponent(sessionId)}?cwd=${encodeURIComponent(cwd)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: editSlug.trim() || sessionId.slice(0, 12) }),
      });
      if (res.ok) {
        setConversations((prev) =>
          prev.map((c) =>
            c.sessionId === sessionId
              ? { ...c, slug: editSlug.trim() || c.slug }
              : c
          )
        );
        cancelEdit();
      }
    } catch {
      cancelEdit();
    }
  };



  const handleSelect = (sessionId: string) => {
    setSelected(sessionId);
    setMobileView("detail");
  };

  const onDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    dragging.current = true;
    startX.current = event.clientX;
    startW.current = sidebarWidth;

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      const delta = moveEvent.clientX - startX.current;
      const next = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
      setSidebarWidth(next);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSidebarWidth((width) => {
        localStorage.setItem(SIDEBAR_KEY, String(width));
        return width;
      });
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <PageBanner
        title="Conversations"
        subtitle="Browse and replay AI chat sessions across workspaces. View conversations from Claude, Codex, Kollabor, and Aider agents with full message history."
        icon={MessageCircleFilled}
        sectionColor="#5b9ef5"
        actions={[
          { label: "Runs", href: "/runs", icon: RouteSquareFilled, iconColor: "#5b9ef5" },
          { label: "Tasks", href: "/tasks", icon: TaskSquareFilled, iconColor: "#5b9ef5" },
          { label: "Agents", href: "/agents", icon: BotMessageSquare, iconColor: "#b07ee8" },
        ]}
        docs={[
          { label: "Conversations Guide", href: "/docs/conversations", icon: MessageCircleFilled },
        ]}
      />

      {/* List-Detail split */}
      <div className="flex flex-1 overflow-hidden pl-2 sm:pl-4">
        {/* Left: conversation list */}
        <WorkflowSidebarPane
          className={cn(mobileView === "detail" ? "hidden md:flex" : "flex")}
          style={{ width: sidebarWidth }}
        >
          <WorkflowSidebarFilters>
            <WorkflowSidebarSearchInput
              value={inputCwd}
              onChange={setInputCwd}
              placeholder="Project directory..."
            />
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" className="h-7 text-xs flex-1" onClick={handleSearch}>
                Search
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => fetchConversations()}>
                <ArrowDown1Filled className="h-3 w-3 rotate-180" />
              </Button>
            </div>
          </WorkflowSidebarFilters>

          <div className="flex-1 overflow-y-auto">
            {loading && conversations.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <WaveSpinner size="sm" color="primary" animation="ripple" />
              </div>
            ) : conversations.length === 0 ? (
              <EmptyState
                icon={<MessageCircleFilled className="h-8 w-8" />}
                title="No conversations"
                description="Start a chain to create conversations"
              />
            ) : (
              <div className="p-2 space-y-1">
                {conversations.map((conv) => {
                  const isLive = checkHasLiveSession(conv);
                  const isEditing = editingId === conv.sessionId;

                  return (
                    <WorkflowSidebarItem
                      key={conv.sessionId}
                      selected={selected === conv.sessionId}
                      onClick={() => !isEditing && handleSelect(conv.sessionId)}
                      accentClassName={isLive ? "bg-emerald-400" : getAgentAccent(conv.agentRole)}

                    >
                      <div className="pl-4">
                        {isEditing ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={editSlug}
                              onChange={(e) => setEditSlug(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveSlug(conv.sessionId);
                                if (e.key === "Escape") cancelEdit();
                              }}
                              onBlur={() => saveSlug(conv.sessionId)}
                              className="h-6 text-xs px-2 py-0 font-mono"
                              autoFocus
                            />
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => saveSlug(conv.sessionId)}>
                              <TickCircleFilled className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>
                              <CloseCircleFilled className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className="line-clamp-1 text-sm font-semibold leading-5 cursor-text"
                                onDoubleClick={() => startEdit(conv)}
                              >
                                {conv.slug || conv.sessionId.slice(0, 12)}
                              </span>
                              <TimeAgo date={conv.lastModified} format="short" suffix={false} className="shrink-0 !text-[10px] text-foreground/30" />
                            </div>

                            <p className="line-clamp-1 text-[11px] text-foreground/40 mt-0.5">
                              {conv.firstMessage || "No preview"}
                            </p>

                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-foreground/40">
                              {conv.agentRole && (
                                <span className="rounded-full bg-foreground/5 px-2 py-0.5 uppercase tracking-[0.14em]">
                                  {conv.agentRole}
                                </span>
                              )}
                              <span className="rounded-full bg-foreground/5 px-2 py-0.5">
                                {conv.messageCount} msgs
                              </span>
                              {isLive && (
                                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400 uppercase tracking-[0.14em]">
                                  live
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </WorkflowSidebarItem>
                  );
                })}
              </div>
            )}
          </div>

          <WorkflowSidebarResizeHandle onMouseDown={onDragStart} />
        </WorkflowSidebarPane>

        {/* Right: message viewer */}
        <div
          className={cn(
            mobileView === "list" ? "hidden md:flex" : "flex",
            "flex-1 flex-col min-w-0"
          )}
        >
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-xs text-foreground/30">
              Select a conversation
            </div>
          ) : (
            <>
              {/* Detail header */}
              <DetailHeader className="mx-3 mt-2 py-2 shrink-0">
                <div className="relative min-w-0 flex-1">
                  {mobileView === "detail" && (
                    <button
                      onClick={() => setMobileView("list")}
                      className="md:hidden text-xs text-foreground/50 hover:text-foreground mb-1"
                    >
                      &larr; back
                    </button>
                  )}
                  <h2 className="text-sm font-bold tracking-tighter truncate">
                    {selectedConv?.slug || selected.slice(0, 12)}
                  </h2>
                  <p className="text-xs text-foreground/50">{msgTotal} messages</p>
                </div>
                <div className="relative flex items-center gap-1 ml-4 shrink-0">
                  <Button
                    variant={showToolResults ? "default" : "ghost"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowToolResults(!showToolResults)}
                  >
                    <Setting2Filled className="mr-1 h-3 w-3" />
                    Results
                  </Button>
                  <Button
                    variant={autoScroll ? "default" : "ghost"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setAutoScroll(!autoScroll);
                      if (!autoScroll && bottomRef.current) {
                        bottomRef.current.scrollIntoView({ behavior: "smooth" });
                      }
                    }}
                  >
                    <ArrowDown1Filled className="mr-1 h-3 w-3" />
                    Scroll
                  </Button>
                </div>
              </DetailHeader>

              {/* Messages */}
              <div className="flex-1 overflow-hidden">
                {msgLoading ? (
                  <div className="h-full flex items-center justify-center">
                    <WaveSpinner size="sm" color="primary" animation="ripple" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-foreground/40">
                    No messages
                  </div>
                ) : (
                  <div
                    ref={scrollRef}
                    onScroll={checkScroll}
                    className="h-full overflow-y-auto px-4 py-2"
                  >
                    <div className="max-w-3xl space-y-0">
                      {messages.map((msg, idx) => renderMessage(msg, idx, showToolResults))}
                      <div ref={bottomRef} />
                    </div>
                  </div>
                )}
              </div>

              {/* Steering input */}
              <div className="shrink-0 px-4 py-2">
                <SessionComposer
                  placeholder={`Steer ${selectedConv?.slug || "session"}...`}
                  online={selectedConv ? checkHasLiveSession(selectedConv) : false}
                  onSubmit={sendSteerMessage}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtTs(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function renderMessage(msg: Message, idx: number, showToolResults: boolean) {
  if (msg.type === "user") {
    const ts = fmtTs(msg.timestamp);
    return (
      <div key={idx} className="flex gap-2 py-1.5">
        <div className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center">
          <ProfileCircleFilled className="h-2.5 w-2.5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          {ts && <span className="text-[10px] text-foreground/25 font-mono">{ts}</span>}
          <pre className="text-xs whitespace-pre-wrap break-words font-mono text-foreground/80">
            {msg.text || ""}
          </pre>
        </div>
      </div>
    );
  }

  if (msg.type === "assistant") {
    const ts = fmtTs(msg.timestamp);
    return (
      <div key={idx} className="flex gap-2 py-1.5">
        <div className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center">
          <BotMessageSquare className="h-2.5 w-2.5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          {ts && <span className="text-[10px] text-foreground/25 font-mono">{ts}</span>}
          <pre className="text-xs whitespace-pre-wrap break-words font-mono">
            {msg.text}
          </pre>
        </div>
      </div>
    );
  }

  if (msg.type === "tool_use") {
    return (
      <div key={idx} className="flex gap-2 py-0.5 pl-7">
        <Setting2Filled className="h-2.5 w-2.5 text-amber-500/70 shrink-0 mt-0.5" />
        <span className="text-xs font-mono text-amber-500/70">
          {msg.toolName}
          <span className="text-foreground/40 ml-1">
            {formatToolInput(msg.toolName || "", msg.toolInput || {})}
          </span>
        </span>
      </div>
    );
  }

  if (msg.type === "tool_result" && showToolResults) {
    return (
      <div key={idx} className="pl-7 py-0.5">
        <pre className="text-xs text-foreground/40 font-mono bg-card rounded-md px-2 py-1 max-h-24 overflow-y-auto">
          {(msg.toolResult || "").slice(0, 500)}
        </pre>
      </div>
    );
  }

  return null;
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "Read" || toolName === "Glob") {
    return String(input.file_path || input.pattern || "");
  }
  if (toolName === "Grep") {
    return `/${input.pattern}/ ${input.path || ""}`;
  }
  if (toolName === "Write" || toolName === "Edit") {
    return String(input.file_path || "");
  }
  if (toolName === "Bash") {
    const cmd = String(input.command || "");
    return cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
  }
  return JSON.stringify(input).slice(0, 60);
}
