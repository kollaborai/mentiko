import { replyToTool } from "../mentiko-mcp-bar-client";

describe("replyToTool", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    jest.clearAllMocks();
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  test("posts reply with bearer token and local engine session fallback", async () => {
    sessionStorage.setItem("mentiko-session-token", "jwt-token");
    localStorage.setItem("mentiko-kollabor-session-id-v2", "session-a");
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

  test("uses legacy local session id when the v2 key is absent", async () => {
    localStorage.setItem("mentiko-kollabor-session-id", "legacy-session");
    const fetchMock = global.fetch as jest.Mock;

    await replyToTool("tool-2", "ok");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      toolId: "tool-2",
      result: "ok",
      sessionId: "legacy-session",
    });
  });
});
