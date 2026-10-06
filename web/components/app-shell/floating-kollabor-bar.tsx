"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  useKollaborBarStore,
  KollaborMessage,
  KollaborAskRequest,
  DraftTool,
  BAR_SHUTDOWN_ERROR,
  SCALE_MIN,
  SCALE_MAX,
  KOLLABOR_BAR_DEFAULT_DOCK,
  getKollaborBarDockForPoint,
  type KollaborBarDock,
  clearPendingShutdownMarker,
  readPendingShutdownMarker,
  writePendingShutdownMarker,
} from "@/lib/ui/kollabor-bar-store";
import { useWorkspace } from "@/lib/ui-context/workspace-context";
import { usePillNavPreferences, getPillNavShineGradient } from "@/lib/ui/pill-nav-preferences";
import { cn } from "@/lib/utils";
import {
  getOrCreateSession,
  ensureMentikoAgentInstalled,
  sendMessage as engineSendMessage,
  respondToPermission as engineRespondToPermission,
  ping as enginePing,
  clearSessionHistory as engineClearSessionHistory,
  clearKollaborEngineStoredSession,
  type KollaborTurnContext,
  type CreateSessionRequest,
} from "@/lib/ai-engine/kollabor-engine-client";
import { getRouteContext } from "@/lib/kollabor/route-context";
import {
  isOnboardingDismissed,
  getOnboardingStepKey,
} from "@/lib/system/onboarding-storage";
import { KollaborPermissionPrompt } from "@/components/app-shell/kollabor-permission-prompt";
import { KollaborAskPrompt } from "@/components/app-shell/kollabor-ask-prompt";
import { KollaborModeChoicePrompt } from "@/components/app-shell/kollabor-mode-choice-prompt";
import { WaveSpinner } from "@/components/ui/wave-spinner";
import {
  MCPBarClient,
  getStoredSessionToken,
  syncSessionToken,
  replyToTool,
} from "@/lib/ai-engine/mentiko-mcp-bar-client";
import type { UIEffect } from "@/lib/ai-engine/mentiko-mcp-inbox";
import { showToast } from "@/components/app-shell/notifications-panel";
import { FLOATING_SURFACE_Z } from "@/lib/ui/floating-surface-z";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { unwrapApiData } from "@/lib/api/api-client";
import { isRecoverableKollaborSessionError } from "@/lib/ai-engine/kollabor-session-errors";
import { normalizeTaskNavigationRoute } from "@/lib/tasks/task-routes";
import { repairAgentTextSpacing } from "@/lib/agents/agent-message-text";
import {
  OPEN_FLOATING_APP_PANEL_EVENT,
  getFloatingPanelRouteTitle,
  isFloatingPanelRoute,
} from "@/lib/ui/floating-app-panel-routing";
import { useUser } from "@/lib/ui-context/user-context";
import { CODEX_INLINE_AUTH_MODEL } from "@/lib/agents/agent-provider-catalog";
import { getFloatingBarAvailability, useFloatingBarAvailability } from "@/lib/ui/floating-bar-availability";
import {
  registerFloatingBarRuntime,
  stopFloatingBarRuntime,
} from "@/lib/ui/floating-bar-lifecycle";
import { useFloatingBarStorageScope } from "@/components/app-shell/floating-bar-storage-scope";

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Derive lightweight new-user signals for the assistant turn context, reusing
 * the existing onboarding storage (same keys the dashboard onboarding uses).
 * Heuristic: treat the user as "new" while onboarding hasn't been dismissed OR
 * they have zero workspaces. Read at send time (not reactive) to avoid extra
 * re-renders of the bar; falls back to "not new" if storage is unavailable.
 */
function deriveNewUserSignals(
  userId: string | null | undefined,
  workspacesCount: number,
): { isNewUser: boolean; onboardingStep?: string } {
  if (typeof window === "undefined") return { isNewUser: false };
  try {
    const dismissed = isOnboardingDismissed(window.localStorage, userId);
    const isNewUser = !dismissed || workspacesCount === 0;
    if (!isNewUser) return { isNewUser: false };
    const step =
      window.localStorage.getItem(getOnboardingStepKey(userId))?.trim() || undefined;
    return { isNewUser: true, onboardingStep: step };
  } catch {
    return { isNewUser: false };
  }
}

/** Assemble the per-turn context the assistant receives (screen + new-user). */
function buildKollaborTurnContext(
  pathname: string,
  userId: string | null | undefined,
  workspacesCount: number,
): KollaborTurnContext {
  const { routeLabel, routeHelp } = getRouteContext(pathname);
  const { isNewUser, onboardingStep } = deriveNewUserSignals(userId, workspacesCount);
  return {
    pathname: pathname || "/",
    routeLabel,
    routeHelp,
    isNewUser,
    onboardingStep,
  };
}

// ---- proactive per-screen hint (new users only) --------------------------
// One dismissible suggestion per screen. Tapping it pre-fills the input (does
// NOT auto-send a turn). Never shown again once dismissed; dismissal is
// persisted in localStorage keyed by userId + the matched hint route so the
// guardrails survive reloads. Only the main routes get a hint; everything else
// gets none (no hint => nothing renders).

const KOLLABOR_HINT_DISMISSED_KEY = "mentiko-kollabor-hint-dismissed";

interface KollaborScreenHint {
  /** Stable route key used for dismissal persistence (NOT the live pathname). */
  routeKey: string;
  /** Short prompt shown on the chip; tapping pre-fills the input with it. */
  prompt: string;
}

/** Hints keyed by the same exact/prefix scheme as route-context. */
function getScreenHint(pathname: string): KollaborScreenHint | null {
  const path = (pathname || "/").split("?")[0].split("#")[0].replace(/(.)\/+$/, "$1");
  if (path === "/") {
    return { routeKey: "/", prompt: "What can I do here to get started?" };
  }
  if (path === "/chains" || path.startsWith("/chains/")) {
    return { routeKey: "/chains", prompt: "How do I build my first chain?" };
  }
  if (path === "/runs" || path.startsWith("/runs/")) {
    return { routeKey: "/runs", prompt: "What am I looking at on the runs screen?" };
  }
  if (path === "/code" || path.startsWith("/code/")) {
    return { routeKey: "/code", prompt: "How does the code workspace work?" };
  }
  if (path === "/agents/marketplace" || path.startsWith("/agents/marketplace/")) {
    return { routeKey: "/agents/marketplace", prompt: "How do I install an agent from here?" };
  }
  return null;
}

function isHintDismissed(
  userId: string | null | undefined,
  routeKey: string,
): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(
      `${KOLLABOR_HINT_DISMISSED_KEY}:${userId || "anonymous"}`,
    );
    if (!raw) return false;
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) && list.includes(routeKey);
  } catch {
    return false;
  }
}

function markHintDismissed(
  userId: string | null | undefined,
  routeKey: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const storageKey = `${KOLLABOR_HINT_DISMISSED_KEY}:${userId || "anonymous"}`;
    const raw = window.localStorage.getItem(storageKey);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    const next = Array.isArray(list) ? [...new Set([...list, routeKey])] : [routeKey];
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // ignore — a failed persist just means the hint may reappear next reload
  }
}

// suppress user-facing "engine offline" when the session store says we're
// still connected. a single failed ping (transient 401, network blip) used
// to flip the indicator to "offline" while chat kept working — the bar lied.
// engineReady/engineError still update for diagnostics; this only gates the
// user-visible error string.
export function shouldShowEngineOffline(stateConnected: boolean): boolean {
  return !stateConnected;
}

export function nextKollaborBarScaleFromWheel(current: number, deltaY: number): number {
  return Math.min(
    SCALE_MAX,
    Math.max(SCALE_MIN, current - deltaY * 0.0015),
  );
}

const SHOULD_OFFER_CODEX_INLINE_AUTH = false;
const HIDDEN_TOOL_CHIP_NAMES = new Set(["ask_confirm", "ask_input", "ask_choice"]);

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

function clampFreeBarOffsetX(
  offsetX: number,
  scale: number,
  configuredWidth: number,
): number {
  if (typeof window === "undefined") return offsetX;
  const barWidth = Math.min(configuredWidth, window.innerWidth - 32) * scale;
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

function kollaborSurfaceShadow(strength: number): string {
  if (strength <= 0) return "none";
  const blur = Math.max(2, Math.round(strength));
  const spread = Math.round(strength / 5);
  return `0 ${Math.round(strength * 0.55)}px ${blur}px -${spread}px rgba(0, 0, 0, 0.34), 0 3px ${Math.max(3, Math.round(strength * 0.55))}px -${Math.round(spread / 2)}px rgba(0, 0, 0, 0.2)`;
}

function kollaborBackdropMask(
  appearance: {
    backdropWidth: number;
    backdropHeight: number;
    backdropSoftness: number;
  },
  anchor: { x: string; y: string },
): string {
  const midStop = Math.max(35, Math.round(appearance.backdropSoftness * 0.72));
  return `radial-gradient(ellipse ${appearance.backdropWidth}px ${appearance.backdropHeight}px at ${anchor.x} ${anchor.y}, rgba(0,0,0,1) 0%, rgba(0,0,0,0.95) 35%, rgba(0,0,0,0.6) ${midStop}%, transparent ${appearance.backdropSoftness}%)`;
}

export function FloatingKollaborBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setWorkspaceId, workspaces } = useWorkspace();
  // Defensive: some test mocks of useWorkspace omit `workspaces`. Treat a
  // missing list as empty so new-user signal derivation never throws.
  const workspacesCount = workspaces?.length ?? 0;
  const { user, loading: userLoading } = useUser();
  const { storageScopeReady } = useFloatingBarStorageScope();
  const availability = useFloatingBarAvailability();
  const runtimeMayStart = availability.runtimeMayStart;
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
    sessionScope,
    storageScope,
    generation,
    barWidth,
    appearance,
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
    updateToolByCallId,
    finishDraft,
    pushPermissionRequest,
    resolvePermission,
    pushAskRequest,
    resolveAsk,
    setYoloMode,
    setYoloPromptSeen,
    resolveModeChoice,
  } = useKollaborBarStore();

  const { offsetX, offsetY, dock, setOffset, setDock, scale, setScale, fontScale } =
    useKollaborBarStore();
  const { prefs: pillPrefs } = usePillNavPreferences();
  const shineColors = getPillNavShineGradient(pillPrefs);
  const fontVars = useMemo(() => agentFontVars(fontScale), [fontScale]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const sendingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingToolInstancesRef = useRef<Map<string, string[]>>(new Map());
  // message stashed while the first-run mode choice is pending
  const pendingFirstMessageRef = useRef<string | null>(null);
  const bootRef = useRef<(() => Promise<void>) | null>(null);
  const pendingBootOwnersRef = useRef<Set<object>>(new Set());
  const runtimeGenerationRef = useRef(0);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentPageAbortRef = useRef<AbortController | null>(null);
  const runtimeAllowedRef = useRef(runtimeMayStart);
  runtimeAllowedRef.current = runtimeMayStart;
  const wasRuntimeAllowedRef = useRef(runtimeMayStart);
  const renderedRuntimeGeneration = runtimeGenerationRef.current;
  const renderedRuntimeIdentity = useMemo(() => ({
    scope: storageScope,
    storeGeneration: generation,
    runtimeGeneration: renderedRuntimeGeneration,
    sessionId,
    sessionScope,
  }), [generation, renderedRuntimeGeneration, sessionId, sessionScope, storageScope]);
  const isRuntimeIdentityCurrent = useCallback((
    identity: typeof renderedRuntimeIdentity,
    includeSession = false,
  ) => {
    const current = useKollaborBarStore.getState();
    return Boolean(
      runtimeAllowedRef.current &&
      getFloatingBarAvailability(current).runtimeMayStart &&
      runtimeGenerationRef.current === identity.runtimeGeneration &&
      current.storageScope === identity.scope &&
      current.generation === identity.storeGeneration &&
      (!includeSession || (
        current.sessionId === identity.sessionId &&
        current.sessionScope === identity.sessionScope
      )),
    );
  }, []);

  useLayoutEffect(() => {
    if (wasRuntimeAllowedRef.current && !runtimeMayStart) {
      runtimeGenerationRef.current += 1;
    }
    wasRuntimeAllowedRef.current = runtimeMayStart;
  }, [runtimeMayStart]);
  const sessionRequestRef = useRef<CreateSessionRequest | null>(null);
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
  // proactive per-screen hint (new users only) — see helpers above
  const [activeHint, setActiveHint] = useState<KollaborScreenHint | null>(null);
  const [codexAuthPromptOpen, setCodexAuthPromptOpen] = useState(false);
  const [codexAuthChecked, setCodexAuthChecked] = useState(false);
  const [codexAuthDecision, setCodexAuthDecision] = useState<null | "accept" | "decline">(null);
  const [codexToken, setCodexToken] = useState<string | null>(null);
  const [codexTokenLoading, setCodexTokenLoading] = useState(true);
  const [runtimeBootstrapEpoch, setRuntimeBootstrapEpoch] = useState(0);
  // lane B3: when the tenant has MENTIKO_AI_GATEWAY_ENABLED=true, the engine
  // already has a working "mentiko" profile (wired by lane B2). skip the
  // codex token prompt + credentials entirely in that mode.
  const [gatewayState, setGatewayState] = useState<
    | { gatewayEnabled: boolean; mentikoProfileActive: boolean }
    | null
  >(null);
  const gatewayLoaded = gatewayState !== null;
  const gatewayMode = gatewayState?.gatewayEnabled === true;
  const codexFlowActive = gatewayLoaded && !gatewayMode && SHOULD_OFFER_CODEX_INLINE_AUTH;
  // delay reading persisted offset/scale until after mount so SSR output matches first client render
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => Boolean(
        sendingRef.current || pendingBootOwnersRef.current.size > 0 || abortControllerRef.current,
      ),
      invalidateLocal: () => {
        runtimeGenerationRef.current += 1;
        // The shutdown helper samples mayHaveActiveTurn before calling this.
        // Once sampled, pending creates are locally invalidated; their remote
        // outcome remains represented by the helper's fail-closed marker.
        pendingBootOwnersRef.current.clear();
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        currentPageAbortRef.current?.abort();
        currentPageAbortRef.current = null;
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
        mcpClientRef.current?.disconnect();
        mcpClientRef.current = null;
        sendingRef.current = false;
        pendingFirstMessageRef.current = null;
        pendingToolInstancesRef.current.clear();
        useKollaborBarStore.getState().cancelPendingPrompts();
        useKollaborBarStore.getState().invalidateGeneration();
        setConnected(false);
        setConnecting(false);
        setEngineReady(false);
        setEngineError(null);
      },
    });
    return () => {
      const state = useKollaborBarStore.getState();
      void stopFloatingBarRuntime({
        scope: state.storageScope,
        sessionId: state.sessionId,
        generation: state.generation,
      });
      unregister();
    };
  }, [setConnected, setConnecting, setEngineError, setEngineReady]);

  // lane B3: ask the server if MENTIKO_AI_GATEWAY_ENABLED is set. boot() waits
  // on this so we don't flash the codex prompt before knowing the mode.
  useEffect(() => {
    if (!runtimeMayStart) {
      setGatewayState(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/system/ai-gateway", { cache: "no-store" });
        if (!res.ok) throw new Error(`ai-gateway probe failed: ${res.status}`);
        const data = unwrapApiData<{
          gatewayEnabled?: boolean;
          mentikoProfileActive?: boolean;
        }>(await res.json());
        if (cancelled) return;
        setGatewayState({
          gatewayEnabled: data.gatewayEnabled === true,
          mentikoProfileActive: data.mentikoProfileActive === true,
        });
      } catch {
        // fall back to "gateway disabled" so the existing codex/disabled path runs
        if (!cancelled) {
          setGatewayState({ gatewayEnabled: false, mentikoProfileActive: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtimeMayStart]);

  // Keep routerRef current so handleEffect stays stable across navigations
  useEffect(() => { routerRef.current = router; }, [router]);

  // MCP Effect Handling — stable callback (no router in deps, uses ref instead)
  const handleEffect = useCallback(
    (
      effect: UIEffect,
      runtimeGuard?: { scope: string; isCurrent: () => boolean },
    ) => {
      if (!runtimeAllowedRef.current || (runtimeGuard && !runtimeGuard.isCurrent())) return;
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
          // The message is the content — make it the primary line. The level is
          // already conveyed by the icon + accent ring, so don't repeat it as a
          // big "INFO"/"SUCCESS" title that dwarfs the actual message.
          showToast({
            type: (stringPayload(payload, "level") || "info") as "error" | "success" | "warning" | "info",
            title: stringPayload(payload, "message") || "",
            message: "",
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
        case "ask_choice": {
          const askToolId = stringPayload(payload, "toolId") || "";
          const askPrompt =
            stringPayload(payload, "question") ||
            stringPayload(payload, "prompt") ||
            "";
          // YOLO mode: auto-approve MCP permission gates ("allow <tool>?")
          // without prompting. Read live state so a mid-turn toggle applies.
          if (
            kind === "ask_choice" &&
            askToolId &&
            /^allow .+\?/.test(askPrompt) &&
            useKollaborBarStore.getState().yoloMode
          ) {
            void replyToTool(askToolId, "approve", runtimeGuard).catch(() => {});
            break;
          }
          pushAskRequest({
            toolId: askToolId,
            kind: kind as KollaborAskRequest["kind"],
            prompt: askPrompt,
            options: arrayPayload(payload, "options"),
            placeholder: stringPayload(payload, "placeholder"),
          });
          setExpanded(true);
          break;
        }
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
  const configuredBarWidth = barWidth;
  const effOffsetX = mounted
    ? clampFreeBarOffsetX(offsetX, effScale, configuredBarWidth)
    : 0;
  const effOffsetY = mounted ? offsetY : 0;
  const effDock = mounted ? dock : KOLLABOR_BAR_DEFAULT_DOCK;
  const gripRef = useRef<HTMLButtonElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      if (!runtimeAllowedRef.current) return;
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
        width: barRect?.width ?? configuredBarWidth,
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
    [configuredBarWidth],
  );

  const updateDragPosition = useCallback(
    (clientX: number, clientY: number) => {
      if (!runtimeAllowedRef.current) return;
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
    if (!runtimeAllowedRef.current) {
      dragStartRef.current = null;
      dragPositionRef.current = null;
      setDragPosition(null);
      setDragging(false);
      return;
    }
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
    if (!runtimeMayStart) return;
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
  }, [dragging, onDragEnd, runtimeMayStart, updateDragPosition]);

  // scroll-wheel over the pill or drag grip to resize (hover + scroll = zoom)
  useEffect(() => {
    if (!runtimeMayStart) return;
    const pill = pillRef.current;
    const grip = gripRef.current;
    const targets = Array.from(new Set([pill, grip].filter(Boolean))) as HTMLElement[];
    if (targets.length === 0) return;
    // proportional to wheel delta, then rate-limited via rAF so trackpad bursts
    // don't run away. feels like a smooth continuous zoom instead of step-per-tick.
    let pendingDelta = 0;
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (pendingDelta === 0) return;
      const current = useKollaborBarStore.getState().scale;
      const next = nextKollaborBarScaleFromWheel(current, pendingDelta);
      pendingDelta = 0;
      setScale(next);
    };
    const onWheel = (e: WheelEvent) => {
      // only intercept when NOT scrolling inside the textarea
      const target = e.target as Element;
      if (target.tagName === "TEXTAREA") return;
      e.preventDefault();
      e.stopPropagation();
      pendingDelta += e.deltaY;
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };
    for (const target of targets) {
      target.addEventListener("wheel", onWheel, { passive: false });
    }
    return () => {
      for (const target of targets) {
        target.removeEventListener("wheel", onWheel);
      }
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [runtimeMayStart, setScale]);

  const handleGripWheel = useCallback(
    (e: React.WheelEvent<HTMLButtonElement>) => {
      if (!runtimeAllowedRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const current = useKollaborBarStore.getState().scale;
      setScale(nextKollaborBarScaleFromWheel(current, e.deltaY));
    },
    [setScale],
  );

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
    if (!runtimeMayStart) {
      setCodexToken(null);
      setCodexTokenLoading(false);
      setCodexAuthChecked(false);
      setCodexAuthPromptOpen(false);
      return;
    }
    // wait until the ai-gateway probe resolves so we don't flash the prompt
    if (!gatewayLoaded) return;

    // gateway mode (or feature flag off): skip the codex token probe entirely
    if (!codexFlowActive) {
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
  }, [codexFlowActive, gatewayLoaded, runtimeMayStart]);

  const handleCodexAuthDecision = useCallback((decision: "accept" | "decline") => {
    if (!runtimeAllowedRef.current) return;
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
    let booting = false;
    const effectState = useKollaborBarStore.getState();
    const effectIdentity = {
      scope: effectState.storageScope,
      storeGeneration: effectState.generation,
      runtimeGeneration: runtimeGenerationRef.current,
      sessionId: effectState.sessionId,
      sessionScope: effectState.sessionScope,
    };
    const isCurrent = () => !cancelled && isRuntimeIdentityCurrent(effectIdentity);

    if (!runtimeMayStart) {
      setConnecting(false);
      setConnected(false);
      return () => { cancelled = true; };
    }

    function connectMcpClient() {
      if (!isCurrent()) return;
      const clientState = useKollaborBarStore.getState();
      const clientIdentity = {
        scope: clientState.storageScope,
        storeGeneration: clientState.generation,
        runtimeGeneration: runtimeGenerationRef.current,
        sessionId: clientState.sessionId,
        sessionScope: clientState.sessionScope,
      };
      const isClientCurrent = () =>
        !cancelled && isRuntimeIdentityCurrent(clientIdentity, true);
      if (!isClientCurrent()) return;
      // Disconnect any existing client before opening a new one.
      // The async boot() race previously created a second SSE stream that
      // was never cleaned up, leaking connections until Chrome's 6-per-origin
      // cap was hit and all navigation froze.
      if (mcpClientRef.current) {
        mcpClientRef.current.disconnect();
        mcpClientRef.current = null;
      }
      const client = new MCPBarClient((effect) => {
        if (isClientCurrent()) {
          handleEffect(effect, { scope: clientIdentity.scope, isCurrent: isClientCurrent });
        }
      });
      mcpClientRef.current = client;
      client.connect();
    }

    async function boot() {
      if (booting || !isCurrent()) return;
      booting = true;
      const bootOwner = {};
      pendingBootOwnersRef.current.add(bootOwner);
      bootRef.current = boot;
      setConnecting(true);
      setError(null);
      setEngineError(null);
      try {
        if (userLoading || !storageScopeReady || !isCurrent()) {
          setConnecting(false);
          setConnected(false);
          return;
        }
        // lane B3: hold until the ai-gateway probe resolves so we don't
        // either flash the codex prompt or briefly run as "no profile".
        if (!gatewayLoaded) {
          setConnecting(true);
          setConnected(false);
          return;
        }
        const setup = await ensureMentikoAgentInstalled();
        if (!isCurrent()) return;
        const reachable = await enginePing();
        if (!isCurrent()) return;
        if (!codexAuthChecked || codexTokenLoading) {
          setConnecting(false);
          setConnected(false);
          return;
        }

        if (codexFlowActive && codexToken && codexAuthDecision === null) {
          setCodexAuthPromptOpen(true);
          setError("found ~/.codex codex token, choose if this agent should use it");
          setExpanded(true);
          setConnecting(false);
          setConnected(false);
          return;
        }
        if (!isCurrent()) return;
        setEngineReady(reachable);
        if (!reachable) {
          // capture connected BEFORE flipping it — otherwise the gate is a no-op
          const wasConnected = useKollaborBarStore.getState().connected;
          setConnecting(false);
          setConnected(false);
          if (shouldShowEngineOffline(wasConnected)) {
            setError("engine offline — start kollabor-engine");
          }
          setEngineError("engine offline");
          return;
        }
        // lane B3: in gateway mode the engine boot script already set
        // active_profile="mentiko"; skip the network read.
        const activeProfile = gatewayMode
          ? "mentiko"
          : await fetch("/api/kollabor/profiles/active", { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => (typeof j?.active === "string" && j.active ? j.active : "mentiko"))
              .catch(() => "mentiko");
        if (!isCurrent()) return;

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

        // lane B3: gateway mode = engine already authenticated via the
        // mentiko profile, do NOT pass credentials.
        if (codexFlowActive && codexToken && codexAuthDecision === "accept") {
          sessionRequest.credentials = {
            provider: "openai",
            model: CODEX_INLINE_AUTH_MODEL,
            api_key: codexToken,
          };
        }

        sessionRequestRef.current = sessionRequest;
        // A session create can be accepted remotely before its promise settles.
        // Bind the null-session runtime to this scope before entering the
        // token/create path so shutdown can capture it and write `unknown`.
        useKollaborBarStore.setState({ sessionScope: effectIdentity.scope });
        const { sessionId: sid, sessionToken } = await getOrCreateSession(sessionRequest);
        if (!isCurrent()) return;
        // Keep SSE auth aligned with this engine session. If no fresh token
        // comes back, clear stale JWTs so the client uses this session id.
        syncSessionToken(sessionToken);
        setSessionId(sid);
        setConnected(true);
        setConnecting(false);

        // Reconnect with the fresh session-scoped token
        connectMcpClient();
      } catch (e) {
        if (!isCurrent()) return;
        const msg = e instanceof Error ? e.message : String(e);
        setConnecting(false);
        setConnected(false);
        setError(`session setup failed: ${msg}`);
        setEngineError(msg);
      } finally {
        booting = false;
        pendingBootOwnersRef.current.delete(bootOwner);
      }
    }

    void boot();

    pingTimerRef.current = setInterval(async () => {
      if (!isCurrent()) return;
      try {
        const ok = await enginePing();
        if (!isCurrent()) return;
        setEngineReady(ok);
        if (ok) {
          const state = useKollaborBarStore.getState();
          if (state.error?.startsWith("engine offline")) {
            setError(null);
            setEngineError(null);
          }
          if (!state.connected && !state.connecting) void boot();
        } else {
          // gate: a single failed ping while session is live is a transient
          // blip, not a real outage. only surface the error if we've actually
          // lost the session AND nothing else has claimed the error slot.
          const s = useKollaborBarStore.getState();
          if (shouldShowEngineOffline(s.connected) && !s.error) {
            setError("engine offline");
          }
        }
      } catch {
        if (isCurrent()) setEngineReady(false);
      }
    }, 30000);

    return () => {
      cancelled = true;
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
      if (bootRef.current) bootRef.current = null;
      if (mcpClientRef.current) {
        mcpClientRef.current.disconnect();
        mcpClientRef.current = null;
      }
    };
  }, [
    codexAuthChecked,
    codexAuthDecision,
    codexAuthPromptOpen,
    codexFlowActive,
    codexToken,
    codexTokenLoading,
    gatewayLoaded,
    gatewayMode,
    handleEffect,
    runtimeMayStart,
    setConnected,
    setConnecting,
    setEngineError,
    setEngineReady,
    setError,
    setExpanded,
    setSessionId,
    storageScopeReady,
    isRuntimeIdentityCurrent,
    userLoading,
    runtimeBootstrapEpoch,
  ]);

  useEffect(() => {
    if (!runtimeMayStart) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && expanded) {
        setExpanded(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, runtimeMayStart, setExpanded]);

  // Report the current URL to the MCP backend whenever it changes. Lets
  // koordinator call `get_current_page` and know where granny is looking
  // without reading the DOM.
  useEffect(() => {
    if (!runtimeMayStart || !connected || !sessionId || !availability.activeSessionMatchesScope) return;
    const generation = runtimeGenerationRef.current;
    const search = searchParams?.toString() || "";
    const title = typeof document !== "undefined" ? document.title : "";
    const token = getStoredSessionToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    currentPageAbortRef.current?.abort();
    currentPageAbortRef.current = controller;
    void fetch("/api/mentiko-mcp/current-page", {
      method: "POST",
      credentials: "same-origin",
      headers,
      signal: controller.signal,
      body: JSON.stringify({ pathname, search, label: title, sessionId }),
    }).catch(() => {}).finally(() => {
      if (runtimeGenerationRef.current === generation && currentPageAbortRef.current === controller) {
        currentPageAbortRef.current = null;
      }
    });
    return () => controller.abort();
  }, [availability.activeSessionMatchesScope, connected, pathname, runtimeMayStart, searchParams, sessionId]);

  // Recompute the proactive per-screen hint when the route or new-user signals
  // change. Show at most one hint, only for new users, only on screens that
  // have one, and never one the user already dismissed. Cleared (no chip) the
  // moment any guard fails — including once the user is no longer "new".
  useEffect(() => {
    if (!runtimeMayStart || userLoading) {
      setActiveHint(null);
      return;
    }
    const { isNewUser } = deriveNewUserSignals(user?.id, workspacesCount);
    if (!isNewUser) {
      setActiveHint(null);
      return;
    }
    const hint = getScreenHint(pathname);
    if (!hint || isHintDismissed(user?.id, hint.routeKey)) {
      setActiveHint(null);
      return;
    }
    setActiveHint(hint);
  }, [pathname, runtimeMayStart, user?.id, userLoading, workspacesCount]);

  const dismissHint = useCallback(() => {
    setActiveHint((current) => {
      if (current) markHintDismissed(user?.id, current.routeKey);
      return null;
    });
  }, [user?.id]);

  // Tapping the hint pre-fills the input and opens the bar — it does NOT send a
  // turn. The user stays in control of whether to actually ask. Dismiss after
  // accepting so it doesn't linger.
  const acceptHint = useCallback(() => {
    if (!runtimeAllowedRef.current) return;
    const prompt = activeHint?.prompt;
    if (!prompt) return;
    dismissHint();
    setInputValue(prompt);
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [activeHint, dismissHint, setInputValue, setExpanded]);

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

  const resetEngineSession = useCallback(async () => {
    const identity = renderedRuntimeIdentity;
    if (!isRuntimeIdentityCurrent(identity, true)) return;
    const sid = identity.sessionId;
    // The lifecycle helper persists a scoped marker before cancellation and
    // blocks on receipt-only, rejected, timed-out, or otherwise unverifiable
    // results. Never create a replacement session from this reset path.
    const stopped = await stopFloatingBarRuntime({
      scope: identity.scope,
      sessionId: sid,
      generation: identity.storeGeneration,
    });
    if (!stopped.ok) return;

    const stoppedState = useKollaborBarStore.getState();
    if (
      stoppedState.storageScope !== identity.scope ||
      stoppedState.sessionScope !== identity.scope ||
      stoppedState.sessionId !== sid
    ) return;
    setError(null);
    setEngineError(null);
    clearMessages();

    if (sid) {
      const cleanupGeneration = stoppedState.generation;
      const cleanupMarker = {
        scope: identity.scope,
        sessionId: sid,
        generation: cleanupGeneration,
        startedAt: Date.now(),
      };
      if (!writePendingShutdownMarker(cleanupMarker)) {
        stoppedState.setShutdownState({
          pending: true,
          blocked: true,
          error: BAR_SHUTDOWN_ERROR,
        });
        return;
      }
      stoppedState.setShutdownState({ pending: true, blocked: true, error: null });
      try {
        await engineClearSessionHistory(sid);
      } catch {
        const latest = useKollaborBarStore.getState();
        if (
          latest.storageScope === identity.scope &&
          latest.sessionScope === identity.scope &&
          latest.sessionId === sid &&
          latest.generation === cleanupGeneration
        ) {
          // The marker and recovery error remain visible; no replacement
          // session is safe while the original reset is unresolved.
          latest.setShutdownState({
            pending: true,
            blocked: true,
            error: BAR_SHUTDOWN_ERROR,
          });
        }
        return;
      }

      const latest = useKollaborBarStore.getState();
      const marker = readPendingShutdownMarker(identity.scope);
      if (
        latest.storageScope !== identity.scope ||
        latest.sessionScope !== identity.scope ||
        latest.sessionId !== sid ||
        latest.generation !== cleanupGeneration ||
        marker?.generation !== cleanupMarker.generation ||
        marker.startedAt !== cleanupMarker.startedAt
      ) return;
      if (!clearPendingShutdownMarker(identity.scope)) {
        latest.setShutdownState({
          pending: true,
          blocked: true,
          error: BAR_SHUTDOWN_ERROR,
        });
        return;
      }
      latest.setShutdownState({ pending: false, blocked: false, error: null });
      clearKollaborEngineStoredSession();
      setSessionId(null);
      setRuntimeBootstrapEpoch((epoch) => epoch + 1);
    }
  }, [
    clearMessages,
    setSessionId,
    setEngineError,
    setError,
    renderedRuntimeIdentity,
    isRuntimeIdentityCurrent,
  ]);

  const handleStop = useCallback(async () => {
    const identity = renderedRuntimeIdentity;
    if (!isRuntimeIdentityCurrent(identity, true)) return;
    const stopped = await stopFloatingBarRuntime({
      scope: identity.scope,
      sessionId: identity.sessionId,
      generation: identity.storeGeneration,
    });
    if (!stopped.ok) return;
    const current = useKollaborBarStore.getState();
    if (
      current.storageScope !== identity.scope ||
      current.sessionScope !== identity.scope ||
      current.sessionId !== identity.sessionId
    ) return;
    setRuntimeBootstrapEpoch((epoch) => epoch + 1);
  }, [
    isRuntimeIdentityCurrent,
    renderedRuntimeIdentity,
  ]);

  const activeAskMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.ask && message.ask.result === undefined) return message;
    }
    return null;
  }, [messages]);

  const runSend = useCallback(async (content: string) => {
    const initialState = useKollaborBarStore.getState();
    const runtimeIdentity = {
      scope: initialState.storageScope,
      storeGeneration: initialState.generation,
      runtimeGeneration: runtimeGenerationRef.current,
      sessionId: initialState.sessionId,
      sessionScope: initialState.sessionScope,
    };
    const isRunCurrent = () => isRuntimeIdentityCurrent(runtimeIdentity);
    if (!isRunCurrent() || !availability.activeSessionMatchesScope) return;
    const sid = initialState.sessionId;
    if (!sid || sendingRef.current) return;
    const uid = randomId();
    pendingToolInstancesRef.current.clear();
    pushMessage({ id: uid, role: "user", content, timestamp: Date.now() });
    sendingRef.current = true;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    startDraft();
    // Tell the assistant where the user is and whether they're new, so it can
    // give screen-aware, onboarding-aware help. Built fresh per turn from the
    // live pathname + onboarding signals; the user's bubble still shows the
    // plain text (the context only rides along to the engine).
    const turnContext = buildKollaborTurnContext(pathname, user?.id, workspacesCount);
    try {
      let activeSessionId = sid;
      let retriedSession = false;
      let shouldRetry = false;

      do {
        shouldRetry = false;
        for await (const ev of engineSendMessage(activeSessionId, content, turnContext, abortController.signal)) {
          if (!isRunCurrent()) break;
          switch (ev.type) {
          case "token":
            if (ev.text) appendDraftText(ev.text);
            break;
          case "thinking":
            setDraftThinking(true);
            break;
          case "tool_start": {
            // The engine reuses the same tool_id on tool_start and tool_result,
            // so use it directly as the chip id — a stable key that survives
            // draft commit (permission gating) and turn_complete clears. Only
            // synthesize an id (with FIFO tracking) when the engine omits one.
            const startToolId =
              typeof ev.tool_id === "string" && ev.tool_id.length > 0
                ? ev.tool_id
                : null;
            let callId: string;
            if (startToolId) {
              callId = startToolId;
            } else {
              const key = String(ev.tool_name ?? "tool");
              callId = `${key}-${randomId()}`;
              const pending = pendingToolInstancesRef.current.get(key) ?? [];
              pending.push(callId);
              pendingToolInstancesRef.current.set(key, pending);
            }
            addDraftTool({
              callId,
              name: ev.tool_name,
              args: ev.input,
              status: "running",
              riskLevel: ev.risk_level,
            });
            break;
          }
          case "tool_result": {
            const resultToolId =
              typeof ev.tool_id === "string" && ev.tool_id.length > 0
                ? ev.tool_id
                : null;
            let callId: string;
            if (resultToolId) {
              callId = resultToolId;
            } else {
              const key = String(ev.tool_name ?? "tool");
              const pending = pendingToolInstancesRef.current.get(key);
              callId = pending?.shift() ?? key;
              if (pending && pending.length === 0) {
                pendingToolInstancesRef.current.delete(key);
              }
            }
            updateToolByCallId(callId, {
              status: ev.success ? "done" : "error",
              output: ev.output,
              error: ev.error || undefined,
            });
            break;
          }
          case "permission_request":
            // commit any current draft so far, then push the permission message
            finishDraft();
            // YOLO mode: auto-approve without prompting. Read live state so a
            // mid-turn /yolo toggle takes effect on the very next tool call.
            if (useKollaborBarStore.getState().yoloMode) {
              if (isRunCurrent()) {
                void engineRespondToPermission(activeSessionId, ev.tool_id, "approve").catch(
                  () => {},
                );
              }
            } else {
              pushPermissionRequest({
                toolId: ev.tool_id,
                toolName: ev.tool_name,
                toolType: ev.tool_type,
                input: ev.input,
                riskLevel: ev.risk_level,
                riskReason: ev.risk_reason,
              });
            }
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
            // A local Stop/Clear abort deliberately closes the SSE stream.
            // Do not surface that expected cancellation as an engine error or
            // attempt stale-session recovery from the synthetic abort event.
            if (abortController.signal.aborted || ev.code === "aborted") {
              finishDraft();
              break;
            }
            // Session expired or engine restarted: clear stale IDs and reconnect.
            if (isRecoverableKollaborSessionError(msg)) {
              clearKollaborEngineStoredSession();
              setSessionId(null);
              setConnected(false);
              setConnecting(false);
              finishDraft();
              if (!retriedSession) {
                retriedSession = true;
                shouldRetry = true;
              } else {
                setError(String(msg));
              }
            } else {
              setError(String(msg));
              finishDraft();
            }
            break;
          }
          default:
            break;
          }
          if (shouldRetry) break;
        }
        if (shouldRetry && isRunCurrent()) {
          setConnecting(true);
          pendingToolInstancesRef.current.clear();
          const createIdentity = {
            ...runtimeIdentity,
            sessionId: null,
            sessionScope: runtimeIdentity.scope,
          };
          useKollaborBarStore.setState({ sessionScope: runtimeIdentity.scope });
          const { sessionId: nextSessionId, sessionToken } = await getOrCreateSession(
            sessionRequestRef.current ?? {},
          );
          if (!isRuntimeIdentityCurrent(createIdentity, true)) break;
          syncSessionToken(sessionToken);
          activeSessionId = nextSessionId;
          setSessionId(nextSessionId);
          setConnected(true);
          setConnecting(false);
          startDraft();
        }
      } while (shouldRetry);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isRunCurrent()) {
        if (!abortController.signal.aborted) setError(`send failed: ${msg}`);
        setConnecting(false);
        finishDraft();
        pendingToolInstancesRef.current.clear();
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        sendingRef.current = false;
        pendingToolInstancesRef.current.clear();
      }
    }
  }, [
    pathname,
    user?.id,
    workspacesCount,
    pushMessage,
    setError,
    setSessionId,
    setConnected,
    setConnecting,
    startDraft,
    appendDraftText,
    setDraftThinking,
    addDraftTool,
    updateToolByCallId,
    finishDraft,
    pushPermissionRequest,
    availability.activeSessionMatchesScope,
    isRuntimeIdentityCurrent,
  ]);

  // When YOLO turns on, clear any prompts already waiting on screen so the
  // user isn't stuck approving the one that's blocking the turn.
  const flushPendingApprovals = useCallback(() => {
    const identity = renderedRuntimeIdentity;
    const isCurrent = () => isRuntimeIdentityCurrent(identity, true);
    if (!isCurrent() || !availability.activeSessionMatchesScope) return;
    const { sessionId: sid, messages: msgs } = useKollaborBarStore.getState();
    for (const m of msgs) {
      if (m.permission && m.permission.decision === undefined) {
        resolvePermission(m.id, "approve");
        if (sid && runtimeAllowedRef.current) {
          void engineRespondToPermission(sid, m.permission.toolId, "approve").catch(
            () => {},
          );
        }
      } else if (
        m.ask &&
        m.ask.result === undefined &&
        /^allow .+\?/.test(m.ask.prompt)
      ) {
        void replyToTool(m.ask.toolId, "approve", {
          scope: identity.scope,
          isCurrent,
        }).catch(() => {});
        resolveAsk(m.id, "approve");
      }
    }
  }, [
    availability.activeSessionMatchesScope,
    isRuntimeIdentityCurrent,
    renderedRuntimeIdentity,
    resolvePermission,
    resolveAsk,
  ]);

  const handleSend = useCallback(async () => {
    const identity = renderedRuntimeIdentity;
    if (!isRuntimeIdentityCurrent(identity, true)) return;
    const state = useKollaborBarStore.getState();
    if (state.sessionId && !availability.activeSessionMatchesScope) return;
    const content = state.inputValue.trim();
    if (content.length === 0) return;

    // local slash command: /yolo [on|off|toggle] — handled locally and allowed
    // mid-turn, so it can switch off prompting while a turn is blocked on one.
    const yolo = parseYoloCommand(content);
    if (yolo !== null) {
      setInputValue("");
      const next = yolo === "toggle" ? !state.yoloMode : yolo === "on";
      setYoloMode(next);
      setYoloPromptSeen(true);
      setExpanded(true);
      if (next) flushPendingApprovals();
      pushMessage({
        id: randomId(),
        role: "system",
        content: next
          ? "⚡ YOLO mode on — I'll run tools without asking for approval. You can change this anytime in Settings → Mentiko Agent."
          : "🛡️ Approval mode on — I'll ask before running each tool. You can change this anytime in Settings → Mentiko Agent.",
        timestamp: Date.now(),
      });
      return;
    }

    // Anything sent to the engine needs an idle, connected session. Never
    // silently drop user input: the bar is also the recovery surface.
    if (sendingRef.current) return;
    if (!state.connected || !state.sessionId) {
      if (state.connecting) {
        setError("still connecting…");
        return;
      }
      setError("Kollabor is offline — retrying connection…");
      setConnecting(true);
      const createIdentity = {
        ...identity,
        sessionId: null,
        sessionScope: identity.scope,
      };
      clearKollaborEngineStoredSession();
      setSessionId(null);
      useKollaborBarStore.setState({ sessionScope: identity.scope });
      const createOwner = {};
      pendingBootOwnersRef.current.add(createOwner);
      try {
        if (!isRuntimeIdentityCurrent(createIdentity, true)) return;
        const { sessionId: nextSessionId, sessionToken } = await getOrCreateSession(
          sessionRequestRef.current ?? {},
        );
        if (!isRuntimeIdentityCurrent(createIdentity, true)) return;
        syncSessionToken(sessionToken);
        setSessionId(nextSessionId);
        setConnected(true);
        setConnecting(false);
        setError(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isRuntimeIdentityCurrent(createIdentity, true)) {
          setConnecting(false);
          setError(`connection failed: ${msg}`);
        }
      } finally {
        pendingBootOwnersRef.current.delete(createOwner);
      }
      return;
    }

    // first run: let the user pick approval vs YOLO before the first real send.
    if (!state.yoloPromptSeen) {
      pendingFirstMessageRef.current = content;
      setInputValue("");
      setExpanded(true);
      pushMessage({
        id: randomId(),
        role: "system",
        content: "",
        timestamp: Date.now(),
        modeChoice: {},
      });
      return;
    }

    setInputValue("");
    await runSend(content);
  }, [
    availability.activeSessionMatchesScope,
    isRuntimeIdentityCurrent,
    renderedRuntimeIdentity,
    runSend,
    pushMessage,
    setInputValue,
    setExpanded,
    setYoloMode,
    setYoloPromptSeen,
    flushPendingApprovals,
    setConnected,
    setConnecting,
    setError,
    setSessionId,
  ]);

  const handleModeChoice = useCallback(
    (messageId: string, choice: "permission" | "yolo") => {
      if (!isRuntimeIdentityCurrent(renderedRuntimeIdentity, true)) return;
      resolveModeChoice(messageId, choice);
      const pending = pendingFirstMessageRef.current;
      pendingFirstMessageRef.current = null;
      if (pending) void runSend(pending);
    },
    [
      isRuntimeIdentityCurrent,
      renderedRuntimeIdentity,
      resolveModeChoice,
      runSend,
    ],
  );

  const handlePermissionRespond = useCallback(
    async (
      messageId: string,
      toolId: string,
      decision: "approve" | "approve_always" | "deny",
    ) => {
      const identity = renderedRuntimeIdentity;
      if (!isRuntimeIdentityCurrent(identity, true) || !availability.activeSessionMatchesScope) return;
      const sid = identity.sessionId;
      if (!sid) return;
      // optimistic local update
      resolvePermission(messageId, decision);
      try {
        await engineRespondToPermission(sid, toolId, decision);
        if (!isRuntimeIdentityCurrent(identity, true)) return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isRuntimeIdentityCurrent(identity, true)) setError(`permission failed: ${msg}`);
      }
    },
    [
      availability.activeSessionMatchesScope,
      isRuntimeIdentityCurrent,
      renderedRuntimeIdentity,
      resolvePermission,
      setError,
    ],
  );

  const handleAskRespond = useCallback((messageId: string, result: unknown) => {
    if (!isRuntimeIdentityCurrent(renderedRuntimeIdentity, true)) return;
    resolveAsk(messageId, result);
  }, [
    isRuntimeIdentityCurrent,
    renderedRuntimeIdentity,
    resolveAsk,
  ]);

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
  const backdropMask = kollaborBackdropMask(appearance, maskAnchor);
  const surfaceShadow = kollaborSurfaceShadow(appearance.surfaceShadow);
  const pillBorderRadius = activeDockEdge === "left"
    ? `0 ${appearance.surfaceRadius}px ${appearance.surfaceRadius}px 0`
    : activeDockEdge === "right"
      ? `${appearance.surfaceRadius}px 0 0 ${appearance.surfaceRadius}px`
      : `${appearance.surfaceRadius}px`;
  if (!runtimeMayStart) return null;
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
        {expanded && appearance.backdropEnabled && (
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
              backdropFilter: `blur(${appearance.backdropBlur}px) saturate(115%) brightness(${Math.max(0.55, 1 - appearance.backdropDim / 100)})`,
              WebkitBackdropFilter: `blur(${appearance.backdropBlur}px) saturate(115%) brightness(${Math.max(0.55, 1 - appearance.backdropDim / 100)})`,
              backgroundColor: `rgba(0,0,0,${(appearance.backdropDim / 100).toFixed(2)})`,
              maskImage: backdropMask,
              WebkitMaskImage: backdropMask,
            }}
          />
        )}
      </AnimatePresence>
      <div
        ref={barRef}
        data-floating-kollabor-bar=""
        className="fixed pointer-events-none flex flex-col items-stretch gap-2"
        style={{
          ...fontVars,
          zIndex: FLOATING_SURFACE_Z.kollaborBar,
          ...containerPositionStyle,
          width: `min(${configuredBarWidth}px, calc(100vw - 2rem))`,
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
            border-left: 1px solid color-mix(in oklch, var(--foreground) 16%, transparent);
            padding-left: 0.75em;
            color: color-mix(in oklch, var(--foreground) 74%, transparent);
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
            className="no-scrollbar pointer-events-auto flex min-h-0 w-full flex-col-reverse gap-2 overflow-y-auto overflow-x-hidden border border-border/70 bg-background/90 p-2 backdrop-blur-md"
            ref={transcriptRef}
            style={{
              maxHeight: `calc(${appearance.transcriptMaxHeight}vh / ${effScale.toFixed(3)})`,
              borderRadius: `${appearance.surfaceRadius}px`,
              boxShadow: surfaceShadow,
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
            </div>

            {/* render bubbles newest-at-bottom; flex-col-reverse inverts while keeping natural scroll */}
            <div className="flex w-full flex-col gap-2">
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
                      onAskRespond={handleAskRespond}
                      canRespond={() => runtimeAllowedRef.current}
                      onModeChoose={handleModeChoice}
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
            canRespond={() => runtimeAllowedRef.current}
            onRespond={(r) => handleAskRespond(activeAskMessage.id, r)}
          />
        </motion.div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="transcript-controls"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-auto self-end flex items-center gap-2"
          >
            {sendingRef.current && (
              <button
                type="button"
                onClick={() => void handleStop()}
                aria-label="stop response"
                title="stop response"
                className="h-6 rounded-full border border-red-400/50 bg-red-500/10 px-2.5 text-[11px] text-red-400 hover:bg-red-500/20 transition-colors shadow-sm backdrop-blur"
              >
                stop
              </button>
            )}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => void resetEngineSession()}
                className="h-6 rounded-full border border-border/60 bg-background/80 px-2.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm backdrop-blur"
                title="clear transcript and reconnect"
              >
                clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="close"
              title="close (esc)"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted-foreground hover:text-foreground hover:bg-background transition-colors shadow-sm backdrop-blur"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* proactive per-screen hint (new users only) — tappable suggestion that
          pre-fills the input; never auto-sends a turn. Hidden while expanded,
          dragging, disconnected, or when the codex prompt is showing. */}
      <AnimatePresence initial={false}>
        {activeHint && !expanded && connected && !dragging && !codexAuthPromptOpen && (
          <motion.div
            key={`kollabor-hint-${activeHint.routeKey}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto flex items-center gap-1.5 self-center rounded-full border border-border/70 bg-background/95 py-1 pl-3 pr-1 shadow-lg backdrop-blur"
          >
            <button
              type="button"
              onClick={acceptHint}
              className="flex items-center gap-1.5 text-[11px] leading-none text-foreground/85 hover:text-foreground"
              title="ask Kollabor"
            >
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
              />
              <span className="truncate max-w-[230px]">{activeHint.prompt}</span>
            </button>
            <button
              type="button"
              onClick={dismissHint}
              aria-label="dismiss hint"
              title="dismiss"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            >
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* floating input pill — independent from bubbles */}
      <motion.div
        ref={pillRef}
        layout={!dragging}
        transition={{ type: "spring", stiffness: 320, damping: 34, mass: 0.9 }}
        className={cn(
          "group/pill pointer-events-auto relative flex items-center gap-1 border border-border/80 bg-background/95 backdrop-blur px-3 py-2",
          activeDockEdge === "left" && "rounded-l-none rounded-r-2xl",
          activeDockEdge === "right" && "rounded-r-none rounded-l-2xl",
          dragging && "select-none",
        )}
        style={{ borderRadius: pillBorderRadius, boxShadow: surfaceShadow }}
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
          onWheel={handleGripWheel}
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
            onClick={() => window.dispatchEvent(new CustomEvent("open-welcome-panel", { detail: { step: "provider" } }))}
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

/**
 * Parse the local /yolo slash command. Returns the requested action or null
 * when the text isn't a yolo command (so it's sent to the engine as normal).
 *   /yolo, /yolo on  -> "on"   /yolo off -> "off"   /yolo toggle -> "toggle"
 */
function parseYoloCommand(content: string): "on" | "off" | "toggle" | null {
  const text = content.trim().toLowerCase();
  if (text === "/yolo" || text === "/yolo on") return "on";
  if (text === "/yolo off") return "off";
  if (text === "/yolo toggle") return "toggle";
  return null;
}

function MessageBubble({
  message,
  trayAskMessageId,
  onPermissionRespond,
  onAskRespond,
  canRespond,
  onModeChoose,
}: {
  message: KollaborMessage;
  trayAskMessageId?: string | null;
  onPermissionRespond: (
    messageId: string,
    toolId: string,
    decision: "approve" | "approve_always" | "deny",
  ) => void;
  onAskRespond: (messageId: string, result: unknown) => void;
  canRespond: () => boolean;
  onModeChoose: (messageId: string, choice: "permission" | "yolo") => void;
}) {
  // first-run mode choice bubble (permission vs YOLO)
  if (message.modeChoice) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-start"
      >
        <KollaborModeChoicePrompt
          result={message.modeChoice.result}
          onChoose={(choice) => onModeChoose(message.id, choice)}
        />
      </motion.div>
    );
  }

  // system note (mode toggles, hints) — centered, muted
  if (message.role === "system") {
    if (!message.content) return null;
    return (
      <div className="px-2 py-1 text-center text-[11px] leading-snug text-muted-foreground/70">
        {message.content}
      </div>
    );
  }

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
          toolType={p.toolType}
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
          canRespond={canRespond}
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
      className={cn("flex w-full flex-col gap-1", isUser ? "items-end" : "items-start")}
    >
      {/* render committed tool chips first (if any) */}
      <ToolChipCluster tools={tools} />
      {/* then the text bubble (skip if no text, e.g. tool-only turns) */}
      {message.content && (
        <div
          className={cn(
            "text-sm leading-relaxed break-words",
            isUser
              ? "max-w-full rounded-[1.25rem] px-3 py-1.5 bg-muted/80 text-foreground whitespace-pre-wrap"
              : "mentiko-agent-markdown max-w-full px-0.5 text-foreground/90",
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
      className="flex w-full flex-col gap-1 items-start"
    >
      {!draft.text && draft.tools.length === 0 && (
        <div className="px-1 py-1.5">
          <AgentWaitSpinner />
        </div>
      )}
      <ToolChipCluster tools={visibleToolChips(draft.tools)} />
      {draft.text && (
        <div
          className="mentiko-agent-markdown max-w-full text-sm leading-relaxed break-words px-0.5 text-foreground/90"
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
    <div className="group/summary relative inline-flex">
      <div
        className="inline-flex h-5 items-center gap-1 rounded-full border border-border/35 bg-background/30 px-1.5 text-muted-foreground/65 backdrop-blur whitespace-nowrap cursor-default"
        aria-label={`${tools.length} tools ran: ${toolNames}`}
        style={{
          fontSize: "calc(var(--mentiko-agent-chip-font-size) * 0.92)",
          lineHeight: "1",
        }}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
        <span className="text-foreground/70">{tools.length} tools ran</span>
      </div>

      {/* hover card: what the summarized tools called */}
      <div
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 hidden min-w-[200px] max-w-[300px] flex-col gap-1 rounded-lg border border-border/60 bg-popover/95 p-2 text-[11px] shadow-lg backdrop-blur group-hover/summary:flex"
      >
        <div className="px-0.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
          {tools.length} tools ran
        </div>
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {tools.map((tool, index) => {
            const argsStr = formatToolArgs(tool.args);
            return (
              <div
                key={toolChipKey(tool, index)}
                className="flex items-center gap-1.5 rounded px-1 py-0.5"
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    tool.status === "error" ? "bg-red-400" : "bg-green-400",
                  )}
                />
                <span className="shrink-0 font-mono text-foreground/85">
                  {tool.name}
                </span>
                {argsStr && (
                  <span className="truncate font-mono text-muted-foreground/70">
                    {argsStr}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
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
