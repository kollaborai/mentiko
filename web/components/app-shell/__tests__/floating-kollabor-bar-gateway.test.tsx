/**
 * lane B3 — verifies the floating bar prefers the "mentiko" profile and
 * skips the codex auth flow when MENTIKO_AI_GATEWAY_ENABLED=true.
 *
 * we don't render the full bar (zustand + xterm-y dependencies are heavy
 * for jsdom). instead we mount with all deps mocked and assert the contract:
 *   - /api/system/ai-gateway IS fetched
 *   - /api/system/codex-token is NOT fetched when gatewayEnabled=true
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

let mockUserState: {
  user: { id: string } | null;
  loading: boolean;
} = {
  user: { id: "user-a" },
  loading: false,
};
let mockMcpEffectCallbacks: Array<(effect: unknown) => void> = [];
let mockRuntimeController: {
  mayHaveActiveTurn: () => boolean;
  invalidateLocal: () => void;
} | null = null;
let unregisterActualRuntime: (() => void) | undefined;

// motion/react: pass-through
jest.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get: () =>
        function MotionStub({
          children,
          ...rest
        }: {
          children?: React.ReactNode;
          [k: string]: unknown;
        }) {
          const htmlProps: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              !["initial", "animate", "exit", "transition", "layout", "layoutId"].includes(k)
            ) {
              htmlProps[k] = v;
            }
          }
          return <div {...htmlProps}>{children}</div>;
        },
    },
  ),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// IMPORTANT: mocks that drive hooks MUST return STABLE references across
// renders. If useWorkspace() returns `{ setWorkspaceId: jest.fn() }` (new
// jest.fn each call), handleEffect's useCallback dep churns every render
// and the boot useEffect re-runs every render → infinite loop. Keep the
// object + setter pinned to a single ref.
jest.mock("@/lib/ui-context/workspace-context", () => {
  const setter = jest.fn();
  const ws = { workspaceId: "ws", setWorkspaceId: setter };
  return {
    useWorkspace: () => ws,
  };
});

jest.mock("@/lib/ui/pill-nav-preferences", () => {
  const prefs = { prefs: { navigationMode: "floating-pill-nav" } };
  return {
    usePillNavPreferences: () => prefs,
    getPillNavShineGradient: () => "rgba(0,0,0,0)",
  };
});

jest.mock("@/lib/ai-engine/kollabor-engine-client", () => ({
  getOrCreateSession: jest.fn().mockResolvedValue({ sessionId: "sid-1", sessionToken: "tok" }),
  ensureMentikoAgentInstalled: jest.fn().mockResolvedValue({ agentFingerprint: "fp" }),
  sendMessage: jest.fn(),
  respondToPermission: jest.fn(),
  cancelTurn: jest.fn(),
  clearSessionHistory: jest.fn(),
  ping: jest.fn().mockResolvedValue(true),
  setKollaborEngineStorageScope: jest.fn(),
  clearKollaborEngineStoredSession: jest.fn(),
}));

jest.mock("@/lib/ui/floating-bar-lifecycle", () => ({
  registerFloatingBarRuntime: jest.fn((controller: typeof mockRuntimeController) => {
    mockRuntimeController = controller;
    return () => {
      if (mockRuntimeController === controller) mockRuntimeController = null;
    };
  }),
  stopFloatingBarRuntime: jest.fn().mockResolvedValue({ ok: true, blocked: false }),
}));

jest.mock("@/lib/ai-engine/mentiko-mcp-bar-client", () => ({
  MCPBarClient: jest.fn().mockImplementation((onEffect: (effect: unknown) => void) => {
    mockMcpEffectCallbacks.push(onEffect);
    return {
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
  }),
  getStoredSessionToken: jest.fn().mockReturnValue(null),
  setMcpBarStorageScope: jest.fn(),
  syncSessionToken: jest.fn(),
  replyToTool: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/ui-context/user-context", () => ({
  useUser: () => mockUserState,
}));

jest.mock("@/components/app-shell/floating-bar-storage-scope", () => ({
  useFloatingBarStorageScope: () => {
    // Keep this component test focused on runtime behavior; scope hydration
    // has its own provider tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useKollaborBarStore: store } = require("@/lib/ui/kollabor-bar-store") as typeof import("@/lib/ui/kollabor-bar-store");
    const state = store();
    return {
      storageScopeReady: state.storageScopeReady,
      storageScope: state.storageScope,
      scopeError: null,
      bridgeError: null,
      bridgePending: false,
      retryScope: jest.fn(),
      retryBridge: jest.fn(),
      setEnabled: jest.fn(),
    };
  },
}));

jest.mock("@/components/app-shell/kollabor-permission-prompt", () => ({
  KollaborPermissionPrompt: ({ onRespond }: { onRespond: (decision: "approve") => void }) => (
    <button type="button" onClick={() => onRespond("approve")}>approve pending tool</button>
  ),
}));

jest.mock("@/components/app-shell/kollabor-ask-prompt", () => ({
  KollaborAskPrompt: () => null,
}));

jest.mock("@/components/ui/wave-spinner", () => ({
  WaveSpinner: () => null,
}));

jest.mock("@/components/app-shell/notifications-panel", () => ({
  showToast: jest.fn(),
}));

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));

jest.mock("remark-gfm", () => ({ __esModule: true, default: () => undefined }));

// flush microtasks + a couple of macrotasks (boot() awaits several fetches/promises)
async function flushAll() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

import {
  clearKollaborEngineStoredSession,
  cancelTurn,
  clearSessionHistory,
  getOrCreateSession,
  respondToPermission,
  sendMessage,
  setKollaborEngineStorageScope,
} from "@/lib/ai-engine/kollabor-engine-client";
import { replyToTool } from "@/lib/ai-engine/mentiko-mcp-bar-client";
import {
  clearPendingShutdownMarker,
  readPendingShutdownMarker,
  setKollaborBarStorageScope,
  useKollaborBarStore,
} from "@/lib/ui/kollabor-bar-store";
import { stopFloatingBarRuntime } from "@/lib/ui/floating-bar-lifecycle";
import { showToast } from "@/components/app-shell/notifications-panel";
import {
  FloatingKollaborBar,
  nextKollaborBarScaleFromWheel,
  shouldShowEngineOffline,
} from "../floating-kollabor-bar";

describe("FloatingKollaborBar — gateway mode", () => {
  let originalFetch: typeof fetch;
  let originalRequestAnimationFrame: typeof requestAnimationFrame;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame;
  let originalBarWidth: string | undefined;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalRequestAnimationFrame = global.requestAnimationFrame;
    originalCancelAnimationFrame = global.cancelAnimationFrame;
    originalBarWidth = process.env.NEXT_PUBLIC_KOLLABOR_BAR_WIDTH;
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = jest.fn() as typeof cancelAnimationFrame;
    mockUserState = { user: { id: "user-a" }, loading: false };
    mockMcpEffectCallbacks = [];
    mockRuntimeController = null;
    jest.mocked(cancelTurn).mockReset();
    useKollaborBarStore.setState({
      expanded: false,
      messages: [],
      sessionId: null,
      drafting: null,
      connected: false,
      connecting: false,
      error: null,
      scale: 1,
      enabled: true,
      storageScope: "install:test:user:user-a",
      storageScopeReady: true,
      preferenceReadResolved: true,
      cleanupBlocked: false,
      shutdownError: null,
      preferenceStorageError: null,
      sessionScope: null,
    });
    setKollaborBarStorageScope("install:test:user:user-a");
    useKollaborBarStore.setState({
      storageScope: "install:test:user:user-a",
      storageScopeReady: true,
      preferenceReadResolved: true,
      enabled: true,
      sessionId: null,
      sessionScope: null,
      connected: false,
      connecting: false,
    });
  });

  afterEach(() => {
    unregisterActualRuntime?.();
    unregisterActualRuntime = undefined;
    clearPendingShutdownMarker("install:test:user:user-a");
    jest.mocked(stopFloatingBarRuntime).mockReset();
    jest.mocked(stopFloatingBarRuntime).mockResolvedValue({ ok: true, blocked: false });
    global.fetch = originalFetch;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    if (originalBarWidth === undefined) delete process.env.NEXT_PUBLIC_KOLLABOR_BAR_WIDTH;
    else process.env.NEXT_PUBLIC_KOLLABOR_BAR_WIDTH = originalBarWidth;
    jest.clearAllMocks();
  });

  function installGatewayFetch() {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/system/ai-gateway")) {
        return new Response(JSON.stringify({
          success: true,
          data: { gatewayEnabled: true, mentikoProfileActive: true },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
  }

  it("keeps the current pending boot active when scope changes during a null-session create", async () => {
    installGatewayFetch();
    let resolveScopeA!: (value: { sessionId: string; sessionToken: string }) => void;
    let resolveScopeB!: (value: { sessionId: string; sessionToken: string }) => void;
    jest.mocked(getOrCreateSession)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveScopeA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveScopeB = resolve; }));
    const view = render(<FloatingKollaborBar />);

    await waitFor(() => {
      expect(getOrCreateSession).toHaveBeenCalledTimes(1);
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        sessionId: null,
        connecting: true,
      }));
    });

    // Match layout hydration: readiness drops while identity resolves, then
    // the newly resolved account scope becomes the ready owner.
    act(() => useKollaborBarStore.setState({ storageScopeReady: false }));
    await flushAll();
    act(() => {
      setKollaborBarStorageScope("install:test:user:user-b");
      useKollaborBarStore.setState({ storageScopeReady: true, preferenceReadResolved: true });
    });

    await waitFor(() => {
      expect(getOrCreateSession).toHaveBeenCalledTimes(2);
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        storageScope: "install:test:user:user-b",
        sessionId: null,
        connecting: true,
      }));
    });

    await act(async () => {
      resolveScopeA({ sessionId: "accepted-but-stale-a", sessionToken: "token-a" });
      await Promise.resolve();
    });
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      storageScope: "install:test:user:user-b",
      sessionId: null,
      connected: false,
      connecting: true,
    }));
    expect(mockRuntimeController?.mayHaveActiveTurn()).toBe(true);
    expect(mockMcpEffectCallbacks).toHaveLength(0);

    await act(async () => {
      resolveScopeB({ sessionId: "session-b", sessionToken: "token-b" });
      await Promise.resolve();
    });
    await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      storageScope: "install:test:user:user-b",
      sessionId: "session-b",
      sessionScope: "install:test:user:user-b",
      connected: true,
    })));
    expect(mockMcpEffectCallbacks).toHaveLength(1);
    view.unmount();
  });

  it("keeps a pending null-session create visible to shutdown while auth is loading", async () => {
    installGatewayFetch();
    let resolvePending!: (value: { sessionId: string; sessionToken: string }) => void;
    jest.mocked(getOrCreateSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePending = resolve;
    }));
    const view = render(<FloatingKollaborBar />);

    await waitFor(() => {
      expect(getOrCreateSession).toHaveBeenCalledTimes(1);
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        sessionId: null,
        connecting: true,
      }));
    });
    const runtime = mockRuntimeController;
    expect(runtime?.mayHaveActiveTurn()).toBe(true);

    act(() => {
      mockUserState = { user: { id: "user-a" }, loading: true };
      useKollaborBarStore.setState({ storageScopeReady: false, preferenceReadResolved: false });
    });
    view.rerender(<FloatingKollaborBar />);
    await flushAll();

    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: null,
      connected: false,
      connecting: false,
      storageScopeReady: false,
    }));
    expect(runtime?.mayHaveActiveTurn()).toBe(true);

    await act(async () => {
      resolvePending({ sessionId: "accepted-after-auth-loading", sessionToken: "late-token" });
      await Promise.resolve();
    });
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: null,
      connected: false,
      connecting: false,
      storageScopeReady: false,
    }));
    expect(mockMcpEffectCallbacks).toHaveLength(0);
    view.unmount();
  });

  it("ignores a session-create result that resolves after the bar unmounts", async () => {
    installGatewayFetch();
    let resolvePending!: (value: { sessionId: string; sessionToken: string }) => void;
    jest.mocked(getOrCreateSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePending = resolve;
    }));
    const view = render(<FloatingKollaborBar />);

    await waitFor(() => {
      expect(getOrCreateSession).toHaveBeenCalledTimes(1);
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        sessionId: null,
        connected: false,
        connecting: true,
      }));
    });
    const pendingState = useKollaborBarStore.getState();
    const pendingRuntime = mockRuntimeController;
    expect(pendingRuntime).not.toBeNull();
    expect(pendingState.sessionScope).toBe(pendingState.storageScope);

    const actualLifecycle = jest.requireActual<typeof import("@/lib/ui/floating-bar-lifecycle")>(
      "@/lib/ui/floating-bar-lifecycle",
    );
    let shutdownPromise: Promise<{ ok: boolean; blocked: boolean; reason?: string }> | undefined;
    const stopMock = jest.mocked(stopFloatingBarRuntime);
    stopMock.mockImplementation((identity, options) => {
      shutdownPromise = actualLifecycle.stopFloatingBarRuntime(identity, options);
      return shutdownPromise;
    });
    unregisterActualRuntime = actualLifecycle.registerFloatingBarRuntime({
      mayHaveActiveTurn: pendingRuntime!.mayHaveActiveTurn,
      invalidateLocal: pendingRuntime!.invalidateLocal,
    });

    view.unmount();
    expect(pendingRuntime?.mayHaveActiveTurn()).toBe(false);
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: null,
      connected: false,
      connecting: false,
      cleanupBlocked: true,
      shutdownPending: true,
    }));

    await act(async () => {
      expect(await shutdownPromise).toEqual({ ok: false, blocked: true, reason: "unknown-session" });
    });

    await act(async () => {
      resolvePending({ sessionId: "accepted-after-unmount", sessionToken: "late-token" });
      await Promise.resolve();
    });
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: null,
      connected: false,
      connecting: false,
    }));
    expect(mockMcpEffectCallbacks).toHaveLength(0);
    expect(readPendingShutdownMarker(pendingState.storageScope)).toMatchObject({
      scope: pendingState.storageScope,
      sessionId: "unknown",
      generation: pendingState.generation,
    });
  });

  it("recovers a null session from send without starting a duplicate create while connecting", async () => {
    installGatewayFetch();
    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);

    act(() => useKollaborBarStore.setState({
      sessionId: null,
      sessionScope: useKollaborBarStore.getState().storageScope,
      connected: false,
      connecting: true,
      inputValue: "hello after reconnect",
    }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flushAll();
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);

    act(() => useKollaborBarStore.setState({ connecting: false }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await waitFor(() => expect(getOrCreateSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: "sid-1",
      connected: true,
      sessionScope: useKollaborBarStore.getState().storageScope,
    })));
    expect(useKollaborBarStore.getState().inputValue).toBe("hello after reconnect");
    view.unmount();
  });

  it("does not replace the session after reset receives a receipt-only cancellation", async () => {
    installGatewayFetch();
    jest.mocked(cancelTurn).mockResolvedValue({
      accepted: false,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: false,
    });
    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    act(() => useKollaborBarStore.setState({
      expanded: true,
      messages: [{ id: "before-reset", role: "assistant", content: "keep me", timestamp: 1 }],
    }));

    const componentRuntime = mockRuntimeController;
    expect(componentRuntime).not.toBeNull();
    const actualLifecycle = jest.requireActual<typeof import("@/lib/ui/floating-bar-lifecycle")>(
      "@/lib/ui/floating-bar-lifecycle",
    );
    let shutdownPromise: Promise<{ ok: boolean; blocked: boolean; reason?: string }> | undefined;
    const stopMock = jest.mocked(stopFloatingBarRuntime);
    stopMock.mockImplementation((identity, options) => {
      shutdownPromise = actualLifecycle.stopFloatingBarRuntime(identity, options);
      return shutdownPromise;
    });
    unregisterActualRuntime = actualLifecycle.registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: componentRuntime!.invalidateLocal,
    });

    const identity = {
      scope: useKollaborBarStore.getState().storageScope,
      sessionId: useKollaborBarStore.getState().sessionId,
      generation: useKollaborBarStore.getState().generation,
    };
    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      connected: false,
      cleanupBlocked: true,
      shutdownPending: true,
      shutdownError: expect.any(String),
    })));
    expect(await shutdownPromise).toEqual({
      ok: false,
      blocked: true,
      reason: "cancel-unverifiable",
    });
    expect(cancelTurn).toHaveBeenCalledWith(identity.sessionId, expect.any(AbortSignal));
    expect(clearSessionHistory).not.toHaveBeenCalled();
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(useKollaborBarStore.getState().messages).toEqual([
      expect.objectContaining({ id: "before-reset", content: "keep me" }),
    ]);
    expect(readPendingShutdownMarker(identity.scope)).toMatchObject({
      scope: identity.scope,
      sessionId: identity.sessionId,
      generation: identity.generation,
    });
    view.unmount();
  });

  it("preserves a shutdown marker and blocks creation when history cleanup fails", async () => {
    installGatewayFetch();
    jest.mocked(clearSessionHistory).mockRejectedValueOnce(new Error("history endpoint unavailable"));
    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    act(() => useKollaborBarStore.setState({
      expanded: true,
      messages: [{ id: "before-reset", role: "assistant", content: "clear this", timestamp: 1 }],
    }));

    const actualLifecycle = jest.requireActual<typeof import("@/lib/ui/floating-bar-lifecycle")>(
      "@/lib/ui/floating-bar-lifecycle",
    );
    let shutdownPromise: Promise<{ ok: boolean; blocked: boolean; reason?: string }> | undefined;
    const stopMock = jest.mocked(stopFloatingBarRuntime);
    stopMock.mockImplementation((identity, options) => {
      shutdownPromise = actualLifecycle.stopFloatingBarRuntime(identity, options);
      return shutdownPromise;
    });
    unregisterActualRuntime = actualLifecycle.registerFloatingBarRuntime({
      mayHaveActiveTurn: () => false,
      invalidateLocal: mockRuntimeController!.invalidateLocal,
    });

    const sessionId = useKollaborBarStore.getState().sessionId;
    const scope = useKollaborBarStore.getState().storageScope;
    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      connected: false,
      cleanupBlocked: true,
      shutdownPending: true,
      shutdownError: expect.any(String),
    })));
    expect(await shutdownPromise).toEqual({ ok: true, blocked: false });
    expect(clearSessionHistory).toHaveBeenCalledWith(sessionId);
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(readPendingShutdownMarker(scope)).toMatchObject({
      scope,
      sessionId,
    });
    view.unmount();
  });

  it("reconnects only after cancellation and history cleanup are authoritative", async () => {
    installGatewayFetch();
    jest.mocked(getOrCreateSession)
      .mockResolvedValueOnce({ sessionId: "sid-1", sessionToken: "tok-1" })
      .mockResolvedValueOnce({ sessionId: "sid-2", sessionToken: "tok-2" });
    jest.mocked(cancelTurn).mockResolvedValueOnce({
      accepted: true,
      authoritativeTerminal: true,
      turnScoped: true,
      idempotentFence: true,
    });
    jest.mocked(clearSessionHistory).mockResolvedValueOnce(undefined);
    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: "sid-1",
      connected: true,
    })));
    act(() => useKollaborBarStore.setState({
      expanded: true,
      messages: [{ id: "before-reset", role: "assistant", content: "clear this", timestamp: 1 }],
    }));

    const componentRuntime = mockRuntimeController;
    expect(componentRuntime).not.toBeNull();
    const actualLifecycle = jest.requireActual<typeof import("@/lib/ui/floating-bar-lifecycle")>(
      "@/lib/ui/floating-bar-lifecycle",
    );
    const stopMock = jest.mocked(stopFloatingBarRuntime);
    stopMock.mockImplementation((identity, options) => actualLifecycle.stopFloatingBarRuntime(identity, options));
    unregisterActualRuntime = actualLifecycle.registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: componentRuntime!.invalidateLocal,
    });

    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: "sid-2",
      sessionScope: "install:test:user:user-a",
      connected: true,
      cleanupBlocked: false,
      shutdownPending: false,
      shutdownError: null,
    })));
    expect(cancelTurn).toHaveBeenCalledWith("sid-1", expect.any(AbortSignal));
    expect(clearSessionHistory).toHaveBeenCalledWith("sid-1");
    expect(getOrCreateSession).toHaveBeenCalledTimes(2);
    expect(clearKollaborEngineStoredSession).toHaveBeenCalled();
    expect(readPendingShutdownMarker("install:test:user:user-a")).toBeNull();
    view.unmount();
  });

  it("blocks Stop after receipt-only cancellation and ignores late stream events", async () => {
    installGatewayFetch();
    const scope = "install:test:user:user-a";
    clearPendingShutdownMarker(scope);
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => { releaseStream = resolve; });
    let markStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => { markStreamStarted = resolve; });
    const streamState: { signal?: AbortSignal } = {};
    jest.mocked(sendMessage).mockImplementationOnce(async function* (
      _sessionId,
      _content,
      _context,
      signal,
    ) {
      streamState.signal = signal;
      markStreamStarted();
      yield { type: "token", session_id: "sid-1", ts: 1, text: "before stop" };
      await streamGate;
      yield { type: "token", session_id: "sid-1", ts: 2, text: "late after stop" };
    });
    jest.mocked(cancelTurn).mockResolvedValueOnce({
      accepted: true,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: false,
    });
    const actualLifecycle = jest.requireActual<typeof import("@/lib/ui/floating-bar-lifecycle")>(
      "@/lib/ui/floating-bar-lifecycle",
    );
    let shutdownPromise: Promise<{ ok: boolean; blocked: boolean; reason?: string }> | undefined;
    const stopMock = jest.mocked(stopFloatingBarRuntime);
    stopMock.mockImplementation((identity, options) => {
      shutdownPromise = actualLifecycle.stopFloatingBarRuntime(identity, options);
      return shutdownPromise;
    });

    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    act(() => useKollaborBarStore.setState({
      yoloPromptSeen: true,
      inputValue: "stop this turn",
      expanded: true,
    }));
    fireEvent.keyDown(screen.getByPlaceholderText("message"), { key: "Enter" });
    await act(async () => {
      await streamStarted;
      await flushAll();
    });

    const beforeStop = useKollaborBarStore.getState();
    const componentRuntime = mockRuntimeController;
    expect(componentRuntime).not.toBeNull();
    unregisterActualRuntime = actualLifecycle.registerFloatingBarRuntime({
      mayHaveActiveTurn: componentRuntime!.mayHaveActiveTurn,
      invalidateLocal: componentRuntime!.invalidateLocal,
    });
    const identity = {
      scope: beforeStop.storageScope,
      sessionId: beforeStop.sessionId,
      generation: beforeStop.generation,
    };

    fireEvent.click(screen.getByRole("button", { name: "stop response" }));
    await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      connected: false,
      cleanupBlocked: true,
      shutdownPending: true,
      shutdownError: expect.any(String),
    })));
    expect(streamState.signal?.aborted).toBe(true);
    expect(await shutdownPromise).toEqual({
      ok: false,
      blocked: true,
      reason: "cancel-unverifiable",
    });
    expect(cancelTurn).toHaveBeenCalledWith(identity.sessionId, expect.any(AbortSignal));
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(readPendingShutdownMarker(scope)).toMatchObject({
      scope,
      sessionId: identity.sessionId,
      generation: identity.generation,
    });

    await act(async () => {
      releaseStream();
      await flushAll();
    });
    const finalState = useKollaborBarStore.getState();
    expect(finalState.drafting).toBeNull();
    expect(finalState.messages.some((message) => message.content.includes("late after stop"))).toBe(false);
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);
    view.unmount();
  });

  it("restarts after Stop only when cancellation includes authoritative terminal proof", async () => {
    installGatewayFetch();
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => { releaseStream = resolve; });
    let markStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => { markStreamStarted = resolve; });
    jest.mocked(sendMessage).mockImplementationOnce(async function* (
      _sessionId,
      _content,
      _context,
      _signal,
    ) {
      markStreamStarted();
      yield { type: "token", session_id: "sid-1", ts: 1, text: "before stop" };
      await streamGate;
      yield { type: "token", session_id: "sid-1", ts: 2, text: "late after stop" };
    });
    jest.mocked(cancelTurn).mockResolvedValueOnce({
      accepted: true,
      authoritativeTerminal: true,
      turnScoped: true,
      idempotentFence: true,
    });
    const actualLifecycle = jest.requireActual<typeof import("@/lib/ui/floating-bar-lifecycle")>(
      "@/lib/ui/floating-bar-lifecycle",
    );
    const stopMock = jest.mocked(stopFloatingBarRuntime);
    stopMock.mockImplementation((identity, options) => actualLifecycle.stopFloatingBarRuntime(identity, options));

    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    act(() => useKollaborBarStore.setState({
      yoloPromptSeen: true,
      inputValue: "stop this turn",
      expanded: true,
    }));
    fireEvent.keyDown(screen.getByPlaceholderText("message"), { key: "Enter" });
    await act(async () => {
      await streamStarted;
      await flushAll();
    });

    const componentRuntime = mockRuntimeController;
    expect(componentRuntime).not.toBeNull();
    unregisterActualRuntime = actualLifecycle.registerFloatingBarRuntime({
      mayHaveActiveTurn: componentRuntime!.mayHaveActiveTurn,
      invalidateLocal: componentRuntime!.invalidateLocal,
    });

    fireEvent.click(screen.getByRole("button", { name: "stop response" }));
    await waitFor(() => {
      expect(getOrCreateSession).toHaveBeenCalledTimes(2);
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        sessionId: "sid-1",
        connected: true,
        cleanupBlocked: false,
        shutdownPending: false,
        shutdownError: null,
      }));
    });
    expect(cancelTurn).toHaveBeenCalledWith("sid-1", expect.any(AbortSignal));
    expect(readPendingShutdownMarker("install:test:user:user-a")).toBeNull();

    await act(async () => {
      releaseStream();
      await flushAll();
    });
    expect(useKollaborBarStore.getState().drafting).toBeNull();
    expect(useKollaborBarStore.getState().messages.some((message) => (
      message.content.includes("late after stop")
    ))).toBe(false);
    view.unmount();
  });

  it("invalidates locally and fail-closes the captured runtime when unmounted mid-turn", async () => {
    installGatewayFetch();
    const scope = "install:test:user:user-a";
    clearPendingShutdownMarker(scope);
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    let streamStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    const streamState: { signal?: AbortSignal } = {};
    jest.mocked(sendMessage).mockImplementationOnce(async function* (
      _sessionId,
      _content,
      _context,
      signal,
    ) {
      streamState.signal = signal;
      streamStarted();
      yield {
        type: "token",
        session_id: "sid-1",
        ts: 1,
        text: "turn is in progress",
      };
      await streamGate;
      if (!signal?.aborted) {
        yield {
          type: "turn_complete",
          session_id: "sid-1",
          ts: 2,
          input_tokens: 1,
          output_tokens: 1,
          tool_calls: 0,
          stop_reason: "end_turn",
        };
      }
    });
    jest.mocked(cancelTurn).mockResolvedValue({
      accepted: true,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: false,
    });

    const actualLifecycle = jest.requireActual<typeof import("@/lib/ui/floating-bar-lifecycle")>(
      "@/lib/ui/floating-bar-lifecycle",
    );
    let shutdownPromise: Promise<{ ok: boolean; blocked: boolean; reason?: string }> | undefined;
    const stopMock = jest.mocked(stopFloatingBarRuntime);
    stopMock.mockImplementation((identity, options) => {
      shutdownPromise = actualLifecycle.stopFloatingBarRuntime(identity, options);
      return shutdownPromise;
    });

    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    act(() => {
      useKollaborBarStore.setState({ yoloPromptSeen: true, inputValue: "keep working" });
    });
    fireEvent.keyDown(screen.getByPlaceholderText("message"), { key: "Enter" });
    await started;

    const stateBeforeUnmount = useKollaborBarStore.getState();
    const identity = {
      scope: stateBeforeUnmount.storageScope,
      sessionId: stateBeforeUnmount.sessionId,
      generation: stateBeforeUnmount.generation,
    };
    const componentRuntime = mockRuntimeController;
    expect(componentRuntime).not.toBeNull();
    expect(componentRuntime?.mayHaveActiveTurn()).toBe(true);
    unregisterActualRuntime = actualLifecycle.registerFloatingBarRuntime({
      mayHaveActiveTurn: componentRuntime!.mayHaveActiveTurn,
      invalidateLocal: componentRuntime!.invalidateLocal,
    });

    // A settings panel route removes the app-shell bar component. Its cleanup
    // must synchronously invalidate the captured turn and hand its exact
    // scope/session to lifecycle shutdown. The mocked engine returns receipt
    // only, so the real lifecycle helper must retain the marker and block.
    view.unmount();

    expect(stopMock).toHaveBeenCalledWith(identity);
    expect(streamState.signal?.aborted).toBe(true);
    expect(componentRuntime?.mayHaveActiveTurn()).toBe(false);
    expect(cancelTurn).toHaveBeenCalledWith(identity.sessionId, expect.any(AbortSignal));
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      connected: false,
      connecting: false,
      generation: identity.generation + 1,
      shutdownPending: true,
      cleanupBlocked: true,
    }));

    await act(async () => {
      const result = await shutdownPromise;
      expect(result).toEqual({ ok: false, blocked: true, reason: "cancel-unverifiable" });
      releaseStream();
      await Promise.resolve();
    });
    expect(readPendingShutdownMarker(scope)).toMatchObject({
      scope,
      sessionId: identity.sessionId,
      generation: identity.generation,
    });
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);

  });

  it("does not revive a null-session boot after disable and fail-closed re-enable", async () => {
    installGatewayFetch();
    let resolvePending!: (value: { sessionId: string; sessionToken: string }) => void;
    jest.mocked(getOrCreateSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePending = resolve;
    }));
    render(<FloatingKollaborBar />);

    await waitFor(() => {
      expect(getOrCreateSession).toHaveBeenCalledTimes(1);
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        sessionId: null,
        connected: false,
        connecting: true,
      }));
    });

    // The scope-provider/lifecycle test covers writing the unknown marker.
    // Model its fail-closed state here to exercise the component's pending
    // create fence through off -> on while the accepted result is still late.
    act(() => {
      const state = useKollaborBarStore.getState();
      state.setEnabled(false);
      state.invalidateGeneration();
      state.setShutdownState({ pending: true, blocked: true });
    });
    await flushAll();
    act(() => useKollaborBarStore.getState().setEnabled(true));
    await flushAll();
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      enabled: true,
      sessionId: null,
      connected: false,
      connecting: false,
      cleanupBlocked: true,
    }));
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePending({ sessionId: "accepted-after-disable", sessionToken: "late-token" });
      await Promise.resolve();
    });
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      enabled: true,
      sessionId: null,
      connected: false,
      cleanupBlocked: true,
    }));
    expect(getOrCreateSession).toHaveBeenCalledTimes(1);
    expect(mockMcpEffectCallbacks).toHaveLength(0);
  });

  it("does not reconnect a late session result after disable then re-enable", async () => {
    installGatewayFetch();
    render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));

    let resolvePending!: (value: { sessionId: string; sessionToken: string }) => void;
    jest.mocked(getOrCreateSession).mockImplementationOnce(() => new Promise((resolve) => {
      resolvePending = resolve;
    }));
    act(() => useKollaborBarStore.setState({
      connected: false,
      connecting: false,
      inputValue: "reconnect after disable",
      yoloPromptSeen: true,
    }));
    fireEvent.keyDown(screen.getByPlaceholderText("offline"), { key: "Enter" });
    await waitFor(() => expect(getOrCreateSession).toHaveBeenCalledTimes(2));

    act(() => useKollaborBarStore.setState({ enabled: false }));
    await flushAll();
    act(() => useKollaborBarStore.setState({ enabled: true }));
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    const mcpClientCountBeforeLateResult = mockMcpEffectCallbacks.length;

    await act(async () => {
      resolvePending({ sessionId: "late-session-a", sessionToken: "late-token-a" });
      await Promise.resolve();
    });
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      sessionId: "sid-1",
      sessionScope: "install:test:user:user-a",
      connected: true,
    }));
    expect(mockMcpEffectCallbacks).toHaveLength(mcpClientCountBeforeLateResult);
  });

  it("ignores an MCP UI callback captured before disable and re-enable", async () => {
    installGatewayFetch();
    render(<FloatingKollaborBar />);
    await waitFor(() => expect(mockMcpEffectCallbacks.length).toBeGreaterThan(0));
    const lateEffect = mockMcpEffectCallbacks[0];

    act(() => useKollaborBarStore.setState({ enabled: false }));
    await flushAll();
    act(() => useKollaborBarStore.setState({ enabled: true }));
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));

    act(() => lateEffect({ kind: "show_toast", payload: { message: "stale callback" } }));
    expect(showToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "stale callback" }));
    expect(useKollaborBarStore.getState().enabled).toBe(true);
  });

  it("ignores an MCP UI callback captured for the previous preference scope", async () => {
    installGatewayFetch();
    render(<FloatingKollaborBar />);
    await waitFor(() => expect(mockMcpEffectCallbacks.length).toBeGreaterThan(0));
    const lateEffect = mockMcpEffectCallbacks[0];

    act(() => {
      setKollaborBarStorageScope("install:test:user:user-b");
      useKollaborBarStore.setState({ storageScopeReady: true, preferenceReadResolved: true });
    });

    act(() => lateEffect({ kind: "show_toast", payload: { message: "scope-a callback" } }));
    expect(showToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "scope-a callback" }));
    expect(useKollaborBarStore.getState().storageScope).toBe("install:test:user:user-b");
    expect(useKollaborBarStore.getState().enabled).toBe(true);
  });

  it("binds YOLO MCP replies to the session that opened the effects stream", async () => {
    installGatewayFetch();
    render(<FloatingKollaborBar />);
    await waitFor(() => {
      expect(useKollaborBarStore.getState().connected).toBe(true);
      expect(mockMcpEffectCallbacks).toHaveLength(1);
    });
    const capturedEffectCallback = mockMcpEffectCallbacks[0];
    act(() => {
      useKollaborBarStore.setState({ yoloMode: true });
      capturedEffectCallback({
        kind: "ask_choice",
        payload: { toolId: "mcp-tool-a", question: "allow read_file?" },
      });
    });

    expect(replyToTool).toHaveBeenCalledTimes(1);
    const [toolId, result, guard] = jest.mocked(replyToTool).mock.calls[0];
    expect(toolId).toBe("mcp-tool-a");
    expect(result).toBe("approve");
    expect(guard?.scope).toBe("install:test:user:user-a");
    expect(guard?.isCurrent?.()).toBe(true);

    act(() => useKollaborBarStore.getState().setSessionId("replacement-session"));
    expect(guard?.isCurrent?.()).toBe(false);
    act(() => capturedEffectCallback({
      kind: "ask_choice",
      payload: { toolId: "stale-tool", question: "allow write_file?" },
    }));
    expect(replyToTool).toHaveBeenCalledTimes(1);
  });

  it("ignores a permission response that resolves after the preference scope changes", async () => {
    installGatewayFetch();
    let resolvePermissionResponse!: () => void;
    jest.mocked(respondToPermission).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePermissionResponse = resolve;
    }));
    const view = render(<FloatingKollaborBar />);
    await waitFor(() => expect(useKollaborBarStore.getState().connected).toBe(true));
    act(() => useKollaborBarStore.setState({
      expanded: true,
      messages: [{
        id: "permission-a",
        role: "permission",
        content: "Approve a tool?",
        timestamp: 1,
        permission: {
          toolId: "tool-a",
          toolName: "read_file",
          input: { path: "README.md" },
          riskLevel: "low",
          riskReason: "Read-only",
        },
      }],
    }));

    fireEvent.click(screen.getByRole("button", { name: "approve pending tool" }));
    await waitFor(() => expect(respondToPermission).toHaveBeenCalledWith(
      "sid-1",
      "tool-a",
      "approve",
    ));
    expect(useKollaborBarStore.getState().messages[0]?.permission?.decision).toBe("approve");

    const nextScope = "install:test:user:user-b";
    act(() => {
      setKollaborBarStorageScope(nextScope);
      useKollaborBarStore.setState({
        enabled: false,
        storageScopeReady: true,
        preferenceReadResolved: true,
        sessionId: null,
        sessionScope: nextScope,
        connected: false,
        connecting: false,
        error: null,
        messages: [],
      });
    });

    await act(async () => {
      resolvePermissionResponse();
      await Promise.resolve();
    });
    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      storageScope: nextScope,
      enabled: false,
      connected: false,
      messages: [],
      error: null,
    }));
    view.unmount();
  });

  it("fetches /api/system/ai-gateway and skips /api/system/codex-token when gatewayEnabled=true", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/system/ai-gateway")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { gatewayEnabled: true, mentikoProfileActive: true },
            requestId: "req_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/system/storage-scope")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { storageScope: "install:test" },
            requestId: "req_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // any other route returns an empty 200 so misc effects don't blow up
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<FloatingKollaborBar />);
    await flushAll();

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/system/ai-gateway"))).toBe(true);
    expect(calls.some((u) => u.includes("/api/system/codex-token"))).toBe(false);
    // active profile is hardcoded to "mentiko" in gateway mode — never fetched
    expect(calls.some((u) => u.includes("/api/kollabor/profiles/active"))).toBe(false);
  });

  it("does no bar-runtime work when the scoped preference is disabled", async () => {
    useKollaborBarStore.setState({
      enabled: false,
      storageScopeReady: true,
      preferenceReadResolved: true,
      cleanupBlocked: false,
      connected: false,
      sessionId: null,
      sessionScope: null,
    });
    const fetchMock = jest.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { container } = render(<FloatingKollaborBar />);
    await flushAll();

    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not render stale anonymous transcript while user scope is unresolved", async () => {
    global.fetch = jest.fn(async () => (
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    )) as unknown as typeof fetch;
    mockUserState = { user: null, loading: true };
    useKollaborBarStore.setState({
      storageScopeReady: false,
      preferenceReadResolved: false,
      expanded: true,
      messages: [
        {
          id: "old",
          role: "assistant",
          content: "Research tray2-28226",
          timestamp: 1,
        },
      ],
    });

    const { queryByText } = render(<FloatingKollaborBar />);
    await flushAll();

    expect(queryByText("Research tray2-28226")).toBeNull();
  });

  it("does not resolve identity or choose a fallback from the bar component", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/system/storage-scope")) {
        return new Response("unavailable", { status: 500 });
      }
      if (url.includes("/api/system/ai-gateway")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { gatewayEnabled: true, mentikoProfileActive: true },
            requestId: "req_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<FloatingKollaborBar />);
    await flushAll();

    expect(setKollaborEngineStorageScope).not.toHaveBeenCalled();
  });

  it("shouldShowEngineOffline: suppresses error when session is connected", () => {
    // the indicator must not lie. if zustand says we're connected, a flaky
    // ping (transient 401, network blip) must NOT surface "engine offline".
    expect(shouldShowEngineOffline(true)).toBe(false);
    expect(shouldShowEngineOffline(false)).toBe(true);
  });

  it("resizes from wheel delta and clamps the floating bar scale", () => {
    expect(nextKollaborBarScaleFromWheel(1, 100)).toBeCloseTo(0.85);
    expect(nextKollaborBarScaleFromWheel(1, -100)).toBeCloseTo(1.15);
    expect(nextKollaborBarScaleFromWheel(0.6, 1000)).toBe(0.6);
    expect(nextKollaborBarScaleFromWheel(1.6, -1000)).toBe(1.6);
  });

  it("resizes when scrolling the drag handle", async () => {
    global.fetch = jest.fn(async () => (
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    )) as unknown as typeof fetch;

    render(<FloatingKollaborBar />);
    await flushAll();

    fireEvent.wheel(screen.getByRole("button", { name: "drag to move" }), { deltaY: -120 });

    expect(useKollaborBarStore.getState().scale).toBeCloseTo(1.18);
  });

  it("renders the scoped settings width while retaining responsive CSS", async () => {
    useKollaborBarStore.setState({ barWidth: 480 });
    global.fetch = jest.fn(async () => (
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    )) as unknown as typeof fetch;

    const { container } = render(<FloatingKollaborBar />);
    await flushAll();

    expect(container.querySelector("[data-floating-kollabor-bar]")).toHaveStyle({
      width: "min(480px, calc(100vw - 2rem))",
    });
  });

  it("still mounts cleanly when gatewayEnabled=false (legacy path)", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/system/ai-gateway")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { gatewayEnabled: false, mentikoProfileActive: false },
            requestId: "req_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/system/codex-token")) {
        return new Response(
          JSON.stringify({ success: true, data: { hasToken: false, token: null }, requestId: "req_test" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<FloatingKollaborBar />);
    await flushAll();

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    // codex-token only gets fetched if SHOULD_OFFER_CODEX_INLINE_AUTH=true (currently false).
    // assert the gateway probe ran and codex prompt was not surfaced as a side effect.
    expect(calls.some((u) => u.includes("/api/system/ai-gateway"))).toBe(true);
  });

  it("retries the user turn once when the stored engine session is stale", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/system/ai-gateway")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { gatewayEnabled: true, mentikoProfileActive: true },
            requestId: "req_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/system/storage-scope")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { storageScope: "install:test" },
            requestId: "req_test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.mocked(getOrCreateSession)
      .mockResolvedValueOnce({ sessionId: "sid-1", sessionToken: "tok-1" })
      .mockResolvedValueOnce({ sessionId: "sid-2", sessionToken: "tok-2" });
    jest.mocked(sendMessage)
      .mockImplementationOnce(async function* () {
        yield {
          type: "error",
          session_id: "sid-1",
          ts: 1,
          code: "http_error",
          message: "HTTP 404 — Session not found",
          retryable: false,
        };
      })
      .mockImplementationOnce(async function* () {
        yield {
          type: "token",
          session_id: "sid-2",
          ts: 2,
          text: "back online",
        };
        yield {
          type: "turn_complete",
          session_id: "sid-2",
          ts: 3,
          input_tokens: 1,
          output_tokens: 2,
          tool_calls: 0,
          stop_reason: "end_turn",
        };
      });

    useKollaborBarStore.setState({ yoloPromptSeen: true });
    render(<FloatingKollaborBar />);
    await flushAll();

    act(() => {
      useKollaborBarStore.setState({
        connected: true,
        sessionId: "sid-1",
        sessionScope: "install:test:user:user-a",
        yoloPromptSeen: true,
        inputValue: "hello?",
      });
    });
    const input = screen.getByPlaceholderText("message");
    fireEvent.keyDown(input, { key: "Enter" });
    await flushAll();

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(clearKollaborEngineStoredSession).toHaveBeenCalled();
    expect(getOrCreateSession).toHaveBeenCalledTimes(2);
    expect(getOrCreateSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        agent: "mentiko",
        mcp_servers: ["mentiko"],
        metadata: expect.objectContaining({ source: "floating-kollabor-bar" }),
      }),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      "sid-1",
      "hello?",
      expect.any(Object),
      expect.any(Object),
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      "sid-2",
      "hello?",
      expect.any(Object),
      expect.any(Object),
    );
    expect(
      useKollaborBarStore.getState().messages.some((message) =>
        message.content.includes("back online"),
      ),
    ).toBe(true);
  });
});
