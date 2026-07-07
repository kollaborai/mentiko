import { act, renderHook, waitFor } from "@testing-library/react";
import { useTerminalWsConnection } from "./use-terminal-ws-connection";

function mockTokenFetch(tokens: Array<string | null>) {
  const fetchMock = jest.fn(async () => {
    const token = tokens.shift() ?? null;
    if (!token) {
      return { ok: false } as Response;
    }
    return {
      ok: true,
      json: async () => ({ data: { token } }),
    } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("useTerminalWsConnection", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("keeps the current websocket URL mounted when reconnect token refresh misses", async () => {
    const fetchMock = mockTokenFetch(["token-a", null, "token-b"]);

    const { result } = renderHook(() => useTerminalWsConnection("ws://127.0.0.1:3099"));

    await waitFor(() => {
      expect(result.current.wsUrl).toBe("ws://127.0.0.1:3099?token=token-a");
      expect(result.current.status).toBe("running");
    });

    let missedToken: string | null = "unexpected";
    await act(async () => {
      missedToken = await result.current.refreshToken();
    });

    expect(missedToken).toBeNull();
    expect(result.current.wsUrl).toBe("ws://127.0.0.1:3099?token=token-a");
    expect(result.current.status).toBe("running");

    let freshToken: string | null = null;
    await act(async () => {
      freshToken = await result.current.refreshToken();
    });

    expect(freshToken).toBe("token-b");
    expect(result.current.wsUrl).toBe("ws://127.0.0.1:3099?token=token-b");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
