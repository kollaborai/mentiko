"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CommandSquareFilled,
  CloseCircleFilled,
  AddFilled,
  RefreshFilled,
  SearchNormalFilled,
  MaximizeFilled,
  Minimize,
  CopyFilled,
  TickCircleFilled,
  KeyboardFilled,
  More2Filled,
  AttachCircleFilled,
  ColorSwatchFilled,
  DangerFilled,
} from "@aliimam/icons";
import { copyToClipboard } from "@/lib/ui/copy-to-clipboard";
import { TerminalViewer } from "@/components/terminal/terminal-viewer";
import { useTerminalWsConnection } from "@/components/terminal/use-terminal-ws-connection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { usePillNavPreferences, getPillNavShineGradient } from "@/lib/ui/pill-nav-preferences";
import { useTerminalPreferences } from "@/lib/ui/terminal-preferences";
import { unwrapApiData } from "@/lib/api/api-client";
import { FLOATING_SURFACE_Z } from "@/lib/ui/floating-surface-z";

interface PtySession {
  name: string;
  alive: boolean;
  pid?: number;
  color?: string;
  pinned?: boolean;
}

const SESSION_COLORS = [
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#5b9ef5" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Red", value: "#ef4444" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Pink", value: "#ec4899" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Orange", value: "#f97316" },
  { label: "Cyan", value: "#06b6d4" },
  { label: "Purple", value: "#a855f7" },
];

type PanelSize = "normal" | "maximized";

interface PanelGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = "floating-terminal-geometry";
const DEFAULT_GEO: PanelGeometry = { x: -1, y: -1, w: 900, h: 560 }; // -1 = use CSS default (bottom-right)
const MIN_W = 400;
const MIN_H = 280;
const MOBILE_BREAKPOINT = 640;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isFloatingTerminalSession(sessionName: string): boolean {
  return sessionName.startsWith("term-");
}

function loadGeo(): PanelGeometry {
  if (typeof window === "undefined") return DEFAULT_GEO;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_GEO, ...JSON.parse(stored) } : DEFAULT_GEO;
  } catch { return DEFAULT_GEO; }
}

function saveGeo(geo: PanelGeometry) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(geo)); } catch { /* ignore */ }
}

export function FloatingTerminalPanel() {
  const { workspacePath, workspaceId, workspaceReady, refetch: refetchWorkspaces } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<PtySession[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const [panelSize, setPanelSize] = useState<PanelSize>("normal");
  const [terminalKey, setTerminalKey] = useState(0);
  const [geo, setGeo] = useState<PanelGeometry>(DEFAULT_GEO);

  const [searchQuery, setSearchQuery] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [copiedSession, setCopiedSession] = useState<string | null>(null);
  const { prefs: pillPrefs } = usePillNavPreferences();
  const { prefs: terminalPrefs } = useTerminalPreferences();
  const shineColors = getPillNavShineGradient(pillPrefs);

  const [isMobile, setIsMobile] = useState(false);
  const [sessionListOpen, setSessionListOpen] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startY: number; startPanelX: number; startPanelY: number } | null>(null);
  const resizeState = useRef<{ startX: number; startY: number; startW: number; startH: number; startPanelX: number; startPanelY: number; edge: string } | null>(null);
  const requestedSessionRef = useRef<string | null>(null);
  const {
    refreshToken,
    refreshUrl: fetchWsUrl,
    status: wsStatus,
    wsUrl,
  } = useTerminalWsConnection(undefined, { enabled: open });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/pty/sessions");
      if (!res.ok) return;
      const data = unwrapApiData<{ sessions?: PtySession[] }>(await res.json());
      if (Array.isArray(data.sessions)) {
        setSessions(data.sessions.filter((s) => s.alive));
      }
    } catch {
      // pty-manager not running
    }
  }, []);

  const resolveWorkspacePathForSpawn = useCallback(async () => {
    const currentPath = workspacePath.trim();
    if (currentPath) return currentPath;
    if (!workspaceId || workspaceReady) return "";

    try {
      const loadedWorkspaces = await refetchWorkspaces();
      return loadedWorkspaces.find((workspace) => workspace.id === workspaceId)?.path?.trim() ?? "";
    } catch {
      return "";
    }
  }, [refetchWorkspaces, workspaceId, workspacePath, workspaceReady]);

  const ensureSessionCwd = useCallback(async (sessionName: string) => {
    const targetPath = workspacePath.trim();
    if (
      !terminalPrefs.autoCdFloatingTerminalToWorkspace ||
      !targetPath ||
      !isFloatingTerminalSession(sessionName)
    ) {
      return;
    }

    try {
      await fetch(`/api/pty/sessions/${encodeURIComponent(sessionName)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `cd ${shellQuote(targetPath)}\r` }),
      });
    } catch {
      // attaching should not fail just because the pty daemon is unavailable
    }
  }, [terminalPrefs.autoCdFloatingTerminalToWorkspace, workspacePath]);

  useEffect(() => {
    const handleToggle = () => setOpen((v) => !v);
    const handleOpenSession = async (e: Event) => {
      const detail = (e as CustomEvent<{ session: string }>).detail;
      setOpen(true);
      // delay fetch so the spawned session has time to register
      await new Promise(resolve => setTimeout(resolve, 500));
      void fetchSessions();
      await fetchWsUrl(); // fresh token before mounting viewer
      if (detail?.session) {
        requestedSessionRef.current = detail.session;
        setActiveSession(detail.session);
        setTerminalKey((k) => k + 1);
      }
    };
    window.addEventListener("toggle-terminal-panel", handleToggle);
    window.addEventListener("open-terminal-session", handleOpenSession);
    return () => {
      window.removeEventListener("toggle-terminal-panel", handleToggle);
      window.removeEventListener("open-terminal-session", handleOpenSession);
    };
  }, [fetchSessions, fetchWsUrl]);

  useEffect(() => {
    if (open) {
      fetchSessions();
      fetchWsUrl();
    }
  }, [open, fetchSessions, fetchWsUrl]);

  useEffect(() => {
    // if a session was explicitly requested, keep it even if not in the list yet
    if (requestedSessionRef.current) {
      if (sessions.some((s) => s.name === requestedSessionRef.current)) {
        // session appeared in list, clear the lock
        requestedSessionRef.current = null;
      }
      // either way, don't override activeSession while waiting
      return;
    }

    if (!sessions.length) {
      if (activeSession !== null) {
        setActiveSession(null);
      }
      return;
    }

    if (activeSession && sessions.some((session) => session.name === activeSession)) {
      return;
    }

    const fallbackSession = sessions.find((session) => session.alive)?.name ?? sessions[0]?.name ?? null;
    if (fallbackSession !== activeSession) {
      setActiveSession(fallbackSession);
      setTerminalKey((key) => key + 1);
    }
  }, [activeSession, sessions]);

  useEffect(() => {
    if (!open || !activeSession) return;
    void ensureSessionCwd(activeSession);
  }, [activeSession, ensureSessionCwd, open, terminalKey]);

  const spawnNew = useCallback(async () => {
    setSpawning(true);
    try {
      const name = `term-${Date.now()}`;
      const resolvedWorkspacePath = await resolveWorkspacePathForSpawn();
      const res = await fetch("/api/terminal/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          cwd: resolvedWorkspacePath || undefined,
          workspaceId: workspaceId || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchSessions();
        await fetchWsUrl(); // fresh single-use token per connection
        setActiveSession(data.name || name);
        setTerminalKey((k) => k + 1);
      }
    } finally {
      setSpawning(false);
    }
  }, [fetchSessions, fetchWsUrl, resolveWorkspacePathForSpawn, workspaceId]);

  const attachSession = async (name: string) => {
    await fetchWsUrl(); // fresh single-use token per connection
    setActiveSession(name);
    setTerminalKey((k) => k + 1);
  };

  const killSession = async (name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    let remainingSessions: PtySession[] = [];
    setSessions((current) => {
      remainingSessions = current.filter((session) => session.name !== name);
      return remainingSessions;
    });
    setCopiedSession((current) => (current === name ? null : current));

    if (activeSession === name) {
      const fallbackSession =
        remainingSessions.find((session) => session.alive)?.name ?? remainingSessions[0]?.name ?? null;
      setActiveSession(fallbackSession);
      setTerminalKey((key) => key + 1);
    }

    try {
      await fetch(`/api/pty/sessions/${encodeURIComponent(name)}`, { method: "DELETE" });
    } catch {
      // pty-manager may already be gone
    }
  };

  const togglePin = (name: string) => {
    setSessions((current) =>
      current.map((session) =>
        session.name === name ? { ...session, pinned: !session.pinned } : session
      )
    );
  };

  const setSessionColor = (name: string, color: string) => {
    setSessions((current) =>
      current.map((session) =>
        session.name === name ? { ...session, color } : session
      )
    );
  };

  const copySessionName = async (name: string) => {
    copyToClipboard(name);
    setCopiedSession(name);
    window.setTimeout(() => {
      setCopiedSession((current) => (current === name ? null : current));
    }, 2000);
  };

  // sort sessions: pinned first, then by name
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return a.name.localeCompare(b.name);
  });

  const filteredSessions = sortedSessions.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "k") {
          e.preventDefault();
          setSearchQuery("");
          const input = document.querySelector<HTMLInputElement>("input[data-terminal-search]");
          input?.focus();
        }
        if (e.key === "n") {
          e.preventDefault();
          void spawnNew();
        }
        if (e.key === "/") {
          e.preventDefault();
          setShowShortcuts(v => !v);
        }
      }
      if (e.key === "Escape") {
        if (showShortcuts) {
          setShowShortcuts(false);
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, showShortcuts, spawnNew]);

  // load persisted geometry once on mount
  useEffect(() => { setGeo(loadGeo()); }, []);

  // drag handlers
  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (panelSize === "maximized") return;
    e.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragState.current = { startX: e.clientX, startY: e.clientY, startPanelX: rect.left, startPanelY: rect.top };
    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      const dx = ev.clientX - dragState.current.startX;
      const dy = ev.clientY - dragState.current.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 100, dragState.current.startPanelX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 40, dragState.current.startPanelY + dy));
      setGeo((g) => { const next = { ...g, x: newX, y: newY }; saveGeo(next); return next; });
    };
    const onUp = () => { dragState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelSize]);

  // resize handlers
  const onResizeMouseDown = useCallback((e: React.MouseEvent, edge: string) => {
    if (panelSize === "maximized") return;
    e.preventDefault();
    e.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    resizeState.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height, startPanelX: rect.left, startPanelY: rect.top, edge };
    const onMove = (ev: MouseEvent) => {
      if (!resizeState.current) return;
      const { startX, startY, startW, startH, startPanelX, startPanelY, edge: ed } = resizeState.current;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let newW = startW, newH = startH, newX = startPanelX, newY = startPanelY;
      if (ed.includes("e")) newW = Math.max(MIN_W, startW + dx);
      if (ed.includes("s")) newH = Math.max(MIN_H, startH + dy);
      if (ed.includes("w")) { newW = Math.max(MIN_W, startW - dx); newX = startPanelX + (startW - newW); }
      if (ed.includes("n")) { newH = Math.max(MIN_H, startH - dy); newY = startPanelY + (startH - newH); }
      setGeo((g) => { const next = { ...g, x: newX, y: newY, w: newW, h: newH }; saveGeo(next); return next; });
    };
    const onUp = () => { resizeState.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelSize]);

  const isMax = panelSize === "maximized" || isMobile;
  const panelStyle = isMax
    ? {}
    : geo.x < 0
      ? { bottom: "1rem", right: "1rem", width: geo.w, height: geo.h }
      : { left: geo.x, top: geo.y, width: geo.w, height: geo.h };

  return (
    <AnimatePresence>
    {open && (
    <motion.div
      ref={panelRef}
      data-terminal-panel=""
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}
      style={{ ...panelStyle, zIndex: FLOATING_SURFACE_Z.terminalPanel }}
      className={cn(
        "fixed flex flex-col rounded-xl",
        "bg-background/75 dark:bg-[#060606]/75 backdrop-blur-xl",
        "shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(0,0,0,0.6)]",
        "text-foreground/80 dark:text-white/80",
        isMax && "inset-4"
      )}
    >
      {/* shine border */}
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-[inherit] pointer-events-none z-[60]"
        style={{
          padding: "1px",
          backgroundImage: `radial-gradient(transparent, transparent, ${shineColors}, transparent, transparent)`,
          backgroundSize: "300% 300%",
          animation: "sb-shine-pulse 14s linear infinite",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
          mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          maskComposite: "exclude" as unknown as string,
        }}
      />

      {/* header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 sm:px-4 py-2 shrink-0",
          !isMobile && (isMax ? "cursor-default" : "cursor-grab active:cursor-grabbing"),
        )}
        style={{ borderBottom: "1px solid color-mix(in oklch, var(--foreground) 6%, transparent)" }}
        onMouseDown={isMobile ? undefined : onDragMouseDown}
      >
        <div className="flex items-center gap-2 sm:gap-3">
          {isMobile && (
            <button
              onClick={() => setSessionListOpen(v => !v)}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg transition-colors",
                sessionListOpen ? "text-cyan-400/80 bg-cyan-400/10" : "text-foreground/40 dark:text-white/40 hover:text-foreground/70 dark:hover:text-white/70 hover:bg-foreground/10 dark:hover:bg-white/10",
              )}
              title="Sessions"
            >
              <CommandSquareFilled className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-2">
            {!isMobile && <CommandSquareFilled className="h-4 w-4 text-cyan-400/80" />}
            <span className="text-xs font-bold tracking-tight text-foreground/80 dark:text-white/80 truncate max-w-[120px] sm:max-w-none">
              {activeSession || "Terminal"}
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
          </div>
          <span className="text-[10px] text-foreground/20 dark:text-white/20 font-mono hidden sm:inline">
            {sessions.filter((session) => session.alive).length} live
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={spawnNew}
            disabled={spawning || wsStatus === "down"}
            title="New terminal"
            className="flex items-center gap-1 h-8 sm:h-7 rounded-lg px-2.5 text-[11px] text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {spawning ? <RefreshFilled className="h-3.5 w-3.5 animate-spin" /> : <AddFilled className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">New</span>
          </button>
          <button
            onClick={() => void fetchSessions()}
            className="flex items-center justify-center w-8 h-8 sm:w-7 sm:h-7 rounded-lg text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
            title="Refresh sessions"
          >
            <RefreshFilled className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowShortcuts((value) => !value)}
            className="hidden sm:flex items-center justify-center w-7 h-7 rounded-lg text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
            title="Keyboard shortcuts (Cmd+/)"
          >
            <KeyboardFilled className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setPanelSize((size) => (size === "maximized" ? "normal" : "maximized"))}
            className="hidden sm:flex items-center justify-center w-7 h-7 rounded-lg text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
            title={isMax ? "Restore" : "Maximize"}
          >
            {isMax ? <Minimize className="h-3.5 w-3.5" /> : <MaximizeFilled className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => {
              setActiveSession(null);
              setOpen(false);
            }}
            className="flex items-center justify-center w-8 h-8 sm:w-7 sm:h-7 rounded-lg text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
            title="Close panel (sessions keep running)"
          >
            <CloseCircleFilled className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={cn("flex flex-1 min-h-0 overflow-hidden rounded-b-xl", isMobile && "flex-col")}>
        {/* session sidebar / mobile top panel */}
        <div
          className={cn(
            "flex shrink-0 flex-col bg-foreground/[0.02] dark:bg-white/[0.02]",
            isMobile
              ? sessionListOpen ? "max-h-[40%] overflow-hidden" : "hidden"
              : "w-56",
          )}
          style={isMobile
            ? { borderBottom: sessionListOpen ? "1px solid color-mix(in oklch, var(--foreground) 6%, transparent)" : undefined }
            : { borderRight: "1px solid color-mix(in oklch, var(--foreground) 6%, transparent)" }
          }
        >
          {/* ws-terminal status banner */}
          {wsStatus === "down" && (
            <div className="flex items-start gap-2 bg-amber-500/10 px-3 py-2" style={{ borderBottom: "1px solid rgba(245,158,11,0.15)" }}>
              <DangerFilled className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-amber-400 leading-tight">
                terminal server not running
                <br />
                <span className="text-amber-400/60">run: npm run ws:terminal</span>
              </p>
            </div>
          )}

          {/* search */}
          <div className="px-2 pt-2 pb-1">
            <div className="relative">
              <SearchNormalFilled className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-foreground/20 dark:text-white/20" />
              <input
                data-terminal-search
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter... (Cmd+K)"
                className="w-full rounded-lg bg-foreground/5 dark:bg-white/5 py-1.5 pl-7 pr-2 text-[10px] text-foreground/80 dark:text-white/80 placeholder:text-foreground/20 dark:placeholder:text-white/20 focus:bg-foreground/8 dark:focus:bg-white/8 focus:outline-none focus:ring-1 focus:ring-cyan-400/20 transition-colors"
              />
            </div>
          </div>

          {/* sessions */}
          <div className="flex-1 overflow-y-auto px-2 py-1.5">
            {wsStatus === "checking" ? (
              <p className="px-2 py-2 text-[10px] text-foreground/30 dark:text-white/30">connecting...</p>
            ) : filteredSessions.length === 0 ? (
              <p className="px-2 py-2 text-[10px] text-foreground/30 dark:text-white/30">
                {searchQuery ? "No matching sessions" : "No active sessions"}
              </p>
            ) : (
              filteredSessions.map((s) => (
                <div
                  key={s.name}
                  className={cn(
                    "group relative mb-1",
                    wsStatus !== "running" ? "opacity-40 cursor-not-allowed" : ""
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors",
                      wsStatus !== "running" ? "cursor-not-allowed" :
                      activeSession === s.name
                        ? "bg-foreground/10 dark:bg-white/10 shadow-sm"
                        : "hover:bg-foreground/5 dark:hover:bg-white/5"
                    )}
                  >
                    <button
                      onClick={() => { if (wsStatus === "running") { attachSession(s.name); if (isMobile) setSessionListOpen(false); } }}
                      disabled={wsStatus !== "running"}
                      className="flex min-w-0 flex-1 items-center gap-2 pr-8 text-left"
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          s.alive ? "bg-green-400" : "bg-foreground/20 dark:bg-white/20"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="truncate font-mono text-[11px] font-medium text-foreground/80 dark:text-white/80"
                            style={{ color: s.color || undefined }}
                          >
                            {s.name}
                          </span>
                          {s.pinned && <AttachCircleFilled className="h-3 w-3 shrink-0 text-foreground/30 dark:text-white/30" />}
                        </div>
                        <p className="text-[10px] text-foreground/30 dark:text-white/30">
                          {s.alive ? "Live session" : "Session ended"}
                        </p>
                      </div>
                    </button>

                    <div className={cn(
                      "absolute right-2 top-2 flex items-center gap-0.5",
                      activeSession === s.name
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    )}>
                      <button
                        type="button"
                        onClick={(e) => void killSession(s.name, e)}
                        className="rounded-md p-1 text-foreground/30 dark:text-white/30 transition hover:bg-red-500/20 hover:text-red-400"
                        title="Close session"
                      >
                        <CloseCircleFilled className="h-3.5 w-3.5" />
                      </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-md p-1 text-foreground/30 dark:text-white/30 transition hover:bg-foreground/10 dark:hover:bg-white/10 hover:text-foreground/60 dark:hover:text-white/60"
                          title={`Session actions for ${s.name}`}
                        >
                          <More2Filled className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => attachSession(s.name)}>
                          <CommandSquareFilled className="h-3.5 w-3.5" />
                          Open
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => togglePin(s.name)}>
                          <AttachCircleFilled className="h-3.5 w-3.5" />
                          {s.pinned ? "Unpin" : "Pin"}
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <ColorSwatchFilled className="h-3.5 w-3.5" />
                            Accent color
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-40">
                            {SESSION_COLORS.map((color) => (
                              <DropdownMenuItem
                                key={color.value}
                                onSelect={() => setSessionColor(s.name, color.value)}
                              >
                                <span
                                  className="h-3 w-3 rounded-full"
                                  style={{ backgroundColor: color.value }}
                                />
                                {color.label}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setSessionColor(s.name, "")}>
                              <CloseCircleFilled className="h-3.5 w-3.5" />
                              Clear color
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onSelect={() => void copySessionName(s.name)}>
                          {copiedSession === s.name ? (
                            <TickCircleFilled className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <CopyFilled className="h-3.5 w-3.5" />
                          )}
                          {copiedSession === s.name ? "Copied name" : "Copy name"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* footer */}
          <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid color-mix(in oklch, var(--foreground) 6%, transparent)" }}>
            <span className="text-[10px] text-foreground/30 dark:text-white/30">
              {sessions.filter((session) => session.alive).length} alive
            </span>
            <span className="text-[10px] text-foreground/20 dark:text-white/20 hidden sm:inline">Cmd+N new terminal</span>
          </div>
        </div>

        {/* terminal area */}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {wsStatus === "down" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
              <DangerFilled className="h-8 w-8 text-amber-400/50" />
              <p className="text-sm text-foreground/40 dark:text-white/40">Terminal server not running</p>
              <p className="text-[11px] font-mono text-foreground/25 dark:text-white/25">npm run ws:terminal</p>
              <button
                onClick={() => { void fetchWsUrl(); }}
                className="mt-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-foreground/40 dark:text-white/40 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
              >
                <RefreshFilled className="h-3 w-3" /> Retry
              </button>
            </div>
          ) : !activeSession ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <CommandSquareFilled className="h-8 w-8 text-foreground/10 dark:text-white/10" />
              <p className="text-xs text-foreground/30 dark:text-white/30">Select a session or start a new one</p>
              <button
                onClick={spawnNew}
                disabled={spawning}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-foreground/50 dark:text-white/50 bg-foreground/5 dark:bg-white/5 hover:bg-foreground/10 dark:hover:bg-white/10 hover:text-foreground/70 dark:hover:text-white/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <AddFilled className="h-3 w-3" />
                New Terminal
              </button>
            </div>
          ) : !wsUrl ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1a] rounded-br-xl">
              <p className="text-xs text-foreground/30 dark:text-white/30">connecting...</p>
            </div>
          ) : (
            <div className="relative h-full w-full overflow-hidden bg-[#1a1a1a] rounded-br-xl">
              <TerminalViewer
                key={`${activeSession}-${terminalKey}`}
                session={activeSession}
                wsUrl={wsUrl}
                readOnly={false}
                className="absolute inset-0"
                contentClassName="inset-3"
                onRefreshToken={refreshToken}
              />
            </div>
          )}
        </div>
      </div>

      {/* keyboard shortcuts modal */}
      {showShortcuts && (
        <div
          role="presentation"
          tabIndex={-1}
          className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowShortcuts(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowShortcuts(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl bg-background/95 dark:bg-[#0e0e0e]/95 backdrop-blur-xl p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_60px_rgba(0,0,0,0.6)]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-foreground/80 dark:text-white/80">Keyboard Shortcuts</h3>
              <button
                onClick={() => setShowShortcuts(false)}
                className="flex items-center justify-center w-6 h-6 rounded-full text-foreground/30 dark:text-white/30 hover:text-foreground/60 dark:hover:text-white/60 hover:bg-foreground/5 dark:hover:bg-white/5 transition-colors"
              >
                <CloseCircleFilled className="h-3 w-3" />
              </button>
            </div>
            <div className="space-y-2 text-[10px]">
              <div className="flex justify-between text-foreground/40 dark:text-white/40">
                <span>New terminal</span>
                <kbd className="rounded bg-foreground/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-foreground/30 dark:text-white/30">Cmd+N</kbd>
              </div>
              <div className="flex justify-between text-foreground/40 dark:text-white/40">
                <span>Filter sessions</span>
                <kbd className="rounded bg-foreground/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-foreground/30 dark:text-white/30">Cmd+K</kbd>
              </div>
              <div className="flex justify-between text-foreground/40 dark:text-white/40">
                <span>Toggle shortcuts</span>
                <kbd className="rounded bg-foreground/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-foreground/30 dark:text-white/30">Cmd+/</kbd>
              </div>
              <div className="flex justify-between text-foreground/40 dark:text-white/40">
                <span>Close panel</span>
                <kbd className="rounded bg-foreground/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-foreground/30 dark:text-white/30">Esc</kbd>
              </div>
              <div className="flex justify-between text-foreground/40 dark:text-white/40">
                <span>Session actions</span>
                <kbd className="rounded bg-foreground/5 dark:bg-white/5 px-1.5 py-0.5 font-mono text-foreground/30 dark:text-white/30">...</kbd>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* resize handles - MUST be last children so they paint on top of everything */}
      {!isMax && (
        <>
          <div className="absolute top-0 left-5 right-5 h-2" style={{ cursor: "ns-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "n")} />
          <div className="absolute bottom-0 left-5 right-5 h-2" style={{ cursor: "ns-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "s")} />
          <div className="absolute left-0 top-5 bottom-5 w-2" style={{ cursor: "ew-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "w")} />
          <div className="absolute right-0 top-5 bottom-5 w-2" style={{ cursor: "ew-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "e")} />
          <div className="absolute bottom-0 right-0 w-5 h-5" style={{ cursor: "nwse-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "se")} />
          <div className="absolute bottom-0 left-0 w-5 h-5" style={{ cursor: "nesw-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "sw")} />
          <div className="absolute top-0 right-0 w-5 h-5" style={{ cursor: "nesw-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "ne")} />
          <div className="absolute top-0 left-0 w-5 h-5" style={{ cursor: "nwse-resize", zIndex: 9999 }} onMouseDown={(e) => onResizeMouseDown(e, "nw")} />
        </>
      )}
    </motion.div>
    )}
    </AnimatePresence>
  );
}
