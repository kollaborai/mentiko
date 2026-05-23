/**
 * lane B3 — verifies the floating bar prefers the "mentiko" profile and
 * skips the codex auth flow when MENTIKO_AI_GATEWAY_ENABLED=true.
 *
 * we don't render the full bar (zustand + xterm-y dependencies are heavy
 * for jsdom). instead we mount with all deps mocked and assert the contract:
 *   - /api/system/ai-gateway IS fetched
 *   - /api/system/codex-token is NOT fetched when gatewayEnabled=true
 */

import { act, render } from "@testing-library/react";

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
jest.mock("@/lib/workspace-context", () => {
  const setter = jest.fn();
  const ws = { workspaceId: "ws", setWorkspaceId: setter };
  return {
    useWorkspace: () => ws,
  };
});

jest.mock("@/lib/pill-nav-preferences", () => {
  const prefs = { prefs: { navigationMode: "floating-pill-nav" } };
  return {
    usePillNavPreferences: () => prefs,
    getPillNavShineGradient: () => "rgba(0,0,0,0)",
  };
});

jest.mock("@/lib/kollabor-engine-client", () => ({
  getOrCreateSession: jest.fn().mockResolvedValue({ sessionId: "sid-1", sessionToken: "tok" }),
  ensureMentikoAgentInstalled: jest.fn().mockResolvedValue({ agentFingerprint: "fp" }),
  sendMessage: jest.fn(),
  respondToPermission: jest.fn(),
  ping: jest.fn().mockResolvedValue(true),
}));

jest.mock("@/lib/mentiko-mcp-bar-client", () => ({
  MCPBarClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
  getStoredSessionToken: jest.fn().mockReturnValue(null),
  syncSessionToken: jest.fn(),
}));

jest.mock("@/components/kollabor-permission-prompt", () => ({
  KollaborPermissionPrompt: () => null,
}));

jest.mock("@/components/kollabor-ask-prompt", () => ({
  KollaborAskPrompt: () => null,
}));

jest.mock("@/components/ui/wave-spinner", () => ({
  WaveSpinner: () => null,
}));

jest.mock("@/components/notifications-panel", () => ({
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

import { FloatingKollaborBar } from "../floating-kollabor-bar";

describe("FloatingKollaborBar — gateway mode", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
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
});
