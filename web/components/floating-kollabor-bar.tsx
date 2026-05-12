"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  useKollaborBarStore,
  KollaborMessage,
  KollaborAskRequest,
  DraftTool,
  SCALE_MIN,
  SCALE_MAX,
} from "@/lib/kollabor-bar-store";
import { useWorkspace } from "@/lib/workspace-context";
import { usePillNavPreferences, COLOR_SCHEME_GRADIENTS } from "@/lib/pill-nav-preferences";
import { cn } from "@/lib/utils";
import {
  getOrCreateSession,
  ensureMentikoAgentInstalled,
  sendMessage as engineSendMessage,
  respondToPermission as engineRespondToPermission,
  ping as enginePing,
} from "@/lib/kollabor-engine-client";
import { KollaborPermissionPrompt } from "@/components/kollabor-permission-prompt";
import { KollaborAskPrompt } from "@/components/kollabor-ask-prompt";
import {
  MCPBarClient,
  getStoredSessionToken,
  storeSessionToken,
} from "@/lib/mentiko-mcp-bar-client";
import type { UIEffect } from "@/lib/mentiko-mcp-inbox";
import { showToast } from "@/components/notifications-panel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { unwrapApiData } from "@/lib/api-client";

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SHOULD_OFFER_CODEX_INLINE_AUTH = false;
const HIDDEN_TOOL_CHIP_NAMES = new Set(["ask_confirm", "ask_input", "ask_choice"]);

function stringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function numberPayload(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" ? value : undefined;
}

function arrayPayload(payload: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = payload[key];
  return Array.isArray(value) ? value : undefined;
}

export function FloatingKollaborBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setWorkspaceId } = useWorkspace();
  const {
    expanded,
    inputValue,
    agent,
    connected,
    connecting,
    error,
    messages,
    drafting,
    sessionId,
    setExpanded,
    setInputValue,
    setConnected,
    setConnecting,
    setError,
    pushMessage,
    clearMessages,
    setSessionId,
    setEngineReady,
    setEngineError,
    startDraft,
    appendDraftText,
    setDraftThinking,
    addDraftTool,
    updateDraftTool,
    finishDraft,
    pushPermissionRequest,
    resolvePermission,
    pushAskRequest,
    resolveAsk,
  } = useKollaborBarStore();

  const { offsetX, offsetY, setOffset, scale, setScale } = useKollaborBarStore();
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors =
    COLOR_SCHEME_GRADIENTS[pillPrefs.colorScheme] || COLOR_SCHEME_GRADIENTS.rainbow;

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef<boolean>(false);
  const pendingToolInstancesRef = useRef<Map<string, string[]>>(new Map());
  const bootRef = useRef<(() => Promise<void>) | null>(null);
  const routerRef = useRef(router);
  const mcpClientRef = useRef<MCPBarClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const [codexAuthPromptOpen, setCodexAuthPromptOpen] = useState(false);
  const [codexAuthChecked, setCodexAuthChecked] = useState(false);
  const [codexAuthDecision, setCodexAuthDecision] = useState<null | "accept" | "decline">(null);
  const [codexToken, setCodexToken] = useState<string | null>(null);
  const [codexTokenLoading, setCodexTokenLoading] = useState(true);
  const CODEX_FALLBACK_MODEL = "gpt-4o";
  // delay reading persisted offset/scale until after mount so SSR output matches first client render
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Keep routerRef current so handleEffect stays stable across navigations
  useEffect(() => { routerRef.current = router; }, [router]);

  // MCP Effect Handling — stable callback (no router in deps, uses ref instead)
  const handleEffect = useCallback(
    (effect: UIEffect) => {
      const { kind, payload } = effect;

      switch (kind) {
        case "navigate": {
          const route = stringPayload(payload, "route");
          if (route) routerRef.current.push(route);
          break;
        }
        case "go_back":
          routerRef.current.back();
          break;
        case "show_toast":
          showToast({
            type: (stringPayload(payload, "level") || "info") as "error" | "success" | "warning" | "info",
            title: stringPayload(payload, "level")?.toUpperCase() || "INFO",
            message: stringPayload(payload, "message") || "",
            duration: numberPayload(payload, "durationMs"),
          });
          break;
        case "show_modal":
          // Fallback: render as a toast + persistent info banner until a
          // proper modal host exists. Keeps the UX flowing instead of
          // silently dropping the effect.
          showToast({
            type: "info",
            title: stringPayload(payload, "title") || "Info",
            message: stringPayload(payload, "body") || "",
            duration: 10000,
          });
          break;
        case "show_drawer":
          showToast({
            type: "info",
            title: stringPayload(payload, "title") || "Info",
            message:
              typeof payload.contents === "string"
                ? payload.contents.slice(0, 200)
                : "",
            duration: 8000,
          });
          break;
        case "focus":
          if (typeof payload.dataMentikoId === "string") {
            const el = document.querySelector(
              `[data-mentiko-id="${CSS.escape(payload.dataMentikoId)}"]`,
            );
            if (el instanceof HTMLElement) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              el.focus?.();
            }
          }
          break;
        case "open_in_new_tab": {
          const url = stringPayload(payload, "url");
          if (url) window.open(url, "_blank");
          break;
        }
        case "select_workspace": {
          const workspaceId = stringPayload(payload, "id");
          if (workspaceId) setWorkspaceId(workspaceId);
          break;
        }
        case "ask_confirm":
        case "ask_input":
        case "ask_choice":
          pushAskRequest({
            toolId: stringPayload(payload, "toolId") || "",
            kind: kind as KollaborAskRequest["kind"],
            prompt:
              stringPayload(payload, "question") ||
              stringPayload(payload, "prompt") ||
              "",
            options: arrayPayload(payload, "options"),
            placeholder: stringPayload(payload, "placeholder"),
          });
          setExpanded(true);
          break;
        case "highlight": {
          // find element by CSS selector or data-mentiko-id
          const sel = String(payload.selector ?? "");
          const dmId = String(payload.dataMentikoId ?? "");
          const msg = String(payload.message ?? "");
          const dur = Number(payload.durationMs ?? 4000);
          const el = dmId
            ? document.querySelector(`[data-mentiko-id="${CSS.escape(dmId)}"]`)
            : sel
            ? document.querySelector(sel)
            : null;
          if (el instanceof HTMLElement) {
            // create overlay ring
            const rect = el.getBoundingClientRect();
            const ring = document.createElement("div");
            ring.id = "mentiko-highlight-ring";
            ring.style.cssText = `
              position: fixed;
              top: ${rect.top - 4}px;
              left: ${rect.left - 4}px;
              width: ${rect.width + 8}px;
              height: ${rect.height + 8}px;
              border: 2px solid #f59e0b;
              border-radius: 8px;
              box-shadow: 0 0 0 4px rgba(245,158,11,0.2);
              pointer-events: none;
              z-index: 9999;
              animation: mentiko-pulse 1.5s ease-in-out infinite;
            `;
            // add keyframe if not exists
            if (!document.getElementById("mentiko-highlight-style")) {
              const style = document.createElement("style");
              style.id = "mentiko-highlight-style";
              style.textContent = `@keyframes mentiko-pulse {
                0%,100% { box-shadow: 0 0 0 4px rgba(245,158,11,0.2); }
                50% { box-shadow: 0 0 0 8px rgba(245,158,11,0.05); }
              }`;
              document.head.appendChild(style);
            }
            if (msg) {
              const label = document.createElement("div");
              label.style.cssText = `
                position: fixed;
                top: ${rect.top - 32}px;
                left: ${rect.left}px;
                background: #f59e0b;
                color: #000;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 600;
                pointer-events: none;
                z-index: 10000;
                white-space: nowrap;
              `;
              label.textContent = msg;
              ring.appendChild(label);
            }
            document.body.appendChild(ring);
            // auto-remove after duration
            const timer = setTimeout(() => ring.remove(), dur);
            // remove on click anywhere
            const clickHandler = () => {
              ring.remove();
              clearTimeout(timer);
            };
            document.addEventListener("click", clickHandler, { once: true });
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          break;
        }
        case "clear_highlight": {
          document.getElementById("mentiko-highlight-ring")?.remove();
          break;
        }
        default:
          // Unhandled effect kinds are most likely ones whose handler calls
          // the web ops routes directly (list/create/etc.) — the MCP server
          // already returned a text result to the engine, no UI effect
          // needed. Log at debug level only.
          break;
      }
    },
    [pushAskRequest, setExpanded, setWorkspaceId],
  );

  const effOffsetX = mounted ? offsetX : 0;
  const effOffsetY = mounted ? offsetY : 0;
  const effScale = mounted ? scale : 1;

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        ox: offsetX,
        oy: offsetY,
      };
      setDragging(true);
    },
    [offsetX, offsetY],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      // y gets inverted: dragging UP (dy negative) should move bar UP (offsetY positive in our anchor)
      setOffset(dragStartRef.current.ox + dx, dragStartRef.current.oy - dy);
    },
    [setOffset],
  );

  const onDragEnd = useCallback(() => {
    dragStartRef.current = null;
    setDragging(false);
  }, []);

  // scroll-wheel anywhere over the pill to resize (hover + scroll = zoom)
  const gripRef = useRef<HTMLButtonElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    // proportional to wheel delta, then rate-limited via rAF so trackpad bursts
    // don't run away. feels like a smooth continuous zoom instead of step-per-tick.
    let pendingDelta = 0;
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (pendingDelta === 0) return;
      const current = useKollaborBarStore.getState().scale;
      const next = Math.min(
        SCALE_MAX,
        Math.max(SCALE_MIN, current - pendingDelta * 0.0015),
      );
      pendingDelta = 0;
      setScale(next);
    };
    const onWheel = (e: WheelEvent) => {
      // only intercept when NOT scrolling inside the textarea
      const target = e.target as Element;
      if (target.tagName === "TEXTAREA") return;
      e.preventDefault();
      pendingDelta += e.deltaY;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };
    pill.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      pill.removeEventListener("wheel", onWheel);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [setScale]);

  const CODEX_TOKEN_PREF_KEY = "mentiko-floater-codex-auth-choice";

  function readCodexChoice(): "accept" | "decline" | null {
    try {
      const value = window.localStorage.getItem(CODEX_TOKEN_PREF_KEY);
      return value === "accept" || value === "decline" ? value : null;
    } catch {
      return null;
    }
  }

  function persistCodexChoice(value: "accept" | "decline") {
    try {
      window.localStorage.setItem(CODEX_TOKEN_PREF_KEY, value);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!SHOULD_OFFER_CODEX_INLINE_AUTH) {
      setCodexToken(null);
      setCodexTokenLoading(false);
      setCodexAuthChecked(true);
      return;
    }

    setCodexAuthDecision(readCodexChoice());

    let cancelled = false;
    setCodexTokenLoading(true);

    void (async () => {
      try {
        const res = await fetch("/api/system/codex-token");
        if (!res.ok) throw new Error(`codex token check failed: ${res.status}`);
        const data = unwrapApiData<{ hasToken?: boolean; token?: string | null }>(
          await res.json(),
        );
        if (cancelled) return;

        if (data.hasToken && data.token) {
          setCodexToken(data.token);
        } else {
          setCodexToken(null);
          if (readCodexChoice() === "accept") {
            try {
              window.localStorage.removeItem(CODEX_TOKEN_PREF_KEY);
            } catch {
              // ignore
            }
            setCodexAuthDecision(null);
          }
        }
      } catch {
        if (!cancelled) setCodexToken(null);
      } finally {
        if (!cancelled) setCodexTokenLoading(false);
        if (!cancelled) setCodexAuthChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCodexAuthDecision = useCallback((decision: "accept" | "decline") => {
    setCodexAuthDecision(decision);
    persistCodexChoice(decision);
    setCodexAuthPromptOpen(false);
    setError(null);
    setEngineError(null);
    if (bootRef.current) void bootRef.current();
  }, [bootRef, setError, setEngineError]);

  // engine session bootstrap + health pings
  useEffect(() => {
    let cancelled = false;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let booting = false;

    function connectMcpClient() {
      // Disconnect any existing client before opening a new one.
      // The async boot() race previously created a second SSE stream that
      // was never cleaned up, leaking connections until Chrome's 6-per-origin
      // cap was hit and all navigation froze.
      if (mcpClientRef.current) {
        mcpClientRef.current.disconnect();
        mcpClientRef.current = null;
      }
      const client = new MCPBarClient(handleEffect);
      mcpClientRef.current = client;
      client.connect();
    }

    async function boot() {
      if (booting) return;
      booting = true;
      bootRef.current = boot;
      setConnecting(true);
      setError(null);
      setEngineError(null);
      try {
        const setup = await ensureMentikoAgentInstalled();
        const reachable = await enginePing();
        if (!codexAuthChecked || codexTokenLoading) {
          setConnecting(false);
          setConnected(false);
          return;
        }

        if (SHOULD_OFFER_CODEX_INLINE_AUTH && codexToken && codexAuthDecision === null) {
          setCodexAuthPromptOpen(true);
          setError("found ~/.codex codex token, choose if this agent should use it");
          setExpanded(true);
          setConnecting(false);
          setConnected(false);
          return;
        }
        if (cancelled) return;
        setEngineReady(reachable);
        if (!reachable) {
          setConnecting(false);
          setConnected(false);
          setError("engine offline — start kollabor-engine");
          setEngineError("engine offline");
          return;
        }
        const sessionRequest: Parameters<typeof getOrCreateSession>[0] = {
          profile: "mentiko",
          agent: "mentiko",
          approval_mode: "auto_approve_edits",
          mcp_servers: ["mentiko"],
          metadata: {
            source: "floating-kollabor-bar",
            mentiko_agent_fingerprint: setup.agentFingerprint ?? null,
          },
        };

        if (SHOULD_OFFER_CODEX_INLINE_AUTH && codexToken && codexAuthDecision === "accept") {
          sessionRequest.credentials = {
            provider: "openai",
            model: CODEX_FALLBACK_MODEL,
            api_key: codexToken,
          };
        }

        const { sessionId: sid, sessionToken } = await getOrCreateSession(sessionRequest);
        if (cancelled) return;
        // Store session token in sessionStorage for session-scoped SSE + ops auth
        if (sessionToken) storeSessionToken(sessionToken);
        setSessionId(sid);
        setConnected(true);
        setConnecting(false);

        // Reconnect with the fresh session-scoped token
        connectMcpClient();
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setConnecting(false);
        setConnected(false);
        setError(`session setup failed: ${msg}`);
        setEngineError(msg);
      } finally {
        booting = false;
      }
    }

    void boot();

    pingTimer = setInterval(async () => {
      try {
        const ok = await enginePing();
        if (cancelled) return;
        setEngineReady(ok);
        if (ok) {
          const state = useKollaborBarStore.getState();
          if (state.error?.startsWith("engine offline")) {
            setError(null);
            setEngineError(null);
          }
          if (!state.connected && !state.connecting) void boot();
        } else if (!useKollaborBarStore.getState().error) {
          setError("engine offline");
        }
      } catch {
        if (!cancelled) setEngineReady(false);
      }
    }, 30000);

    return () => {
      cancelled = true;
      if (pingTimer) clearInterval(pingTimer);
      if (mcpClientRef.current) {
        mcpClientRef.current.disconnect();
        mcpClientRef.current = null;
      }
    };
  }, [
    codexAuthChecked,
    codexAuthDecision,
    codexAuthPromptOpen,
    codexToken,
    codexTokenLoading,
    handleEffect,
    setConnected,
    setConnecting,
    setEngineError,
    setEngineReady,
    setError,
    setExpanded,
    setSessionId,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && expanded) {
        setExpanded(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, setExpanded]);

  // Report the current URL to the MCP backend whenever it changes. Lets
  // koordinator call `get_current_page` and know where granny is looking
  // without reading the DOM.
  useEffect(() => {
    const search = searchParams?.toString() || "";
    const title = typeof document !== "undefined" ? document.title : "";
    const token = getStoredSessionToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch("/api/mentiko-mcp/current-page", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ pathname, search, label: title, sessionId }),
    }).catch(() => {});
  }, [pathname, searchParams, sessionId]);

  useEffect(() => {
    if (!expanded) return;
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, expanded]);

  const hasSetupLink =
    !connected &&
    !connecting &&
    !codexAuthPromptOpen &&
    !!error;

  const activeAskMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.ask && message.ask.result === undefined) return message;
    }
    return null;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const state = useKollaborBarStore.getState();
    const content = state.inputValue.trim();
    const sid = state.sessionId;
    if (content.length === 0 || sendingRef.current || !state.connected || !sid) return;
    const uid = randomId();
    pendingToolInstancesRef.current.clear();
    pushMessage({ id: uid, role: "user", content, timestamp: Date.now() });
    setInputValue("");
    sendingRef.current = true;
    startDraft();
    try {
      for await (const ev of engineSendMessage(sid, content)) {
        switch (ev.type) {
          case "token":
            if (ev.text) appendDraftText(ev.text);
            break;
          case "thinking":
            setDraftThinking(true);
            break;
          case "tool_start": {
            const engineToolId = String(ev.tool_id ?? ev.tool_name ?? "tool");
            const toolInstanceId = `${engineToolId}-${randomId()}`;
            const pendingInstances =
              pendingToolInstancesRef.current.get(engineToolId) ?? [];
            pendingInstances.push(toolInstanceId);
            pendingToolInstancesRef.current.set(engineToolId, pendingInstances);
            addDraftTool({
              callId: toolInstanceId,
              name: ev.tool_name,
              args: ev.input,
              status: "running",
              riskLevel: ev.risk_level,
            });
            break;
          }
          case "tool_result": {
            const resultToolId = String(ev.tool_id ?? ev.tool_name ?? "tool");
            const resultPendingInstances =
              pendingToolInstancesRef.current.get(resultToolId);
            const resultInstanceId = resultPendingInstances?.shift() ?? resultToolId;
            if (resultPendingInstances && resultPendingInstances.length === 0) {
              pendingToolInstancesRef.current.delete(resultToolId);
            }
            updateDraftTool(resultInstanceId, {
              status: ev.success ? "done" : "error",
              output: ev.output,
              error: ev.error || undefined,
            });
            break;
          }
          case "permission_request":
            // commit any current draft so far, then push the permission message
            finishDraft();
            pushPermissionRequest({
              toolId: ev.tool_id,
              toolName: ev.tool_name,
              input: ev.input,
              riskLevel: ev.risk_level,
              riskReason: ev.risk_reason,
            });
            // start a fresh draft so subsequent tokens (after approval) keep streaming
            startDraft();
            break;
          case "permission_granted":
          case "permission_denied":
            // decision already rendered via resolvePermission on click.
            break;
          case "turn_complete":
            finishDraft();
            pendingToolInstancesRef.current.clear();
            break;
          case "error": {
            const msg = "message" in ev ? ev.message : "engine error";
            // Session expired (engine restarted) — clear stale ID and reconnect immediately
            if (String(msg).includes("Session not found") || String(msg).includes("404")) {
              if (typeof window !== "undefined") {
                try {
                  window.localStorage.removeItem("mentiko-kollabor-session-id");
                  window.localStorage.removeItem("mentiko-kollabor-session-requirements");
                  window.localStorage.removeItem("mentiko-kollabor-session-id-v2");
                  window.localStorage.removeItem("mentiko-kollabor-session-requirements-v2");
                } catch {}
              }
              setSessionId(null);
              setConnected(false);
              setConnecting(false);
              finishDraft();
              setTimeout(() => {
                const state = useKollaborBarStore.getState();
                if (!state.connected && !state.connecting && bootRef.current) void bootRef.current();
              }, 1000);
            } else {
              setError(String(msg));
              finishDraft();
            }
            break;
          }
          default:
            break;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`send failed: ${msg}`);
      finishDraft();
      pendingToolInstancesRef.current.clear();
    } finally {
      sendingRef.current = false;
      pendingToolInstancesRef.current.clear();
    }
  }, [
    pushMessage,
    setInputValue,
    setError,
    setSessionId,
    setConnected,
    setConnecting,
    startDraft,
    appendDraftText,
    setDraftThinking,
    addDraftTool,
    updateDraftTool,
    finishDraft,
    pushPermissionRequest,
  ]);

  const handlePermissionRespond = useCallback(
    async (
      messageId: string,
      toolId: string,
      decision: "approve" | "approve_always" | "deny",
    ) => {
      const sid = useKollaborBarStore.getState().sessionId;
      if (!sid) return;
      // optimistic local update
      resolvePermission(messageId, decision);
      try {
        await engineRespondToPermission(sid, toolId, decision);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`permission failed: ${msg}`);
      }
    },
    [resolvePermission, setError],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const statusText = useMemo(() => {
    if (error) return error;
    if (connecting) return "connecting…";
    if (connected) return agent;
    return "disconnected";
  }, [error, connecting, connected, agent]);

  const statusColor = error
    ? "text-red-400"
    : connected
      ? "text-green-400"
      : "text-muted-foreground";

  const barBottom = Math.max(16, 16 + effOffsetY);
  const barLeftPct = 50; // center + offset handled via transform
  return (
    <>
      {/* full-viewport backdrop, centered radial mask at the bar position */}
      {codexAuthPromptOpen && (
        <motion.div
          key="codex-auth-prompt"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="fixed left-1/2 z-50 flex justify-between gap-2 rounded-2xl border border-border/70 bg-background/95 px-3 py-2 text-xs pointer-events-auto"
          style={{
            bottom: `${barBottom + 64}px`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-foreground/80">found codex token in ~/.codex. use it for mentiko?</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleCodexAuthDecision("accept")}
              className="rounded-lg bg-foreground text-background px-2.5 py-1 font-medium"
            >
              use it
            </button>
            <button
              type="button"
              onClick={() => handleCodexAuthDecision("decline")}
              className="rounded-lg bg-muted text-foreground px-2.5 py-1"
            >
              skip
            </button>
          </div>
        </motion.div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="kollabor-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden="true"
            className="fixed inset-0 z-30 pointer-events-none"
            style={{
              backdropFilter: "blur(20px) saturate(115%) brightness(0.75)",
              WebkitBackdropFilter: "blur(20px) saturate(115%) brightness(0.75)",
              backgroundColor: "rgba(0,0,0,0.22)",
              maskImage: `radial-gradient(ellipse 540px 900px at calc(${barLeftPct}% + ${effOffsetX}px) calc(100% - ${barBottom + 40}px), rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 40%, rgba(0,0,0,0.6) 65%, transparent 90%)`,
              WebkitMaskImage: `radial-gradient(ellipse 540px 900px at calc(${barLeftPct}% + ${effOffsetX}px) calc(100% - ${barBottom + 40}px), rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 40%, rgba(0,0,0,0.6) 65%, transparent 90%)`,
            }}
          />
        )}
      </AnimatePresence>
    <div
      className="fixed z-40 w-[min(373px,calc(100vw-2rem))] pointer-events-none flex flex-col items-stretch gap-2"
      style={{
        left: "50%",
        bottom: `${barBottom}px`,
        transform: `translateX(calc(-50% + ${effOffsetX}px)) scale(${effScale.toFixed(3)})`,
        transformOrigin: "bottom center",
        transition: dragging ? "none" : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "transform",
      }}
    >
      {/* floating bubbles — no card, no background, just stacked */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="transcript"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="no-scrollbar pointer-events-auto flex flex-col-reverse gap-2 max-h-[55vh] overflow-y-auto overflow-x-hidden"
            ref={transcriptRef}
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 6%, rgba(0,0,0,0.7) 14%, #000 24%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 6%, rgba(0,0,0,0.7) 14%, #000 24%)",
            }}
          >
            {/* header row lives ABOVE the bubbles. controls fade in on hover. */}
            <div className="group/header sticky bottom-0 flex items-center justify-between text-[11px] pt-1">
              <div
                className={cn(
                  "flex items-center gap-1.5 transition-opacity duration-200",
                  connected && !error
                    ? "opacity-0 group-hover/header:opacity-60"
                    : "opacity-70",
                )}
              >
                <span
                  className={cn(
                    "inline-block w-1.5 h-1.5 rounded-full",
                    connected
                      ? "bg-green-400"
                      : connecting
                        ? "bg-amber-400"
                        : "bg-red-400",
                  )}
                />
                <span className={statusColor}>{statusText}</span>
              </div>
              <div className="flex items-center gap-3 transition-opacity duration-200">
                <button
                  type="button"
                  onClick={() => clearMessages()}
                  className="text-muted-foreground/40 hover:text-foreground"
                >
                  clear
                </button>
              </div>
            </div>

            {/* render bubbles newest-at-bottom; flex-col-reverse inverts while keeping natural scroll */}
            <div className="flex flex-col gap-2">
              {messages.length === 0 ? (
                <div className="text-xs text-muted-foreground/60 text-center py-4">
                  nothing yet
                </div>
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      trayAskMessageId={activeAskMessage?.id ?? null}
                      onPermissionRespond={handlePermissionRespond}
                      onAskRespond={resolveAsk}
                    />
                  ))}
                  {drafting && (
                    <DraftBubble draft={drafting} />
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {expanded && activeAskMessage?.ask && (
        <motion.div
          key={`ask-tray-${activeAskMessage.id}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto w-full"
        >
          <KollaborAskPrompt
            toolId={activeAskMessage.ask.toolId}
            kind={activeAskMessage.ask.kind}
            prompt={activeAskMessage.ask.prompt}
            options={activeAskMessage.ask.options}
            placeholder={activeAskMessage.ask.placeholder}
            result={activeAskMessage.ask.result}
            onRespond={(r) => resolveAsk(activeAskMessage.id, r)}
          />
        </motion.div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.button
            key="close-above"
            type="button"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            onClick={() => setExpanded(false)}
            aria-label="close"
            title="close (esc)"
            className="pointer-events-auto self-end flex items-center justify-center w-6 h-6 rounded-full border border-border/60 bg-background/80 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm"
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* floating input pill — independent from bubbles */}
      <motion.div
        ref={pillRef}
        layout={!dragging}
        transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.9 }}
        className={cn(
          "group/pill pointer-events-auto relative flex items-center gap-1 rounded-2xl border border-border/80 bg-background/95 backdrop-blur px-3 py-2 shadow-lg",
          dragging && "select-none",
        )}
      >
        {/* shine border — matches pill-nav color scheme */}
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-[inherit] pointer-events-none z-[1]"
          style={{
            padding: "1px",
            backgroundImage: `radial-gradient(transparent, transparent, ${shineColors}, transparent, transparent)`,
            backgroundSize: "300% 300%",
            animation: "sb-shine-pulse 14s linear infinite",
            WebkitMask:
              "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            WebkitMaskComposite: "xor" as React.CSSProperties["WebkitMaskComposite"],
            mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
            maskComposite: "exclude" as unknown as string,
          }}
        />
        {/* invisible drag/zoom hit area — subtle dot only on hover */}
        <button
          ref={gripRef}
          type="button"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="relative z-[2] shrink-0 h-8 w-3 flex items-center justify-center cursor-grab active:cursor-grabbing"
          aria-label="drag to move"
          title={`drag to move · scroll over bar to resize (${Math.round(effScale * 100)}%)`}
        >
          <span
            className="inline-block w-1 h-1 rounded-full bg-muted-foreground/30 group-hover/pill:bg-muted-foreground/70 transition-colors"
            aria-hidden="true"
          />
        </button>
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setExpanded(true)}
          onKeyDown={handleKeyDown}
          placeholder={
            connected ? "message" : connecting ? "connecting…" : "offline"
          }
          rows={1}
          className="relative z-[2] flex-1 min-w-0 resize-none bg-transparent outline-none text-sm leading-5 placeholder:text-muted-foreground/60 py-1.5 pr-2 max-h-32 overflow-y-auto"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        {hasSetupLink && (
          <button
            type="button"
            onClick={() => router.push("/settings/agent-configs")}
            className="shrink-0 rounded-md border border-border/60 bg-background/60 px-2.5 py-1 text-[11px] leading-none hover:bg-background/85"
            title="setup kollab cli and provider profiles"
          >
            setup kollab cli
          </button>
        )}
      </motion.div>
    </div>
    </>
  );
}

function MessageBubble({
  message,
  trayAskMessageId,
  onPermissionRespond,
  onAskRespond,
}: {
  message: KollaborMessage;
  trayAskMessageId?: string | null;
  onPermissionRespond: (
    messageId: string,
    toolId: string,
    decision: "approve" | "approve_always" | "deny",
  ) => void;
  onAskRespond: (messageId: string, result: unknown) => void;
}) {
  // permission prompt bubble — rendered inline in transcript
  if (message.role === "permission" && message.permission) {
    const p = message.permission;
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-start"
      >
        <KollaborPermissionPrompt
          toolId={p.toolId}
          toolName={p.toolName}
          input={p.input}
          riskLevel={p.riskLevel}
          riskReason={p.riskReason}
          decision={p.decision}
          hideApproveAlways={p.riskLevel === "high"}
          onRespond={(d) => onPermissionRespond(message.id, p.toolId, d)}
        />
      </motion.div>
    );
  }

  // ask prompt bubble
  if (message.ask) {
    if (message.id === trayAskMessageId && message.ask.result === undefined) {
      return null;
    }
    const a = message.ask;
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-start w-full"
      >
        <KollaborAskPrompt
          toolId={a.toolId}
          kind={a.kind}
          prompt={a.prompt}
          options={a.options}
          placeholder={a.placeholder}
          result={a.result}
          onRespond={(r) => onAskRespond(message.id, r)}
        />
      </motion.div>
    );
  }

  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
    >
      {/* render committed tool chips first (if any) */}
      {visibleToolChips(message.tools).map((tool, index) => (
        <CommittedToolChip key={toolChipKey(tool, index)} tool={tool} />
      ))}
      {/* then the text bubble (skip if no text, e.g. tool-only turns) */}
      {message.content && (
        <div
          className={cn(
            "max-w-[85%] text-sm leading-relaxed break-words",
            isUser
              ? "rounded-2xl px-3.5 py-2 bg-muted/70 text-foreground whitespace-pre-wrap"
              : "px-1 text-foreground/90 prose prose-sm prose-invert max-w-none",
          )}
        >
          {isUser ? message.content : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      )}
    </motion.div>
  );
}

function DraftBubble({
  draft,
}: {
  draft: { text: string; tools: DraftTool[]; thinking: boolean };
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-1 items-start"
    >
      {!draft.text && draft.tools.length === 0 && (
        <div className="px-2 py-1 text-xs text-muted-foreground flex items-center gap-1.5">
          <span className="inline-flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: "300ms" }} />
          </span>
        </div>
      )}
      {visibleToolChips(draft.tools).map((tool, index) => (
        <CommittedToolChip key={toolChipKey(tool, index)} tool={tool} />
      ))}
      {draft.text && (
        <div className="max-w-[85%] text-sm leading-relaxed break-words px-1 text-foreground/90 prose prose-sm prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {draft.text}
          </ReactMarkdown>
          <span className="inline-block w-[1ch] animate-pulse">▍</span>
        </div>
      )}
    </motion.div>
  );
}

function toolChipKey(tool: DraftTool, index: number): string {
  return `${tool.callId || tool.name || "tool"}-${index}`;
}

function visibleToolChips(tools?: DraftTool[]): DraftTool[] {
  return (tools ?? []).filter((tool) => !HIDDEN_TOOL_CHIP_NAMES.has(tool.name));
}

function CommittedToolChip({ tool }: { tool: DraftTool }) {
  const label =
    tool.status === "running"
      ? "running"
      : tool.status === "done"
        ? "ran"
        : "failed";
  const argsStr =
    typeof tool.args === "string"
      ? tool.args
      : JSON.stringify(tool.args ?? "").slice(0, 80);
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 backdrop-blur px-2.5 py-1 text-[11px] leading-none text-muted-foreground max-w-[85%]",
      )}
      title={argsStr}
    >
      <span
        className={cn(
          "inline-block w-1.5 h-1.5 rounded-full",
          tool.status === "running"
            ? "bg-amber-400 animate-pulse"
            : tool.status === "done"
              ? "bg-green-400"
              : "bg-red-400",
        )}
      />
      <span className="text-foreground/80 font-medium">{label}</span>
      <span className="opacity-40">·</span>
      <span className="font-mono truncate">
        {tool.name}
        {argsStr && `: ${argsStr.slice(0, 40)}`}
      </span>
    </div>
  );
}
