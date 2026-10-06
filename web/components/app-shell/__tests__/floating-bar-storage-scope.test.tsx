import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  BRIDGE_PREFERENCE_ACK,
  BRIDGE_PREFERENCE_REQUEST,
  BRIDGE_SNAPSHOT,
  BRIDGE_SNAPSHOT_REQUEST,
  FloatingBarStorageScope,
  useFloatingBarStorageScope,
} from "../floating-bar-storage-scope";
import { getAnonymousFloatingBarStorageScope } from "../floating-bar-storage-scope";
import { useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";
import {
  BAR_SHUTDOWN_ERROR,
  KOLLABOR_BAR_APPEARANCE_DEFAULTS,
  LS_APPEARANCE_KEY,
  clearPendingShutdownMarker,
  readPendingShutdownMarker,
  setKollaborBarStorageScope,
  writePendingShutdownMarker,
} from "@/lib/ui/kollabor-bar-store";
import { clearTokenCache, setKollaborEngineStorageScope } from "@/lib/ai-engine/kollabor-engine-client";
import { registerFloatingBarRuntime } from "@/lib/ui/floating-bar-lifecycle";
import { getFloatingBarAvailability } from "@/lib/ui/floating-bar-availability";

let mockUser: { id: string } | null = null;
let mockUserLoading = false;

jest.mock("@/lib/ui-context/user-context", () => ({
  useUser: () => ({ user: mockUser, loading: mockUserLoading }),
}));

function Harness() {
  const state = useFloatingBarStorageScope();
  return (
    <div>
      <button type="button" onClick={() => state.setEnabled(!useKollaborBarStore.getState().enabled)}>toggle</button>
      <button type="button" onClick={state.retryScope}>retry-scope</button>
      <button type="button" onClick={state.retryShutdown}>retry-shutdown</button>
      <div data-testid="ready">{String(state.storageScopeReady)}</div>
      <div data-testid="scope">{state.storageScope}</div>
      <div data-testid="bridge-pending">{String(state.bridgePending)}</div>
      <div data-testid="shutdown-retryable">{String(state.shutdownRetryable)}</div>
      <div data-testid="shutdown-session-unknown">{String(state.shutdownSessionUnknown)}</div>
      <div data-testid="shutdown-cancel-unverifiable">{String(state.shutdownCancellationUnverifiable)}</div>
      <div data-testid="error">{state.scopeError || state.bridgeError || ""}</div>
      <div data-testid="enabled">{String(useKollaborBarStore((value) => value.enabled))}</div>
    </div>
  );
}

async function flushMicrotasksForScopeTest() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function postedBridgeMessage(target: Window, action: string): { scopeEpoch?: string } | undefined {
  return (target.postMessage as jest.Mock).mock.calls
    .map(([message]) => message as { action?: string; scopeEpoch?: string })
    .find((message) => message?.action === action);
}

async function deliverParentSnapshot(scope: string, scopeEpoch: string, revision = 0) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      source: window.parent,
      data: {
        type: "mentiko-floating-bar-preference",
        action: BRIDGE_SNAPSHOT,
        scope,
        scopeEpoch,
        revision,
        enabled: true,
        barWidth: 373,
        appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS },
      },
    }));
  });
}

describe("layout-owned floating bar scope and panel bridge", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockUser = null;
    mockUserLoading = false;
    useKollaborBarStore.setState({
      storageScopeReady: false,
      preferenceReadResolved: false,
      enabled: true,
      storageScope: "anonymous",
      sessionId: null,
      sessionScope: null,
      cleanupBlocked: false,
      shutdownError: null,
      preferenceStorageError: null,
      barWidth: 373,
      appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS },
    });
    (global.fetch as jest.Mock) = jest.fn();
    setKollaborBarStorageScope("anonymous");
    setKollaborEngineStorageScope("anonymous");
    clearTokenCache();
  });

  it("hydrates anonymous scope before consumers can toggle and persists once in the owner", async () => {
    const anonymousScope = getAnonymousFloatingBarStorageScope();
    render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );

    await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
    expect(screen.getByTestId("scope")).toHaveTextContent(anonymousScope);

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(localStorage.getItem(`mentiko-kollabor-enabled:${anonymousScope}`)).toBe("0");
    expect(screen.getByTestId("enabled")).toHaveTextContent("false");
  });

  it.each([
    ["top-level document", false],
    ["panel iframe", true],
  ])("hydrates the same authenticated preference scope in a %s", async (_surface, embedded) => {
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { storageScope: "install:test" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const selfDescriptor = Object.getOwnPropertyDescriptor(window, "self");
    const postMessage = jest.spyOn(window, "postMessage").mockImplementation(() => {});
    let view: ReturnType<typeof render> | undefined;

    try {
      Object.defineProperty(window, "self", { configurable: true, value: embedded ? {} as Window : window });
      view = render(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );

      await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
      expect(screen.getByTestId("scope")).toHaveTextContent("install:test:user:user-a");
      expect(useKollaborBarStore.getState().preferenceReadResolved).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith("/api/system/storage-scope", expect.any(Object));

      if (embedded) {
        await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "mentiko-floating-bar-preference",
            action: BRIDGE_SNAPSHOT_REQUEST,
            scope: "install:test:user:user-a",
          }),
          window.location.origin,
        ));
      } else {
        expect(postMessage).not.toHaveBeenCalled();
      }
    } finally {
      view?.unmount();
      postMessage.mockRestore();
      if (selfDescriptor) Object.defineProperty(window, "self", selfDescriptor);
      else Reflect.deleteProperty(window, "self");
    }
  });

  it("keeps authenticated scope unresolved on lookup failure and retries without an anonymous fallback", async () => {
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response("no", { status: 500 }));
    render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );

    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("Could not load your bar settings"));
    expect(screen.getByTestId("ready")).toHaveTextContent("false");
    expect(screen.getByTestId("scope")).not.toHaveTextContent("user:user-a");
    expect(localStorage.getItem("mentiko-kollabor-enabled:anonymous")).toBeNull();
  });

  it("captures and shuts down the outgoing runtime when auth enters loading", async () => {
    const outgoingScope = "install:test:user:user-a";
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { storageScope: "install:test" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const view = render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    let unregister: (() => void) | undefined;
    try {
      await waitFor(() => {
        expect(screen.getByTestId("ready")).toHaveTextContent("true");
        expect(screen.getByTestId("scope")).toHaveTextContent(outgoingScope);
      });

      act(() => useKollaborBarStore.setState({
        storageScope: outgoingScope,
        storageScopeReady: true,
        preferenceReadResolved: true,
        sessionId: "session-user-a",
        sessionScope: outgoingScope,
        connected: true,
        connecting: false,
        generation: 10,
      }));

      const mayHaveActiveTurn = jest.fn(() => true);
      const invalidateLocal = jest.fn(() => {
        useKollaborBarStore.getState().invalidateGeneration();
      });
      unregister = registerFloatingBarRuntime({ mayHaveActiveTurn, invalidateLocal });

      const fetchMock = jest.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/kollabor/token") {
          return Promise.resolve(new Response(JSON.stringify({
            token: "outgoing-token",
            baseUrl: "http://engine.test",
          }), { status: 200, headers: { "content-type": "application/json" } }));
        }
        if (url === "http://engine.test/sessions/session-user-a/cancel") {
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            session_id: "session-user-a",
          }), { status: 200, headers: { "content-type": "application/json" } }));
        }
        return Promise.resolve(new Response("not found", { status: 404 }));
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockUserLoading = true;
      view.rerender(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );

      await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("false"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        "http://engine.test/sessions/session-user-a/cancel",
        expect.objectContaining({ method: "POST" }),
      ));

      expect(mayHaveActiveTurn).toHaveBeenCalledWith({
        scope: outgoingScope,
        sessionId: "session-user-a",
        generation: 10,
      });
      expect(invalidateLocal).toHaveBeenCalledTimes(1);
      expect(readPendingShutdownMarker(outgoingScope)).toMatchObject({
        scope: outgoingScope,
        sessionId: "session-user-a",
        generation: 10,
      });
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        storageScope: outgoingScope,
        storageScopeReady: false,
        cleanupBlocked: true,
        shutdownPending: true,
      }));
    } finally {
      mockUserLoading = false;
      view.unmount();
      unregister?.();
      clearPendingShutdownMarker(outgoingScope);
    }
  });

  it("fail-closes an unresolved null-session boot when auth enters loading after UI flags clear", async () => {
    const outgoingScope = "install:test:user:user-a";
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { storageScope: "install:test" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const view = render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    let unregister: (() => void) | undefined;
    try {
      await waitFor(() => {
        expect(screen.getByTestId("ready")).toHaveTextContent("true");
        expect(screen.getByTestId("scope")).toHaveTextContent(outgoingScope);
      });

      act(() => useKollaborBarStore.setState({
        storageScope: outgoingScope,
        storageScopeReady: true,
        preferenceReadResolved: true,
        sessionId: null,
        sessionScope: outgoingScope,
        connected: false,
        connecting: false,
        drafting: null,
        generation: 21,
      }));

      const mayHaveActiveTurn = jest.fn(() => true);
      const invalidateLocal = jest.fn(() => {
        useKollaborBarStore.getState().invalidateGeneration();
      });
      unregister = registerFloatingBarRuntime({ mayHaveActiveTurn, invalidateLocal });
      const beforeLoadingFetch = global.fetch;

      mockUserLoading = true;
      view.rerender(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );

      await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("false"));
      expect(mayHaveActiveTurn).toHaveBeenCalledWith({
        scope: outgoingScope,
        sessionId: null,
        generation: 21,
      });
      expect(invalidateLocal).toHaveBeenCalledTimes(1);
      expect(readPendingShutdownMarker(outgoingScope)).toMatchObject({
        scope: outgoingScope,
        sessionId: "unknown",
        generation: 21,
      });
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        storageScope: outgoingScope,
        sessionScope: outgoingScope,
        sessionId: null,
        storageScopeReady: false,
        cleanupBlocked: true,
        shutdownPending: true,
      }));
      expect(beforeLoadingFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/sessions/"),
        expect.anything(),
      );
    } finally {
      mockUserLoading = false;
      view.unmount();
      unregister?.();
      clearPendingShutdownMarker(outgoingScope);
    }
  });

  it("fails closed for a pending null-session boot when the authenticated owner changes", async () => {
    const outgoingScope = "install:test:user:user-a";
    const incomingScope = "install:test:user:user-b";
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { storageScope: "install:test" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const view = render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    let unregister: (() => void) | undefined;
    try {
      await waitFor(() => {
        expect(screen.getByTestId("ready")).toHaveTextContent("true");
        expect(screen.getByTestId("scope")).toHaveTextContent(outgoingScope);
      });

      act(() => useKollaborBarStore.setState({
        storageScope: outgoingScope,
        storageScopeReady: true,
        preferenceReadResolved: true,
        sessionId: null,
        sessionScope: outgoingScope,
        connected: false,
        connecting: false,
        drafting: null,
        generation: 22,
      }));
      const mayHaveActiveTurn = jest.fn(() => true);
      const invalidateLocal = jest.fn(() => {
        useKollaborBarStore.getState().invalidateGeneration();
      });
      unregister = registerFloatingBarRuntime({ mayHaveActiveTurn, invalidateLocal });

      mockUser = { id: "user-b" };
      view.rerender(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("ready")).toHaveTextContent("true");
        expect(screen.getByTestId("scope")).toHaveTextContent(incomingScope);
      });
      expect(mayHaveActiveTurn).toHaveBeenCalledWith({
        scope: outgoingScope,
        sessionId: null,
        generation: 22,
      });
      expect(invalidateLocal).toHaveBeenCalledTimes(1);
      expect(readPendingShutdownMarker(outgoingScope)).toMatchObject({
        scope: outgoingScope,
        sessionId: "unknown",
        generation: 22,
      });
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        storageScope: incomingScope,
        storageScopeReady: true,
        sessionId: null,
      }));
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/sessions/"),
        expect.anything(),
      );
    } finally {
      view.unmount();
      unregister?.();
      clearPendingShutdownMarker(outgoingScope);
    }
  });

  it("hydrates the incoming scope and does not dispatch stale cancellation after token lookup", async () => {
    mockUser = { id: "user-a" };
    setKollaborBarStorageScope("outgoing:scope");
    setKollaborEngineStorageScope("outgoing:scope");
    useKollaborBarStore.setState({
      storageScope: "outgoing:scope",
      storageScopeReady: true,
      preferenceReadResolved: true,
      enabled: true,
      sessionId: "session-outgoing",
      sessionScope: "outgoing:scope",
      connected: true,
      generation: 10,
    });

    let resolveToken!: (response: Response) => void;
    const pendingToken = new Promise<Response>((resolve) => { resolveToken = resolve; });
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/system/storage-scope") {
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: { storageScope: "install:test" },
        }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (url === "/api/kollabor/token") return pendingToken;
      if (url === "http://engine.test/sessions/session-outgoing/cancel") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const unregister = registerFloatingBarRuntime({
      mayHaveActiveTurn: () => true,
      invalidateLocal: () => useKollaborBarStore.getState().invalidateGeneration(),
    });
    try {
      render(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );

      await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
      expect(screen.getByTestId("scope")).toHaveTextContent("install:test:user:user-a");
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        storageScopeReady: true,
        preferenceReadResolved: true,
        cleanupBlocked: false,
      }));
      expect(fetchMock).toHaveBeenCalledWith("/api/system/storage-scope", expect.any(Object));
      expect(fetchMock).toHaveBeenCalledWith("/api/kollabor/token", expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(readPendingShutdownMarker("outgoing:scope")).toMatchObject({ sessionId: "session-outgoing" });
      expect(fetchMock).not.toHaveBeenCalledWith(
        "http://engine.test/sessions/session-outgoing/cancel",
        expect.any(Object),
      );

      await act(async () => {
        resolveToken(new Response(JSON.stringify({ token: "outgoing-token", baseUrl: "http://engine.test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
        await Promise.resolve();
      });
      await flushMicrotasksForScopeTest();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "http://engine.test/sessions/session-outgoing/cancel",
        expect.anything(),
      );
      await waitFor(() => expect(useKollaborBarStore.getState().storageScope).toBe("install:test:user:user-a"));
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        cleanupBlocked: false,
        shutdownError: null,
      }));
      expect(readPendingShutdownMarker("outgoing:scope")).toMatchObject({ sessionId: "session-outgoing" });
    } finally {
      unregister();
      clearTokenCache();
      setKollaborEngineStorageScope("anonymous");
    }
  });

  it("invalidates a pending null-session boot and records its unknown shutdown before scope change", async () => {
    const outgoingScope = "install:test:user:user-a";
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { storageScope: "install:test" },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    let view: ReturnType<typeof render> | undefined;
    let unregister: (() => void) | undefined;
    try {
      view = render(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("ready")).toHaveTextContent("true");
        expect(screen.getByTestId("scope")).toHaveTextContent(outgoingScope);
      });

      const mayHaveActiveTurn = jest.fn(() => true);
      const invalidateLocal = jest.fn(() => {
        useKollaborBarStore.getState().invalidateGeneration();
      });
      unregister = registerFloatingBarRuntime({ mayHaveActiveTurn, invalidateLocal });
      act(() => useKollaborBarStore.setState({
        sessionId: null,
        sessionScope: outgoingScope,
        connected: false,
        connecting: true,
        cleanupBlocked: false,
        shutdownPending: false,
        shutdownError: null,
      }));

      mockUser = { id: "user-b" };
      view.rerender(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("ready")).toHaveTextContent("true");
        expect(screen.getByTestId("scope")).toHaveTextContent("install:test:user:user-b");
      });

      expect(mayHaveActiveTurn).toHaveBeenCalledWith(expect.objectContaining({
        scope: outgoingScope,
        sessionId: null,
      }));
      expect(invalidateLocal).toHaveBeenCalledTimes(1);
      expect(readPendingShutdownMarker(outgoingScope)).toEqual(expect.objectContaining({
        scope: outgoingScope,
        sessionId: "unknown",
      }));
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        storageScope: "install:test:user:user-b",
        storageScopeReady: true,
        cleanupBlocked: false,
        sessionId: null,
      }));
      expect((global.fetch as jest.Mock).mock.calls.some(([input]) =>
        String(input).includes("/cancel"),
      )).toBe(false);
    } finally {
      view?.unmount();
      unregister?.();
      clearPendingShutdownMarker(outgoingScope);
    }
  });

  it("keeps an unknown-session shutdown blocked after re-enable and retry during a pending boot", async () => {
    const originalDeploymentFlag = process.env.NEXT_PUBLIC_KOLLABOR_BAR;
    process.env.NEXT_PUBLIC_KOLLABOR_BAR = "1";
    let unregister: (() => void) | undefined;
    try {
      render(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );
      await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));

      const scope = useKollaborBarStore.getState().storageScope;
      const mayHaveActiveTurn = jest.fn(() => true);
      const invalidateLocal = jest.fn(() => {
        useKollaborBarStore.getState().invalidateGeneration();
      });
      unregister = registerFloatingBarRuntime({ mayHaveActiveTurn, invalidateLocal });
      act(() => useKollaborBarStore.setState({
        sessionId: null,
        sessionScope: scope,
        connected: false,
        connecting: true,
        cleanupBlocked: false,
        shutdownPending: false,
        shutdownError: null,
      }));
      expect(getFloatingBarAvailability().runtimeMayStart).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "toggle" }));
      await waitFor(() => expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        enabled: false,
        sessionId: null,
        cleanupBlocked: true,
        shutdownPending: true,
      })));
      const marker = readPendingShutdownMarker(scope);
      expect(marker).toEqual(expect.objectContaining({ scope, sessionId: "unknown" }));
      expect(screen.getByTestId("shutdown-retryable")).toHaveTextContent("false");
      expect(screen.getByTestId("shutdown-session-unknown")).toHaveTextContent("true");
      expect(mayHaveActiveTurn).toHaveBeenCalled();
      expect(invalidateLocal).toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "toggle" }));
      expect(useKollaborBarStore.getState().enabled).toBe(true);
      expect(getFloatingBarAvailability().runtimeMayStart).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "retry-shutdown" }));
      await flushMicrotasksForScopeTest();
      expect(readPendingShutdownMarker(scope)).toEqual(marker);
      expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
        enabled: true,
        sessionId: null,
        cleanupBlocked: true,
        shutdownPending: true,
      }));
      expect(getFloatingBarAvailability().runtimeMayStart).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      unregister?.();
      if (originalDeploymentFlag === undefined) delete process.env.NEXT_PUBLIC_KOLLABOR_BAR;
      else process.env.NEXT_PUBLIC_KOLLABOR_BAR = originalDeploymentFlag;
    }
  });

  it("keeps a known-session shutdown marker non-retryable without scoped terminal cancel support", async () => {
    render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));

    const scope = useKollaborBarStore.getState().storageScope;
    act(() => {
      writePendingShutdownMarker({
        scope,
        sessionId: "known-session",
        generation: useKollaborBarStore.getState().generation,
        startedAt: Date.now(),
      });
      useKollaborBarStore.getState().setShutdownState({
        pending: true,
        blocked: true,
        error: BAR_SHUTDOWN_ERROR,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("shutdown-retryable")).toHaveTextContent("false");
      expect(screen.getByTestId("shutdown-session-unknown")).toHaveTextContent("false");
      expect(screen.getByTestId("shutdown-cancel-unverifiable")).toHaveTextContent("true");
    });

    const marker = readPendingShutdownMarker(scope);
    fireEvent.click(screen.getByRole("button", { name: "retry-shutdown" }));
    await flushMicrotasksForScopeTest();
    expect(readPendingShutdownMarker(scope)).toEqual(marker);
    expect(useKollaborBarStore.getState().cleanupBlocked).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("answers a registered panel snapshot and deduplicates preference requests", async () => {
    const anonymousScope = getAnonymousFloatingBarStorageScope();
    const panelWindow = { postMessage: jest.fn() } as unknown as Window;
    render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: panelWindow,
        data: {
          type: "mentiko-floating-bar-preference",
          action: BRIDGE_SNAPSHOT_REQUEST,
          scope: anonymousScope,
          revision: 0,
        },
      }));
    });
    const ownerSnapshot = postedBridgeMessage(panelWindow, BRIDGE_SNAPSHOT);
    expect(ownerSnapshot?.scopeEpoch).toEqual(expect.any(String));
    expect(panelWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "mentiko-floating-bar-preference",
        action: BRIDGE_SNAPSHOT,
        barWidth: 373,
      }),
      window.location.origin,
    );

    const request = {
      type: "mentiko-floating-bar-preference",
      action: BRIDGE_PREFERENCE_REQUEST,
      scope: anonymousScope,
      scopeEpoch: ownerSnapshot?.scopeEpoch,
      requestId: "request-1",
      revision: 0,
      enabled: false,
      barWidth: 480,
      appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS, backdropWidth: 700 },
    };
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: panelWindow, data: request }));
      window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, source: panelWindow, data: request }));
    });

    expect(localStorage.getItem(`mentiko-kollabor-enabled:${anonymousScope}`)).toBe("0");
    expect(localStorage.getItem(`mentiko-kollabor-width:${anonymousScope}`)).toBe("480");
    expect(localStorage.getItem(`${LS_APPEARANCE_KEY}:${anonymousScope}`)).toContain('"backdropWidth":700');
    expect(panelWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: BRIDGE_PREFERENCE_ACK,
        requestId: "request-1",
        enabled: false,
        barWidth: 480,
        appearance: expect.objectContaining({ backdropWidth: 700 }),
      }),
      window.location.origin,
    );
    const acknowledgements = (panelWindow.postMessage as jest.Mock).mock.calls.filter(
      ([message]) => message?.action === BRIDGE_PREFERENCE_ACK,
    );
    expect(acknowledgements).toHaveLength(2);
  });

  it("rejects a same-origin preference write until the panel has completed a snapshot handshake", async () => {
    const scope = getAnonymousFloatingBarStorageScope();
    const panelWindow = { postMessage: jest.fn() } as unknown as Window;
    render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: panelWindow,
        data: {
          type: "mentiko-floating-bar-preference",
          action: BRIDGE_PREFERENCE_REQUEST,
          scope,
          scopeEpoch: "forged-same-origin-epoch",
          requestId: "unregistered-panel-write",
          revision: 0,
          enabled: false,
        },
      }));
    });

    expect(useKollaborBarStore.getState().enabled).toBe(true);
    expect(localStorage.getItem(`mentiko-kollabor-enabled:${scope}`)).toBeNull();
    expect(panelWindow.postMessage).not.toHaveBeenCalled();
  });

  it("rejects an older panel revision without overwriting the owner and acknowledges a fresh snapshot", async () => {
    const scope = getAnonymousFloatingBarStorageScope();
    const panelWindow = { postMessage: jest.fn() } as unknown as Window;
    render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: panelWindow,
        data: {
          type: "mentiko-floating-bar-preference",
          action: BRIDGE_SNAPSHOT_REQUEST,
          scope,
          revision: 0,
        },
      }));
    });
    const ownerSnapshot = postedBridgeMessage(panelWindow, BRIDGE_SNAPSHOT);
    expect(ownerSnapshot?.scopeEpoch).toEqual(expect.any(String));

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(useKollaborBarStore.getState().enabled).toBe(false);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: panelWindow,
        data: {
          type: "mentiko-floating-bar-preference",
          action: BRIDGE_PREFERENCE_REQUEST,
          scope,
          scopeEpoch: ownerSnapshot?.scopeEpoch,
          requestId: "stale-panel-write",
          revision: 0,
          enabled: true,
          barWidth: 480,
          appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS, backdropWidth: 700 },
        },
      }));
    });

    expect(useKollaborBarStore.getState()).toEqual(expect.objectContaining({
      enabled: false,
      barWidth: 373,
      appearance: KOLLABOR_BAR_APPEARANCE_DEFAULTS,
    }));
    expect(localStorage.getItem(`mentiko-kollabor-enabled:${scope}`)).toBe("0");
    expect(localStorage.getItem(`mentiko-kollabor-width:${scope}`)).toBeNull();
    expect(localStorage.getItem(`${LS_APPEARANCE_KEY}:${scope}`)).toBeNull();
    const staleAck = (panelWindow.postMessage as jest.Mock).mock.calls
      .map(([message]) => message as { action?: string; requestId?: string })
      .find((message) => message.action === BRIDGE_PREFERENCE_ACK && message.requestId === "stale-panel-write");
    expect(staleAck).toEqual(expect.objectContaining({
      action: BRIDGE_PREFERENCE_ACK,
      requestId: "stale-panel-write",
      revision: 1,
      enabled: false,
      barWidth: 373,
      appearance: KOLLABOR_BAR_APPEARANCE_DEFAULTS,
    }));
  });

  it("does not apply a late preference acknowledgement for a superseded panel request", async () => {
    const selfDescriptor = Object.getOwnPropertyDescriptor(window, "self");
    const postMessage = jest.spyOn(window, "postMessage").mockImplementation(() => {});
    let view: ReturnType<typeof render> | undefined;
    try {
      Object.defineProperty(window, "self", { configurable: true, value: {} as Window });
      view = render(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );
      await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
      const scope = useKollaborBarStore.getState().storageScope;
      await deliverParentSnapshot(scope, "owner-epoch-panel-a");
      fireEvent.click(screen.getByRole("button", { name: "toggle" }));

      const request = postMessage.mock.calls
        .map(([message]) => message as { action?: string; scope?: string; scopeEpoch?: string; requestId?: string })
        .find((message) => message.action === BRIDGE_PREFERENCE_REQUEST);
      expect(request?.requestId).toBeTruthy();
      expect(request?.scopeEpoch).toBe("owner-epoch-panel-a");
      expect(screen.getByTestId("enabled")).toHaveTextContent("true");

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          origin: window.location.origin,
          source: window.parent,
          data: {
            type: "mentiko-floating-bar-preference",
            action: BRIDGE_PREFERENCE_ACK,
            scope: request!.scope,
            scopeEpoch: request!.scopeEpoch,
            requestId: "superseded-request",
            revision: 1,
            enabled: false,
            barWidth: 910,
            appearance: { ...KOLLABOR_BAR_APPEARANCE_DEFAULTS, surfaceShadow: 0 },
          },
        }));
      });

      expect(screen.getByTestId("enabled")).toHaveTextContent("true");
      expect(useKollaborBarStore.getState().barWidth).toBe(373);
      expect(useKollaborBarStore.getState().appearance.surfaceShadow).toBe(
        KOLLABOR_BAR_APPEARANCE_DEFAULTS.surfaceShadow,
      );
      expect(screen.getByTestId("bridge-pending")).toHaveTextContent("true");
    } finally {
      view?.unmount();
      postMessage.mockRestore();
      if (selfDescriptor) Object.defineProperty(window, "self", selfDescriptor);
      else Reflect.deleteProperty(window, "self");
    }
  });

  it("discards a pending panel write and its late acknowledgement when the user scope changes", async () => {
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { storageScope: "install:test" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const selfDescriptor = Object.getOwnPropertyDescriptor(window, "self");
    const postMessage = jest.spyOn(window, "postMessage").mockImplementation(() => {});
    let view: ReturnType<typeof render> | undefined;
    try {
      Object.defineProperty(window, "self", { configurable: true, value: {} as Window });
      view = render(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );
      await waitFor(() => expect(screen.getByTestId("scope")).toHaveTextContent("install:test:user:user-a"));
      await deliverParentSnapshot("install:test:user:user-a", "owner-epoch-user-a");
      fireEvent.click(screen.getByRole("button", { name: "toggle" }));
      const request = postMessage.mock.calls
        .map(([message]) => message as { action?: string; scope?: string; scopeEpoch?: string; requestId?: string })
        .find((message) => message.action === BRIDGE_PREFERENCE_REQUEST);
      expect(request?.requestId).toBeTruthy();
      expect(request?.scopeEpoch).toBe("owner-epoch-user-a");

      mockUser = { id: "user-b" };
      view.rerender(
        <FloatingBarStorageScope>
          <Harness />
        </FloatingBarStorageScope>,
      );
      await waitFor(() => {
        expect(screen.getByTestId("ready")).toHaveTextContent("true");
        expect(screen.getByTestId("scope")).toHaveTextContent("install:test:user:user-b");
      });

      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          origin: window.location.origin,
          source: window.parent,
          data: {
            type: "mentiko-floating-bar-preference",
            action: BRIDGE_PREFERENCE_ACK,
            scope: request!.scope,
            scopeEpoch: request!.scopeEpoch,
            requestId: request!.requestId,
            revision: 1,
            enabled: false,
            barWidth: 910,
          },
        }));
      });

      expect(useKollaborBarStore.getState().enabled).toBe(true);
      expect(useKollaborBarStore.getState().barWidth).toBe(373);
      expect(screen.getByTestId("bridge-pending")).toHaveTextContent("false");
      expect(localStorage.getItem("mentiko-kollabor-enabled:install:test:user:user-b")).toBeNull();
    } finally {
      view?.unmount();
      postMessage.mockRestore();
      if (selfDescriptor) Object.defineProperty(window, "self", selfDescriptor);
      else Reflect.deleteProperty(window, "self");
      mockUser = null;
    }
  });

  it("rejects a stale panel write after the owner scope changes from A to B and back to A", async () => {
    mockUser = { id: "user-a" };
    (global.fetch as jest.Mock).mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { storageScope: "install:test" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const panelWindow = { postMessage: jest.fn() } as unknown as Window;
    const view = render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    const scopeA = "install:test:user:user-a";
    await waitFor(() => expect(screen.getByTestId("scope")).toHaveTextContent(scopeA));

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: panelWindow,
        data: {
          type: "mentiko-floating-bar-preference",
          action: BRIDGE_SNAPSHOT_REQUEST,
          scope: scopeA,
          revision: 0,
        },
      }));
    });
    const firstEpoch = postedBridgeMessage(panelWindow, BRIDGE_SNAPSHOT)?.scopeEpoch;
    expect(firstEpoch).toEqual(expect.any(String));

    mockUser = { id: "user-b" };
    view.rerender(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    await waitFor(() => expect(screen.getByTestId("scope")).toHaveTextContent("install:test:user:user-b"));

    mockUser = { id: "user-a" };
    view.rerender(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("ready")).toHaveTextContent("true");
      expect(screen.getByTestId("scope")).toHaveTextContent(scopeA);
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: window.location.origin,
        source: panelWindow,
        data: {
          type: "mentiko-floating-bar-preference",
          action: BRIDGE_PREFERENCE_REQUEST,
          scope: scopeA,
          scopeEpoch: firstEpoch,
          requestId: "stale-a-after-b",
          revision: 0,
          enabled: false,
        },
      }));
    });

    expect(useKollaborBarStore.getState().enabled).toBe(true);
    expect(localStorage.getItem(`mentiko-kollabor-enabled:${scopeA}`)).toBeNull();
    expect((panelWindow.postMessage as jest.Mock).mock.calls.some(
      ([message]) => message?.action === BRIDGE_PREFERENCE_ACK && message?.requestId === "stale-a-after-b",
    )).toBe(false);
  });

  it("rejects wrong-origin panel messages", async () => {
    const panelWindow = { postMessage: jest.fn() } as unknown as Window;
    render(
      <FloatingBarStorageScope>
        <Harness />
      </FloatingBarStorageScope>,
    );
    await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"));
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://attacker.example",
        source: panelWindow,
        data: {
          type: "mentiko-floating-bar-preference",
          action: BRIDGE_PREFERENCE_REQUEST,
          scope: getAnonymousFloatingBarStorageScope(),
          requestId: "bad",
          revision: 0,
          enabled: false,
        },
      }));
    });
    expect(panelWindow.postMessage).not.toHaveBeenCalled();
    expect(useKollaborBarStore.getState().enabled).toBe(true);
  });
});
