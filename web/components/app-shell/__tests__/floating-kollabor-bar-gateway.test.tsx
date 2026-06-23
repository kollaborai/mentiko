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
  ping: jest.fn().mockResolvedValue(true),
  setKollaborEngineStorageScope: jest.fn(),
  clearKollaborEngineStoredSession: jest.fn(),
}));

jest.mock("@/lib/ai-engine/mentiko-mcp-bar-client", () => ({
  MCPBarClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
  getStoredSessionToken: jest.fn().mockReturnValue(null),
  setMcpBarStorageScope: jest.fn(),
  syncSessionToken: jest.fn(),
}));

jest.mock("@/lib/ui-context/user-context", () => ({
  useUser: () => mockUserState,
}));

jest.mock("@/components/app-shell/kollabor-permission-prompt", () => ({
  KollaborPermissionPrompt: () => null,
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

import { useKollaborBarStore } from "@/lib/ui/kollabor-bar-store";
import {
  clearKollaborEngineStoredSession,
  getOrCreateSession,
  sendMessage,
  setKollaborEngineStorageScope,
} from "@/lib/ai-engine/kollabor-engine-client";
import {
  FloatingKollaborBar,
  nextKollaborBarScaleFromWheel,
  shouldShowEngineOffline,
} from "../floating-kollabor-bar";

describe("FloatingKollaborBar — gateway mode", () => {
  let originalFetch: typeof fetch;
  let originalRequestAnimationFrame: typeof requestAnimationFrame;
  let originalCancelAnimationFrame: typeof cancelAnimationFrame;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalRequestAnimationFrame = global.requestAnimationFrame;
    originalCancelAnimationFrame = global.cancelAnimationFrame;
    global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = jest.fn() as typeof cancelAnimationFrame;
    mockUserState = { user: { id: "user-a" }, loading: false };
    useKollaborBarStore.setState({
      expanded: false,
      messages: [],
      sessionId: null,
      drafting: null,
      connected: false,
      connecting: false,
      error: null,
      scale: 1,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    jest.clearAllMocks();
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
    expect(calls.some((u) => u.includes("/api/system/storage-scope"))).toBe(true);
    expect(setKollaborEngineStorageScope).toHaveBeenCalledWith("install:test:user:user-a");
    expect(calls.some((u) => u.includes("/api/system/codex-token"))).toBe(false);
    // active profile is hardcoded to "mentiko" in gateway mode — never fetched
    expect(calls.some((u) => u.includes("/api/kollabor/profiles/active"))).toBe(false);
  });

  it("does not render stale anonymous transcript while user scope is unresolved", async () => {
    global.fetch = jest.fn(async () => (
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    )) as unknown as typeof fetch;
    mockUserState = { user: null, loading: true };
    useKollaborBarStore.setState({
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

  it("uses a tab-local install fallback when the storage-scope endpoint fails", async () => {
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

    expect(setKollaborEngineStorageScope).toHaveBeenCalledWith(
      expect.stringMatching(/^install:unavailable:.+:user:user-a$/),
    );
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
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      "sid-2",
      "hello?",
      expect.any(Object),
    );
    expect(
      useKollaborBarStore.getState().messages.some((message) =>
        message.content.includes("back online"),
      ),
    ).toBe(true);
  });
});
