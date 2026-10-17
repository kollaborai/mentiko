import {
  MCPBarClient,
  setMcpBarStorageScope,
} from "@/lib/ai-engine/mentiko-mcp-bar-client";

class LifecycleEventSource {
  static instances: LifecycleEventSource[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string | URL) {
    LifecycleEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe("MCP bar client lifecycle guards", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    LifecycleEventSource.instances = [];
    (globalThis as unknown as { EventSource: typeof LifecycleEventSource }).EventSource = LifecycleEventSource;
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
    setMcpBarStorageScope("scope-a");
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("does not reconnect after disconnect cancels a scheduled reconnect", () => {
    const client = new MCPBarClient(jest.fn());
    client.connect();
    expect(LifecycleEventSource.instances).toHaveLength(1);

    LifecycleEventSource.instances[0].onerror?.();
    client.disconnect();
    jest.advanceTimersByTime(4_000);

    expect(LifecycleEventSource.instances).toHaveLength(1);
    expect(LifecycleEventSource.instances[0].closed).toBe(true);
  });

  it("does not open a client after it has been closed", () => {
    const client = new MCPBarClient(jest.fn());
    client.disconnect();
    client.connect();
    expect(LifecycleEventSource.instances).toHaveLength(0);
  });

  it("suspends existing UI effect delivery locally after disable without revocation", () => {
    const onEffect = jest.fn();
    const client = new MCPBarClient(onEffect);
    client.connect();
    const source = LifecycleEventSource.instances[0];

    source.onmessage?.({ data: JSON.stringify({ type: "before-disable" }) });
    client.disconnect();
    source.onmessage?.({ data: JSON.stringify({ type: "after-disable" }) });

    expect(onEffect).toHaveBeenCalledTimes(1);
    expect(onEffect).toHaveBeenCalledWith({ type: "before-disable" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect((global.fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes("/revoke"))).toBe(false);
  });

  it("ignores buffered effect callbacks after changing storage scope", () => {
    const onEffect = jest.fn();
    const client = new MCPBarClient(onEffect);
    client.connect();
    const source = LifecycleEventSource.instances[0];

    setMcpBarStorageScope("scope-b");
    source.onmessage?.({ data: JSON.stringify({ type: "late-from-a" }) });

    expect(onEffect).not.toHaveBeenCalled();
    client.disconnect();
  });

  it("does not persist a late refresh result or reconnect after disconnect", async () => {
    localStorage.setItem("mentiko-kollabor-session-id-v2:scope-a", "session-a");
    sessionStorage.setItem("mentiko-session-token:scope-a", "stale-a");
    let resolveRefresh!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    const client = new MCPBarClient(jest.fn());
    client.connect();
    LifecycleEventSource.instances[0].onerror?.();
    client.disconnect();
    resolveRefresh({ ok: true, json: async () => ({ session_token: "late-a" }) });
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(1_000);

    expect(sessionStorage.getItem("mentiko-session-token:scope-a")).toBe("stale-a");
    expect(LifecycleEventSource.instances).toHaveLength(1);
  });

  it("does not write a refresh token into the new scope after an old refresh resolves", async () => {
    localStorage.setItem("mentiko-kollabor-session-id-v2:scope-a", "session-a");
    sessionStorage.setItem("mentiko-session-token:scope-a", "stale-a");
    sessionStorage.setItem("mentiko-session-token:scope-b", "keep-b");
    let resolveRefresh!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    const client = new MCPBarClient(jest.fn());
    client.connect();
    LifecycleEventSource.instances[0].onerror?.();
    setMcpBarStorageScope("scope-b");
    resolveRefresh({ ok: true, json: async () => ({ session_token: "stale-from-a" }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionStorage.getItem("mentiko-session-token:scope-b")).toBe("keep-b");
    client.disconnect();
  });

  it("rejects a reply after its captured scope becomes stale", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const client = new MCPBarClient(jest.fn());
    client.disconnect();
    await expect(import("@/lib/ai-engine/mentiko-mcp-bar-client").then(({ replyToTool }) =>
      replyToTool("tool", "ok", { scope: "scope-a", isCurrent: () => {
        setMcpBarStorageScope("scope-b");
        return true;
      } }),
    )).rejects.toThrow("stale MCP scope");
  });

  it("rejects a late reply continuation when scope changes during the request", async () => {
    localStorage.setItem("mentiko-kollabor-session-id-v2:scope-a", "session-a");
    localStorage.setItem("mentiko-kollabor-session-id-v2:scope-b", "session-b");
    let resolveReply!: (value: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValue(new Promise((resolve) => { resolveReply = resolve; }));

    const { replyToTool } = await import("@/lib/ai-engine/mentiko-mcp-bar-client");
    const reply = replyToTool("tool-a", "approve");
    expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1]?.body))).toMatchObject({
      sessionId: "session-a",
    });

    setMcpBarStorageScope("scope-b");
    resolveReply({ ok: true });

    await expect(reply).rejects.toThrow("stale MCP scope");
  });
});
