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
  KOLLABOR_BAR_DEFAULT_DOCK,
  getKollaborBarDockForPoint,
  type KollaborBarDock,
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
import { WaveSpinner } from "@/components/ui/wave-spinner";
import {
  MCPBarClient,
  getStoredSessionToken,
  syncSessionToken,
} from "@/lib/mentiko-mcp-bar-client";
import type { UIEffect } from "@/lib/mentiko-mcp-inbox";
import { showToast } from "@/components/notifications-panel";
import { FLOATING_SURFACE_Z } from "@/lib/floating-surface-z";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { unwrapApiData } from "@/lib/api-client";
import { isRecoverableKollaborSessionError } from "@/lib/kollabor-session-errors";
import { normalizeTaskNavigationRoute } from "@/lib/task-routes";
import { repairAgentTextSpacing } from "@/lib/agent-message-text";
import {
  OPEN_FLOATING_APP_PANEL_EVENT,
  getFloatingPanelRouteTitle,
  isFloatingPanelRoute,
} from "@/lib/floating-app-panel-routing";

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const SHOULD_OFFER_CODEX_INLINE_AUTH = false;
const HIDDEN_TOOL_CHIP_NAMES = new Set(["ask_confirm", "ask_input", "ask_choice"]);
const TASK_DIGEST_ID_RE = /\b(?:EPIC|TASK|CHOR)-\d{3}\b/g;

type TaskDigestKind = "EPIC" | "TASK" | "CHOR";
type TaskDigestStatus = "open" | "blocked" | "done" | "stopped";
type TaskDigestItem = {
  id: string;
  kind: TaskDigestKind;
  title: string;
  priority?: string;
  status: TaskDigestStatus;
};
type TaskDigestGroup = {
  epic: TaskDigestItem;
  items: TaskDigestItem[];
};
type TaskDigest = {
  intro: string;
  groups: TaskDigestGroup[];
  looseItems: TaskDigestItem[];
};

function px(value: number): string {
  return `${Number(value.toFixed(2))}px`;
}

function agentFontVars(scale: number): React.CSSProperties {
  return {
    "--mentiko-agent-message-font-size": px(14 * scale),
    "--mentiko-agent-message-line-height": px(22 * scale),
    "--mentiko-agent-input-font-size": px(14 * scale),
    "--mentiko-agent-input-line-height": px(20 * scale),
    "--mentiko-agent-chip-font-size": px(11 * scale),
    "--mentiko-agent-chip-line-height": px(14 * scale),
  } as React.CSSProperties;
}

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

const FREE_BAR_VIEWPORT_MARGIN = 16;
const FREE_BAR_MIN_CENTER_Y = 44;

function isSideDock(
  dock: KollaborBarDock,
): dock is KollaborBarDock & { edge: "left" | "right" } {
  return dock.edge === "left" || dock.edge === "right";
}

function clampFreeBarCenter(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  barWidth: number,
  pillHeight: number,
): { x: number; y: number } {
  const halfWidth = barWidth / 2;
  const halfPillHeight = pillHeight / 2;
  return {
    x: Math.min(
      viewportWidth - FREE_BAR_VIEWPORT_MARGIN - halfWidth,
      Math.max(FREE_BAR_VIEWPORT_MARGIN + halfWidth, x),
    ),
    y: Math.min(
      viewportHeight - FREE_BAR_VIEWPORT_MARGIN - halfPillHeight,
      Math.max(FREE_BAR_MIN_CENTER_Y, y),
    ),
  };
}

function clampFreeBarOffsetX(offsetX: number, scale: number): number {
  if (typeof window === "undefined") return offsetX;
  const barWidth = Math.min(373, window.innerWidth - 32) * scale;
  const maxOffset = Math.max(
    0,
    window.innerWidth / 2 - FREE_BAR_VIEWPORT_MARGIN - barWidth / 2,
  );
  return Math.min(maxOffset, Math.max(-maxOffset, offsetX));
}

function clampFreeBarBottom(bottom: number): number {
  if (typeof window === "undefined") return bottom;
  const maxBottom = Math.max(
    FREE_BAR_VIEWPORT_MARGIN,
    window.innerHeight - FREE_BAR_MIN_CENTER_Y,
  );
  return Math.min(maxBottom, Math.max(FREE_BAR_VIEWPORT_MARGIN, bottom));
}

function sideDockRailStyle(edge: "left" | "right", y: number): React.CSSProperties {
  const height = 132;
  const top = Math.min(
    window.innerHeight - height - 12,
    Math.max(12, y - height / 2),
  );
  return {
    position: "fixed",
    pointerEvents: "none",
    zIndex: FLOATING_SURFACE_Z.kollaborBar - 1,
    top,
    [edge]: 0,
    width: 3,
    height,
    borderRadius: edge === "left" ? "0 999px 999px 0" : "999px 0 0 999px",
    background: "rgba(245, 158, 11, 0.55)",
    opacity: 0.85,
  } as React.CSSProperties;
}

function sideDockBottomCss(offset: number, scale: number): string {
  return `max(${FREE_BAR_VIEWPORT_MARGIN}px, calc(${100 - offset}vh - ${px(24 * scale)}))`;
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

  const { offsetX, offsetY, dock, setOffset, setDock, scale, setScale, fontScale } =
    useKollaborBarStore();
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors =
    COLOR_SCHEME_GRADIENTS[pillPrefs.colorScheme] || COLOR_SCHEME_GRADIENTS.rainbow;
  const fontVars = useMemo(() => agentFontVars(fontScale), [fontScale]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef<boolean>(false);
  const pendingToolInstancesRef = useRef<Map<string, string[]>>(new Map());
  const bootRef = useRef<(() => Promise<void>) | null>(null);
  const routerRef = useRef(router);
  const mcpClientRef = useRef<MCPBarClient | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
    pillHeight: number;
  } | null>(null);
  const dragPositionRef = useRef<{
    left: number;
    top: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState<{
    left: number;
    top: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
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
          if (route) {
            const normalizedRoute = normalizeTaskNavigationRoute(route);
            if (
              pillPrefs.navigationMode === "floating-nav-panels" &&
              isFloatingPanelRoute(normalizedRoute)
            ) {
              window.dispatchEvent(new CustomEvent(OPEN_FLOATING_APP_PANEL_EVENT, {
                detail: {
                  href: normalizedRoute,
                  title: getFloatingPanelRouteTitle(normalizedRoute),
                },
              }));
            } else {
              routerRef.current.push(normalizedRoute);
            }
          }
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
              z-index: ${FLOATING_SURFACE_Z.kollaborBackdrop};
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
                z-index: ${FLOATING_SURFACE_Z.kollaborPrompt};
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
    [pillPrefs.navigationMode, pushAskRequest, setExpanded, setWorkspaceId],
  );

  const effScale = mounted ? scale : 1;
  const effOffsetX = mounted ? clampFreeBarOffsetX(offsetX, effScale) : 0;
  const effOffsetY = mounted ? offsetY : 0;
  const effDock = mounted ? dock : KOLLABOR_BAR_DEFAULT_DOCK;
  const gripRef = useRef<HTMLButtonElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Window-level pointer listeners below keep drag working if capture
        // is unavailable or the pointer leaves the small grip target.
      }
      const barRect = barRef.current?.getBoundingClientRect();
      const pillRect = pillRef.current?.getBoundingClientRect();
      const left = barRect?.left ?? e.clientX;
      const top = barRect?.top ?? e.clientY;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        left,
        top,
        width: barRect?.width ?? 373,
        height: barRect?.height ?? 48,
        pillHeight: pillRect?.height ?? 48,
      };
      dragPositionRef.current = {
        left,
        top,
        pointerX: e.clientX,
        pointerY: e.clientY,
      };
      setDragPosition(dragPositionRef.current);
      setDragging(true);
    },
    [],
  );

  const updateDragPosition = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragStartRef.current) return;
      const dx = clientX - dragStartRef.current.x;
      const dy = clientY - dragStartRef.current.y;
      const next = {
        left: dragStartRef.current.left + dx,
        top: dragStartRef.current.top + dy,
        pointerX: clientX,
        pointerY: clientY,
      };
      dragPositionRef.current = next;
      setDragPosition(next);
    },
    [],
  );

  const onDragEnd = useCallback(() => {
    const endPosition = dragPositionRef.current;
    const start = dragStartRef.current;
    if (endPosition && start) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const nextDock = getKollaborBarDockForPoint(
        endPosition.pointerX,
        endPosition.pointerY,
        viewportWidth,
        viewportHeight,
      );
      setDock(nextDock);
      if (nextDock.edge === "bottom") {
        const centerX = endPosition.left + start.width / 2;
        const centerY = endPosition.top + start.height - start.pillHeight / 2;
        const clamped = clampFreeBarCenter(
          centerX,
          centerY,
          viewportWidth,
          viewportHeight,
          start.width,
          start.pillHeight,
        );
        const bottom = Math.max(
          FREE_BAR_VIEWPORT_MARGIN,
          viewportHeight - (clamped.y + start.pillHeight / 2),
        );
        setOffset(clamped.x - viewportWidth / 2, bottom - FREE_BAR_VIEWPORT_MARGIN);
      }
    }
    dragStartRef.current = null;
    dragPositionRef.current = null;
    setDragPosition(null);
    setDragging(false);
  }, [setDock, setOffset]);

  useEffect(() => {
    if (!dragging) return;
    const handlePointerMove = (e: PointerEvent) => {
      updateDragPosition(e.clientX, e.clientY);
    };
    const handlePointerEnd = () => {
      onDragEnd();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [dragging, onDragEnd, updateDragPosition]);

  // scroll-wheel anywhere over the pill to resize (hover + scroll = zoom)
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
        const activeProfile = await fetch("/api/kollabor/profiles/active", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (typeof j?.active === "string" && j.active ? j.active : "mentiko"))
          .catch(() => "mentiko");

        const sessionRequest: Parameters<typeof getOrCreateSession>[0] = {
          profile: activeProfile,
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
        // Keep SSE auth aligned with this engine session. If no fresh token
        // comes back, clear stale JWTs so the client uses this session id.
        syncSessionToken(sessionToken);
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
            // Session expired or engine restarted: clear stale IDs and reconnect.
            if (isRecoverableKollaborSessionError(msg)) {
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

  const barBottom = mounted
    ? clampFreeBarBottom(FREE_BAR_VIEWPORT_MARGIN + effOffsetY)
    : FREE_BAR_VIEWPORT_MARGIN;
  const dragDock = dragPosition
    ? getKollaborBarDockForPoint(
        dragPosition.pointerX,
        dragPosition.pointerY,
        window.innerWidth,
        window.innerHeight,
      )
    : null;
  const activeDockEdge = dragPosition
    ? dragDock && isSideDock(dragDock) ? dragDock.edge : "bottom"
    : effDock.edge;
  const maskAnchor = dragPosition
    ? { x: `${dragPosition.pointerX}px`, y: `${dragPosition.pointerY}px` }
    : effDock.edge === "left"
      ? { x: "0px", y: `${effDock.offset}%` }
      : effDock.edge === "right"
        ? { x: "100%", y: `${effDock.offset}%` }
        : {
            x: `calc(50% + ${effOffsetX}px)`,
            y: `calc(100% - ${barBottom + 40}px)`,
          };
  const containerPositionStyle: React.CSSProperties = dragPosition
    ? {
        left: dragPosition.left,
        top: dragPosition.top,
        transform: `scale(${effScale.toFixed(3)})`,
        transformOrigin: "top left",
      }
    : effDock.edge === "left"
      ? {
          left: 0,
          bottom: sideDockBottomCss(effDock.offset, effScale),
          transform: `scale(${effScale.toFixed(3)})`,
          transformOrigin: "bottom left",
        }
      : effDock.edge === "right"
        ? {
            right: 0,
            bottom: sideDockBottomCss(effDock.offset, effScale),
            transform: `scale(${effScale.toFixed(3)})`,
            transformOrigin: "bottom right",
          }
        : {
            left: "50%",
            bottom: `${barBottom}px`,
            transform: `translateX(calc(-50% + ${effOffsetX}px)) scale(${effScale.toFixed(3)})`,
            transformOrigin: "bottom center",
          };
  const codexPromptStyle: React.CSSProperties = isSideDock(effDock)
    ? {
        zIndex: FLOATING_SURFACE_Z.kollaborPrompt,
        top: `${effDock.offset}%`,
        [effDock.edge]: "16px",
        transform: "translateY(calc(-50% - 56px))",
      } as React.CSSProperties
    : {
        zIndex: FLOATING_SURFACE_Z.kollaborPrompt,
        bottom: `${barBottom + 64}px`,
        left: "50%",
        transform: "translateX(-50%)",
      };
  return (
    <>
      {dragging && dragPosition && dragDock && isSideDock(dragDock) && (
        <div
          aria-hidden="true"
          style={sideDockRailStyle(dragDock.edge, dragPosition.pointerY)}
        />
      )}
      {/* full-viewport backdrop, centered radial mask at the bar position */}
      {codexAuthPromptOpen && (
        <motion.div
          key="codex-auth-prompt"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="fixed flex max-w-[calc(100vw-2rem)] justify-between gap-2 rounded-2xl border border-border/70 bg-background/95 px-3 py-2 text-xs pointer-events-auto"
          style={codexPromptStyle}
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
            className="fixed inset-0 pointer-events-none"
            style={{
              zIndex: FLOATING_SURFACE_Z.kollaborBackdrop,
              backdropFilter: "blur(20px) saturate(115%) brightness(0.75)",
              WebkitBackdropFilter: "blur(20px) saturate(115%) brightness(0.75)",
              backgroundColor: "rgba(0,0,0,0.22)",
              maskImage: `radial-gradient(ellipse 540px 900px at ${maskAnchor.x} ${maskAnchor.y}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 40%, rgba(0,0,0,0.6) 65%, transparent 90%)`,
              WebkitMaskImage: `radial-gradient(ellipse 540px 900px at ${maskAnchor.x} ${maskAnchor.y}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 40%, rgba(0,0,0,0.6) 65%, transparent 90%)`,
            }}
          />
        )}
      </AnimatePresence>
      <div
        ref={barRef}
        data-floating-kollabor-bar=""
        className="fixed w-[min(373px,calc(100vw-2rem))] pointer-events-none flex flex-col items-stretch gap-2"
        style={{
          ...fontVars,
          zIndex: FLOATING_SURFACE_Z.kollaborBar,
          ...containerPositionStyle,
          transition: dragging
            ? "none"
            : "left 220ms cubic-bezier(0.22, 1, 0.36, 1), right 220ms cubic-bezier(0.22, 1, 0.36, 1), top 220ms cubic-bezier(0.22, 1, 0.36, 1), bottom 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
        }}
      >
        <style>{`
          .mentiko-agent-markdown,
          .mentiko-agent-markdown p,
          .mentiko-agent-markdown li,
          .mentiko-agent-markdown blockquote {
            font-size: var(--mentiko-agent-message-font-size);
            line-height: var(--mentiko-agent-message-line-height);
            letter-spacing: 0;
          }
          .mentiko-agent-markdown p {
            margin: 0 0 0.45em;
          }
          .mentiko-agent-markdown p:last-child,
          .mentiko-agent-markdown li:last-child {
            margin-bottom: 0;
          }
          .mentiko-agent-markdown ul,
          .mentiko-agent-markdown ol {
            margin: 0.35em 0 0.55em;
            padding-left: 1.15em;
          }
          .mentiko-agent-markdown li {
            margin: 0.12em 0;
          }
          .mentiko-agent-markdown blockquote {
            margin: 0.45em 0;
            border-left: 1px solid rgba(255,255,255,0.16);
            padding-left: 0.75em;
            color: rgba(255,255,255,0.74);
          }
          .mentiko-agent-markdown code,
          .mentiko-agent-markdown pre {
            font-size: calc(var(--mentiko-agent-message-font-size) * 0.92);
          }
        `}</style>
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
          activeDockEdge === "left" && "rounded-l-none rounded-r-2xl",
          activeDockEdge === "right" && "rounded-r-none rounded-l-2xl",
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
          onPointerMove={(e) => updateDragPosition(e.clientX, e.clientY)}
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
          style={{
            fieldSizing: "content",
            fontSize: "var(--mentiko-agent-input-font-size)",
            lineHeight: "var(--mentiko-agent-input-line-height)",
          } as React.CSSProperties}
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
  const tools = visibleToolChips(message.tools);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
    >
      {/* render committed tool chips first (if any) */}
      <ToolChipCluster tools={tools} />
      {/* then the text bubble (skip if no text, e.g. tool-only turns) */}
      {message.content && (
        <div
          className={cn(
            "text-sm leading-relaxed break-words",
            isUser
              ? "max-w-[78%] rounded-[1.25rem] px-3 py-1.5 bg-muted/70 text-foreground whitespace-pre-wrap"
              : "mentiko-agent-markdown max-w-[92%] px-0.5 text-foreground/90",
          )}
          style={{
            fontSize: "var(--mentiko-agent-message-font-size)",
            lineHeight: "var(--mentiko-agent-message-line-height)",
          }}
        >
          {isUser ? message.content : (
            <AgentMessageContent content={message.content} />
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
        <div className="px-1 py-1.5">
          <AgentWaitSpinner />
        </div>
      )}
      <ToolChipCluster tools={visibleToolChips(draft.tools)} />
      {draft.text && (
        <div
          className="mentiko-agent-markdown max-w-[92%] text-sm leading-relaxed break-words px-0.5 text-foreground/90"
          style={{
            fontSize: "var(--mentiko-agent-message-font-size)",
            lineHeight: "var(--mentiko-agent-message-line-height)",
          }}
        >
          <AgentMessageContent content={draft.text} />
          <div className="mt-1.5 flex items-center pl-0.5">
            <AgentWaitSpinner />
          </div>
        </div>
      )}
    </motion.div>
  );
}

function AgentMessageContent({ content }: { content: string }) {
  const displayContent = repairAgentTextSpacing(content);
  const taskDigest = parseTaskDigest(displayContent);

  if (taskDigest) {
    return <TaskDigestView digest={taskDigest} />;
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {displayContent}
    </ReactMarkdown>
  );
}

function AgentWaitSpinner() {
  return (
    <WaveSpinner
      size="xs"
      color="#b07ee8"
      animation="ripple"
      dotShape="circle"
      aria-label="Mentiko is thinking"
      className="opacity-85"
    />
  );
}

function parseTaskDigest(content: string): TaskDigest | null {
  const matches = Array.from(content.matchAll(TASK_DIGEST_ID_RE));
  if (matches.length < 2) return null;

  const firstIndex = matches[0]?.index ?? 0;
  const intro = normalizeDigestText(content.slice(0, firstIndex)).replace(/:$/, "");
  const groups: TaskDigestGroup[] = [];
  const groupsByEpicId = new Map<string, TaskDigestGroup>();
  const looseItems: TaskDigestItem[] = [];
  const looseItemIds = new Set<string>();
  let currentGroup: TaskDigestGroup | null = null;

  matches.forEach((match, index) => {
    const id = match[0];
    const start = (match.index ?? 0) + id.length;
    const end = matches[index + 1]?.index ?? content.length;
    const item = createTaskDigestItem(id, content.slice(start, end));

    if (item.kind === "EPIC") {
      currentGroup = groupsByEpicId.get(item.id) ?? null;
      if (!currentGroup) {
        currentGroup = { epic: item, items: [] };
        groupsByEpicId.set(item.id, currentGroup);
        groups.push(currentGroup);
      }
      return;
    }

    if (currentGroup) {
      if (!currentGroup.items.some((existing) => existing.id === item.id)) {
        currentGroup.items.push(item);
      }
    } else if (!looseItemIds.has(item.id)) {
      looseItemIds.add(item.id);
      looseItems.push(item);
    }
  });

  if (groups.length === 0 && looseItems.length < 2) return null;
  return { intro, groups, looseItems };
}

function createTaskDigestItem(id: string, rawTitle: string): TaskDigestItem {
  const kind = id.slice(0, id.indexOf("-")) as TaskDigestKind;
  const titleWithMeta = cleanDigestTitle(rawTitle);
  const priority = titleWithMeta.match(/\bP[0-4]\b/i)?.[0].toUpperCase();
  const title = titleWithMeta
    .replace(/\(\s*P[0-4]\s*\)/i, "")
    .replace(/\(\s*P[0-4]\s*,\s*/i, "(")
    .replace(/\s+/g, " ")
    .trim();

  return {
    id,
    kind,
    title: title || "Untitled",
    priority,
    status: inferTaskDigestStatus(titleWithMeta),
  };
}

function cleanDigestTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^[\s:;,.•*]*(?:->|=>|[-–—→])?\s*/, "")
    .replace(/\s*[○●◯]\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDigestText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function inferTaskDigestStatus(text: string): TaskDigestStatus {
  if (/blocked/i.test(text)) return "blocked";
  if (/cancelled|stopped|failed/i.test(text)) return "stopped";
  if (/completed|done/i.test(text)) return "done";
  return "open";
}

function TaskDigestView({ digest }: { digest: TaskDigest }) {
  return (
    <div className="space-y-2.5">
      {digest.intro && (
        <p className="text-foreground/88">
          {digest.intro}
        </p>
      )}

      <div className="space-y-2">
        {digest.groups.map((group, index) => (
          <TaskDigestGroupView key={`${group.epic.id}-${index}`} group={group} />
        ))}
        {digest.looseItems.length > 0 && (
          <div className="space-y-1">
            {digest.looseItems.map((item, index) => (
              <TaskDigestRow key={`${item.id}-${index}`} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskDigestGroupView({ group }: { group: TaskDigestGroup }) {
  return (
    <section className="rounded-md border border-border/35 bg-background/20 p-2.5">
      <div className="grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)_auto] items-start gap-2">
        <TaskDigestIdBadge item={group.epic} />
        <span className="min-w-0 font-semibold leading-snug text-foreground/95">
          {group.epic.title}
        </span>
        <TaskDigestMeta item={group.epic} className="justify-self-end pt-0.5" />
      </div>

      {group.items.length > 0 && (
        <div className="mt-2 space-y-1">
          {group.items.map((item, index) => (
            <TaskDigestRow key={`${group.epic.id}-${item.id}-${index}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function TaskDigestRow({ item }: { item: TaskDigestItem }) {
  return (
    <div className="grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)_auto] items-start gap-2 rounded-md bg-foreground/[0.035] px-2 py-1.5">
      <TaskDigestIdBadge item={item} compact />
      <span className="min-w-0 leading-snug text-foreground/82">{item.title}</span>
      <TaskDigestMeta item={item} className="justify-self-end pt-0.5" />
    </div>
  );
}

function TaskDigestIdBadge({ item, compact = false }: { item: TaskDigestItem; compact?: boolean }) {
  const tone =
    item.kind === "EPIC"
      ? "border-purple-300/30 bg-purple-400/10 text-purple-100"
      : item.kind === "CHOR"
        ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
        : "border-foreground/15 bg-foreground/[0.06] text-foreground/75";

  return (
    <span
      className={cn(
        "shrink-0 rounded border font-mono font-medium leading-none",
        compact ? "mt-0.5 w-full px-1.5 py-1 text-[10px]" : "w-full px-1.5 py-1 text-[10px]",
        tone,
      )}
    >
      {item.id}
    </span>
  );
}

function TaskDigestMeta({ item, className }: { item: TaskDigestItem; className?: string }) {
  if (!item.priority && item.status === "open") return null;

  return (
    <span className={cn("flex shrink-0 flex-wrap items-center gap-1", className)}>
      {item.priority && (
        <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-200/85">
          {item.priority}
        </span>
      )}
      {item.status !== "open" && (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
            item.status === "blocked" && "bg-red-400/10 text-red-200/85",
            item.status === "stopped" && "bg-orange-400/10 text-orange-200/85",
            item.status === "done" && "bg-green-400/10 text-green-200/85",
          )}
        >
          {item.status}
        </span>
      )}
    </span>
  );
}

function toolChipKey(tool: DraftTool, index: number): string {
  return `${tool.callId || tool.name || "tool"}-${index}`;
}

function visibleToolChips(tools?: DraftTool[]): DraftTool[] {
  return (tools ?? []).filter((tool) => !HIDDEN_TOOL_CHIP_NAMES.has(tool.name));
}

function formatToolArgs(args: unknown): string {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") return args.trim();
  const serialized = JSON.stringify(args);
  if (!serialized || serialized === "{}" || serialized === "[]" || serialized === "null" || serialized === "\"\"") {
    return "";
  }
  return serialized.slice(0, 80);
}

function ToolChipCluster({ tools }: { tools: DraftTool[] }) {
  if (tools.length === 0) return null;

  const doneTools = tools.filter((tool) => tool.status === "done");
  const otherTools = tools.filter((tool) => tool.status !== "done");
  const shouldSummarize = doneTools.length >= 3;

  return (
    <div className="flex max-w-[92%] flex-wrap items-center gap-1">
      {shouldSummarize && <ToolSummaryChip tools={doneTools} />}
      {(shouldSummarize ? otherTools : tools).map((tool, index) => (
        <CommittedToolChip key={toolChipKey(tool, index)} tool={tool} />
      ))}
    </div>
  );
}

function ToolSummaryChip({ tools }: { tools: DraftTool[] }) {
  const toolNames = tools.map((tool) => tool.name).join(", ");
  return (
    <div
      className="inline-flex h-5 items-center gap-1 rounded-full border border-border/35 bg-background/30 px-1.5 text-muted-foreground/65 backdrop-blur whitespace-nowrap"
      title={toolNames}
      aria-label={`${tools.length} tools ran: ${toolNames}`}
      style={{
        fontSize: "calc(var(--mentiko-agent-chip-font-size) * 0.92)",
        lineHeight: "1",
      }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
      <span className="text-foreground/70">{tools.length} tools ran</span>
    </div>
  );
}

function CommittedToolChip({ tool }: { tool: DraftTool }) {
  const label =
    tool.status === "running"
      ? "running"
      : tool.status === "done"
        ? "ran"
        : "failed";
  const argsStr = formatToolArgs(tool.args);
  return (
    <div
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border border-border/45 bg-background/45 px-2 py-0.5 text-muted-foreground/85 backdrop-blur",
      )}
      title={argsStr ? `${tool.name}: ${argsStr}` : tool.name}
      style={{
        fontSize: "var(--mentiko-agent-chip-font-size)",
        lineHeight: "var(--mentiko-agent-chip-line-height)",
      }}
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
