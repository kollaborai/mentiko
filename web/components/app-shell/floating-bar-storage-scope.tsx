"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { unwrapApiData } from "@/lib/api/api-client";
import { setKollaborEngineStorageScope } from "@/lib/ai-engine/kollabor-engine-client";
import { setMcpBarStorageScope } from "@/lib/ai-engine/mentiko-mcp-bar-client";
import { useUser } from "@/lib/ui-context/user-context";
import {
  BAR_SCOPE_ERROR,
  BAR_SHUTDOWN_ERROR,
  type KollaborBarAppearance,
  hydrateKollaborBarPreference,
  normalizeKollaborBarAppearance,
  normalizeKollaborBarWidth,
  readPendingShutdownMarker,
  setKollaborBarStorageScope,
  useKollaborBarStore,
} from "@/lib/ui/kollabor-bar-store";
import {
  markPendingShutdownOnLoad,
  stopFloatingBarRuntime,
} from "@/lib/ui/floating-bar-lifecycle";

const ANONYMOUS_STORAGE_SCOPE_KEY = "mentiko-anonymous-storage-scope-v1";
const BRIDGE_TYPE = "mentiko-floating-bar-preference";
const BRIDGE_SNAPSHOT_REQUEST = "snapshot_request";
const BRIDGE_SNAPSHOT = "snapshot";
const BRIDGE_PREFERENCE_REQUEST = "preference_request";
const BRIDGE_PREFERENCE_ACK = "preference_ack";
const BRIDGE_TIMEOUT_MS = 5_000;
// The current engine cancellation route is neither turn-scoped nor terminally
// authoritative, so repeating a shutdown request could cancel a newer turn.
const ENGINE_SUPPORTS_SAFE_SHUTDOWN_RETRY = false;

type BridgeMessage = {
  type: typeof BRIDGE_TYPE;
  action: string;
  scope: string;
  scopeEpoch?: string;
  requestId?: string;
  revision?: number;
  enabled?: boolean;
  barWidth?: number;
  appearance?: KollaborBarAppearance;
  preferenceStorageError?: string | null;
  shutdownError?: string | null;
  cleanupBlocked?: boolean;
};

interface FloatingBarStorageScopeValue {
  storageScopeReady: boolean;
  storageScope: string;
  scopeError: string | null;
  bridgeError: string | null;
  bridgePending: boolean;
  shutdownRetryable: boolean;
  shutdownSessionUnknown: boolean;
  shutdownCancellationUnverifiable: boolean;
  retryScope: () => void;
  retryBridge: () => void;
  retryShutdown: () => void;
  setEnabled: (next: boolean) => void;
  setBarWidth: (next: number) => void;
  setAppearance: (patch: Partial<KollaborBarAppearance>) => void;
}

const FloatingBarStorageScopeContext = createContext<FloatingBarStorageScopeValue | null>(null);

export function getAnonymousFloatingBarStorageScope(): string {
  if (typeof window === "undefined") return "anonymous";
  try {
    let scope = window.sessionStorage.getItem(ANONYMOUS_STORAGE_SCOPE_KEY);
    if (!scope) {
      scope = typeof window.crypto?.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(ANONYMOUS_STORAGE_SCOPE_KEY, scope);
    }
    return `anonymous:${scope}`;
  } catch {
    return "anonymous";
  }
}

function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<BridgeMessage>;
  return message.type === BRIDGE_TYPE && typeof message.action === "string" && typeof message.scope === "string";
}

function postBridgeMessage(target: Window, message: BridgeMessage): void {
  try {
    target.postMessage(message, window.location.origin);
  } catch {
    // A closing iframe is not a persistence failure in the owner.
  }
}

function isEmbeddedWindow(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `bar-${crypto.randomUUID()}`;
  }
  return `bar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function currentSnapshot(scope: string, revision: number, scopeEpoch: string): BridgeMessage {
  const state = useKollaborBarStore.getState();
  return {
    type: BRIDGE_TYPE,
    action: BRIDGE_SNAPSHOT,
    scope,
    scopeEpoch,
    revision,
    enabled: state.enabled,
    barWidth: state.barWidth,
    appearance: state.appearance,
    preferenceStorageError: state.preferenceStorageError,
    shutdownError: state.shutdownError,
    cleanupBlocked: state.cleanupBlocked,
  };
}

async function fetchStorageScope(signal: AbortSignal): Promise<string> {
  const res = await fetch("/api/system/storage-scope", {
    cache: "no-store",
    signal,
  });
  if (!res.ok) throw new Error(`storage scope lookup failed: ${res.status}`);
  const data = unwrapApiData<{ storageScope?: unknown }>(await res.json());
  if (typeof data.storageScope !== "string" || !data.storageScope.trim()) {
    throw new Error("storage scope response was malformed");
  }
  return data.storageScope.trim();
}

export function FloatingBarStorageScope({ children }: { children: ReactNode }) {
  const { user, loading: userLoading } = useUser();
  const store = useKollaborBarStore();
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgePending, setBridgePending] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [scopeRetry, setScopeRetry] = useState(0);
  const scopeRef = useRef(store.storageScope);
  const userIdRef = useRef(user?.id ?? null);
  const revisionRef = useRef(0);
  const ownerScopeEpochRef = useRef(makeRequestId());
  const panelScopeEpochRef = useRef<string | null>(null);
  const seenPanelScopeEpochsRef = useRef(new Set<string>());
  const panelWindowsRef = useRef<Set<Window>>(new Set());
  const pendingRequestRef = useRef<{
    id: string;
    enabled?: boolean;
    barWidth?: number;
    appearance?: KollaborBarAppearance;
  } | null>(null);
  const requestResultsRef = useRef<Map<string, BridgeMessage>>(new Map());
  const bridgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setEmbedded(isEmbeddedWindow());
  }, []);

  const broadcast = useCallback((message: BridgeMessage) => {
    for (const panelWindow of panelWindowsRef.current) {
      postBridgeMessage(panelWindow, message);
    }
  }, []);

  const applyOwnerPreference = useCallback((patch: {
    enabled?: boolean;
    barWidth?: number;
    appearance?: KollaborBarAppearance;
  }) => {
    const before = useKollaborBarStore.getState();
    const identity = {
      scope: before.storageScope,
      sessionId: before.sessionId,
      generation: before.generation,
    };
    if (patch.enabled !== undefined) before.setEnabled(patch.enabled);
    if (patch.barWidth !== undefined) before.setBarWidth(patch.barWidth);
    if (patch.appearance !== undefined) before.setAppearance(patch.appearance);
    revisionRef.current += 1;
    const revision = revisionRef.current;
    broadcast(currentSnapshot(before.storageScope, revision, ownerScopeEpochRef.current));

    if (patch.enabled === false) {
      void stopFloatingBarRuntime(identity).finally(() => {
        broadcast(currentSnapshot(before.storageScope, revision, ownerScopeEpochRef.current));
      });
    }
  }, [broadcast]);

  const sendPendingBridgeRequest = useCallback(() => {
    const pending = pendingRequestRef.current;
    if (!pending || !embedded || typeof window === "undefined") return;
    postBridgeMessage(window.parent, {
      type: BRIDGE_TYPE,
      action: BRIDGE_PREFERENCE_REQUEST,
      scope: scopeRef.current,
      scopeEpoch: panelScopeEpochRef.current ?? undefined,
      requestId: pending.id,
      revision: revisionRef.current,
      enabled: pending.enabled,
      barWidth: pending.barWidth,
      appearance: pending.appearance,
    });
  }, [embedded]);

  const setEnabled = useCallback((next: boolean) => {
    const state = useKollaborBarStore.getState();
    if (!state.storageScopeReady || !state.preferenceReadResolved || bridgePending) return;
    if (!embedded) {
      applyOwnerPreference({ enabled: next });
      return;
    }

    const requestId = pendingRequestRef.current?.id ?? makeRequestId();
    pendingRequestRef.current = { id: requestId, enabled: next };
    setBridgePending(true);
    setBridgeError(null);
    sendPendingBridgeRequest();
    if (bridgeTimerRef.current) clearTimeout(bridgeTimerRef.current);
    bridgeTimerRef.current = setTimeout(() => {
      if (pendingRequestRef.current?.id !== requestId) return;
      setBridgeError("Could not update the bar in this window");
      setBridgePending(false);
    }, BRIDGE_TIMEOUT_MS);
  }, [applyOwnerPreference, bridgePending, embedded, sendPendingBridgeRequest]);

  const setBarWidth = useCallback((width: number) => {
    const state = useKollaborBarStore.getState();
    if (!state.storageScopeReady || !state.preferenceReadResolved || bridgePending) return;
    const next = normalizeKollaborBarWidth(width, state.barWidth);
    if (!embedded) {
      applyOwnerPreference({ barWidth: next });
      return;
    }

    const requestId = pendingRequestRef.current?.id ?? makeRequestId();
    pendingRequestRef.current = { id: requestId, barWidth: next };
    setBridgePending(true);
    setBridgeError(null);
    sendPendingBridgeRequest();
    if (bridgeTimerRef.current) clearTimeout(bridgeTimerRef.current);
    bridgeTimerRef.current = setTimeout(() => {
      if (pendingRequestRef.current?.id !== requestId) return;
      setBridgeError("Could not update the bar in this window");
      setBridgePending(false);
    }, BRIDGE_TIMEOUT_MS);
  }, [applyOwnerPreference, bridgePending, embedded, sendPendingBridgeRequest]);

  const setAppearance = useCallback((patch: Partial<KollaborBarAppearance>) => {
    const state = useKollaborBarStore.getState();
    if (!state.storageScopeReady || !state.preferenceReadResolved || bridgePending) return;
    const next = normalizeKollaborBarAppearance({ ...state.appearance, ...patch });
    if (!embedded) {
      applyOwnerPreference({ appearance: next });
      return;
    }

    const requestId = pendingRequestRef.current?.id ?? makeRequestId();
    pendingRequestRef.current = { id: requestId, appearance: next };
    setBridgePending(true);
    setBridgeError(null);
    sendPendingBridgeRequest();
    if (bridgeTimerRef.current) clearTimeout(bridgeTimerRef.current);
    bridgeTimerRef.current = setTimeout(() => {
      if (pendingRequestRef.current?.id !== requestId) return;
      setBridgeError("Could not update the bar in this window");
      setBridgePending(false);
    }, BRIDGE_TIMEOUT_MS);
  }, [applyOwnerPreference, bridgePending, embedded, sendPendingBridgeRequest]);

  const retryBridge = useCallback(() => {
    if (!pendingRequestRef.current) return;
    setBridgeError(null);
    setBridgePending(true);
    sendPendingBridgeRequest();
    if (bridgeTimerRef.current) clearTimeout(bridgeTimerRef.current);
    bridgeTimerRef.current = setTimeout(() => {
      setBridgeError("Could not update the bar in this window");
      setBridgePending(false);
    }, BRIDGE_TIMEOUT_MS);
  }, [sendPendingBridgeRequest]);

  const retryShutdown = useCallback(() => {
    const state = useKollaborBarStore.getState();
    const marker = readPendingShutdownMarker(state.storageScope);
    if (
      !marker ||
      marker.sessionId === "unknown" ||
      !ENGINE_SUPPORTS_SAFE_SHUTDOWN_RETRY
    ) return;
    void stopFloatingBarRuntime(
      {
        scope: marker.scope,
        sessionId: marker.sessionId,
        generation: marker.generation,
      },
      { forceCancel: true },
    );
  }, []);

  useEffect(() => {
    const handleBridgeMessage = (event: MessageEvent) => {
      if (typeof window === "undefined" || event.origin !== window.location.origin) return;
      if (!isBridgeMessage(event.data)) return;
      const message = event.data;

      if (embedded) {
        if (event.source !== window.parent) return;
        const currentState = useKollaborBarStore.getState();
        if (!currentState.storageScopeReady || !currentState.preferenceReadResolved) return;
        if (message.scope !== scopeRef.current) return;
        if (
          message.action === BRIDGE_PREFERENCE_ACK &&
          (!message.requestId || pendingRequestRef.current?.id !== message.requestId)
        ) return;
        if (typeof message.scopeEpoch !== "string") return;
        if (
          seenPanelScopeEpochsRef.current.has(message.scopeEpoch) &&
          message.scopeEpoch !== panelScopeEpochRef.current
        ) return;
        if (typeof message.revision !== "number" || message.revision < revisionRef.current) return;
        if (message.action !== BRIDGE_SNAPSHOT && message.action !== BRIDGE_PREFERENCE_ACK) return;
        seenPanelScopeEpochsRef.current.add(message.scopeEpoch);
        panelScopeEpochRef.current = message.scopeEpoch;
        revisionRef.current = message.revision;
        if (
          typeof message.enabled === "boolean" ||
          typeof message.barWidth === "number" ||
          message.appearance !== undefined
        ) {
          useKollaborBarStore.setState({
            ...(typeof message.enabled === "boolean" ? { enabled: message.enabled } : {}),
            ...(typeof message.barWidth === "number"
              ? { barWidth: normalizeKollaborBarWidth(message.barWidth) }
              : {}),
            ...(message.appearance !== undefined
              ? { appearance: normalizeKollaborBarAppearance(message.appearance) }
              : {}),
            preferenceStorageError: message.preferenceStorageError ?? null,
            shutdownError: message.shutdownError ?? null,
            cleanupBlocked: message.cleanupBlocked === true,
          });
        }
        if (message.action === BRIDGE_PREFERENCE_ACK) {
          pendingRequestRef.current = null;
          if (bridgeTimerRef.current) clearTimeout(bridgeTimerRef.current);
          setBridgePending(false);
          setBridgeError(null);
        }
        return;
      }

      if (event.source === window || !event.source) return;
      const currentState = useKollaborBarStore.getState();
      if (!currentState.storageScopeReady || !currentState.preferenceReadResolved) return;
      const source = event.source as Window;
      if (message.action === BRIDGE_SNAPSHOT_REQUEST) {
        if (message.scope !== scopeRef.current) return;
        if (
          message.scopeEpoch !== undefined &&
          message.scopeEpoch !== ownerScopeEpochRef.current
        ) return;
        panelWindowsRef.current.add(source);
        postBridgeMessage(
          source,
          currentSnapshot(scopeRef.current, revisionRef.current, ownerScopeEpochRef.current),
        );
        return;
      }
      if (message.action !== BRIDGE_PREFERENCE_REQUEST) return;
      const hasEnabled = typeof message.enabled === "boolean";
      const hasBarWidth = typeof message.barWidth === "number";
      const hasAppearance = message.appearance !== undefined;
      if (
        message.scope !== scopeRef.current ||
        !panelWindowsRef.current.has(source) ||
        message.scopeEpoch !== ownerScopeEpochRef.current ||
        typeof message.requestId !== "string" ||
        (!hasEnabled && !hasBarWidth && !hasAppearance)
      ) return;
      const requestId = message.requestId;

      const acknowledgeCurrentSnapshot = () => {
        const ack: BridgeMessage = {
          ...currentSnapshot(
            scopeRef.current,
            revisionRef.current,
            ownerScopeEpochRef.current,
          ),
          action: BRIDGE_PREFERENCE_ACK,
          requestId,
        };
        requestResultsRef.current.set(requestId, ack);
        postBridgeMessage(source, ack);
      };

      // Revisions are compare-and-set tokens. A panel editing an older
      // snapshot must never overwrite a value already changed by the owner
      // (and a future revision cannot be authenticated as the current state).
      // Reply with the current snapshot under this request id so the panel can
      // converge immediately instead of waiting for its bridge timeout.
      if (message.revision !== revisionRef.current) {
        acknowledgeCurrentSnapshot();
        return;
      }

      const previous = requestResultsRef.current.get(message.requestId);
      if (previous) {
        acknowledgeCurrentSnapshot();
        return;
      }
      applyOwnerPreference({
        ...(hasEnabled ? { enabled: message.enabled } : {}),
        ...(hasBarWidth ? { barWidth: message.barWidth } : {}),
        ...(hasAppearance ? { appearance: message.appearance } : {}),
      });
      acknowledgeCurrentSnapshot();
    };

    window.addEventListener("message", handleBridgeMessage);
    return () => window.removeEventListener("message", handleBridgeMessage);
  }, [applyOwnerPreference, embedded]);

  useEffect(() => {
    if (!embedded || !store.storageScopeReady) return;
    postBridgeMessage(window.parent, {
      type: BRIDGE_TYPE,
      action: BRIDGE_SNAPSHOT_REQUEST,
      scope: scopeRef.current,
      scopeEpoch: panelScopeEpochRef.current ?? undefined,
      revision: revisionRef.current,
    });
  }, [embedded, store.storageScopeReady]);

  useEffect(() => {
    let cancelled = false;
    const stopOutgoingRuntime = (
      current = useKollaborBarStore.getState(),
      force = false,
    ) => {
      if (!force && !(current.sessionId || current.connected || current.connecting || current.drafting)) return;
      const outgoing = {
        scope: current.storageScope,
        sessionId: current.sessionId,
        generation: current.generation,
      };
      // Capture and fence the outgoing identity before auth loading can hide
      // it from this layout owner. A temporary unresolved identity must not
      // leave an engine turn running while the bar's local gate closes.
      void stopFloatingBarRuntime(outgoing).catch(() => {
        const latest = useKollaborBarStore.getState();
        if (
          latest.storageScope === outgoing.scope &&
          latest.sessionScope === outgoing.scope &&
          latest.sessionId === outgoing.sessionId
        ) {
          latest.setShutdownState({ pending: true, blocked: true, error: BAR_SHUTDOWN_ERROR });
        }
      });
    };

    if (userLoading) {
      stopOutgoingRuntime(useKollaborBarStore.getState(), true);
      useKollaborBarStore.setState({ storageScopeReady: false, preferenceReadResolved: false });
      return () => { cancelled = true; };
    }

    const userIdentityChanged = userIdRef.current !== (user?.id ?? null);
    useKollaborBarStore.setState({ storageScopeReady: false });
    setScopeError(null);

    const hydrate = async () => {
      const current = useKollaborBarStore.getState();
      // Do not make incoming preference hydration wait on engine/token
      // requests. Cleanup remains tied to this captured outgoing identity.
      stopOutgoingRuntime(current, userIdentityChanged);
      if (cancelled) return;

      let scope: string;
      try {
        const installScope = user?.id ? await fetchStorageScopeWithTimeout() : null;
        if (user?.id && !installScope) throw new Error("storage scope unavailable");
        scope = user?.id ? `${installScope}:user:${user.id}` : getAnonymousFloatingBarStorageScope();
      } catch {
        if (cancelled) return;
        useKollaborBarStore.setState({
          storageScopeReady: false,
          preferenceReadResolved: false,
          enabled: false,
          messages: [],
          sessionId: null,
          sessionScope: null,
          connected: false,
          connecting: false,
        });
        setScopeError(BAR_SCOPE_ERROR);
        return;
      }

      if (cancelled) return;
      if (scopeRef.current !== scope) {
        scopeRef.current = scope;
        revisionRef.current = 0;
        panelScopeEpochRef.current = null;
        ownerScopeEpochRef.current = makeRequestId();
        panelWindowsRef.current.clear();
        pendingRequestRef.current = null;
        requestResultsRef.current.clear();
        if (bridgeTimerRef.current) clearTimeout(bridgeTimerRef.current);
        bridgeTimerRef.current = null;
        setBridgePending(false);
        setBridgeError(null);
      }
      setKollaborBarStorageScope(scope);
      setKollaborEngineStorageScope(scope);
      setMcpBarStorageScope(scope);
      const preference = hydrateKollaborBarPreference();
      const marker = readPendingShutdownMarker(scope);
      markPendingShutdownOnLoad(marker);
      useKollaborBarStore.setState({ storageScopeReady: true });
      userIdRef.current = user?.id ?? null;
      if (preference.error) setScopeError(null);
    };

    void hydrate();
    return () => { cancelled = true; };
  // The retry counter is intentionally part of this identity hydration effect.
  }, [user?.id, userLoading, scopeRetry]);

  const retryScope = useCallback(() => setScopeRetry((value) => value + 1), []);
  const shutdownMarker = store.storageScopeReady && store.cleanupBlocked
    ? readPendingShutdownMarker(store.storageScope)
    : null;
  const shutdownSessionUnknown = Boolean(
    shutdownMarker && shutdownMarker.sessionId === "unknown",
  );
  const shutdownCancellationUnverifiable = Boolean(
    shutdownMarker && shutdownMarker.sessionId !== "unknown",
  );
  const shutdownRetryable = Boolean(
    ENGINE_SUPPORTS_SAFE_SHUTDOWN_RETRY &&
    shutdownMarker &&
    shutdownMarker.sessionId !== "unknown",
  );
  const value = useMemo<FloatingBarStorageScopeValue>(() => ({
    storageScopeReady: store.storageScopeReady,
    storageScope: store.storageScope,
    scopeError,
    bridgeError: bridgeError || store.preferenceStorageError || store.shutdownError,
    bridgePending,
    shutdownRetryable,
    shutdownSessionUnknown,
    shutdownCancellationUnverifiable,
    retryScope,
    retryBridge,
    retryShutdown,
    setEnabled,
    setBarWidth,
    setAppearance,
  }), [bridgeError, bridgePending, retryBridge, retryScope, retryShutdown, scopeError, setAppearance, setBarWidth, setEnabled, shutdownCancellationUnverifiable, shutdownRetryable, shutdownSessionUnknown, store.preferenceStorageError, store.shutdownError, store.storageScope, store.storageScopeReady]);

  return (
    <FloatingBarStorageScopeContext.Provider value={value}>
      {children}
    </FloatingBarStorageScopeContext.Provider>
  );
}

async function fetchStorageScopeWithTimeout(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("storage scope timeout")), 10_000);
  try {
    return await fetchStorageScope(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

export function useFloatingBarStorageScope(): FloatingBarStorageScopeValue {
  const context = useContext(FloatingBarStorageScopeContext);
  return context ?? {
    storageScopeReady: false,
    storageScope: "anonymous",
    scopeError: null,
    bridgeError: null,
    bridgePending: false,
    shutdownRetryable: false,
    shutdownSessionUnknown: false,
    shutdownCancellationUnverifiable: false,
    retryScope: () => {},
    retryBridge: () => {},
    retryShutdown: () => {},
    setEnabled: () => {},
    setBarWidth: () => {},
    setAppearance: () => {},
  };
}

export { BRIDGE_TYPE, BRIDGE_SNAPSHOT_REQUEST, BRIDGE_SNAPSHOT, BRIDGE_PREFERENCE_REQUEST, BRIDGE_PREFERENCE_ACK };
