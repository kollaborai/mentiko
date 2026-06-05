import {
  MCPBarClient,
  replyToTool,
  setMcpBarStorageScope,
  syncSessionToken,
} from "../ai-engine/mentiko-mcp-bar-client";

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  url: string;

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe("replyToTool", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();
    MockEventSource.instances = [];
    (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: true });
    setMcpBarStorageScope("user-a");
  });

  test("posts reply with bearer token and local engine session fallback", async () => {
    sessionStorage.setItem("mentiko-session-token:user-a", "jwt-token");
    localStorage.setItem("mentiko-kollabor-session-id-v2:user-a", "session-a");
    const fetchMock = global.fetch as jest.Mock;

    await replyToTool("tool-1", { choice: "approve" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mentiko-mcp/reply",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer jwt-token",
        },
        body: JSON.stringify({
          toolId: "tool-1",
          result: { choice: "approve" },
          sessionId: "session-a",
        }),
      }),
    );
  });

  test("uses scoped legacy local session id when the v2 key is absent", async () => {
    localStorage.setItem("mentiko-kollabor-session-id:user-a", "legacy-session");
    const fetchMock = global.fetch as jest.Mock;

    await replyToTool("tool-2", "ok");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      toolId: "tool-2",
      result: "ok",
      sessionId: "legacy-session",
    });
  });

  test("syncSessionToken clears stale tokens when the session has no fresh token", () => {
    sessionStorage.setItem("mentiko-session-token:user-a", "stale-token");

    syncSessionToken(undefined);

    expect(sessionStorage.getItem("mentiko-session-token:user-a")).toBeNull();
  });

  test("clears stale tokens when stream refresh returns no replacement token", async () => {
    sessionStorage.setItem("mentiko-session-token:user-a", "stale-token");
    localStorage.setItem("mentiko-kollabor-session-id-v2:user-a", "session-a");
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const client = new MCPBarClient(jest.fn());
    client.connect();
    MockEventSource.instances[0].onerror?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sessionStorage.getItem("mentiko-session-token:user-a")).toBeNull();
  });
});
