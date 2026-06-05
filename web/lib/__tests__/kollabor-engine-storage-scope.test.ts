/**
 * @jest-environment jsdom
 */

describe("kollabor engine storage scope", () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("does not reuse origin-wide legacy engine sessions for a signed-in user scope", async () => {
    localStorage.setItem("mentiko-kollabor-session-id-v2", "old-origin-session");

    const {
      getOrCreateSession,
      setKollaborEngineStorageScope,
      clearTokenCache,
    } = await import("../ai-engine/kollabor-engine-client");

    setKollaborEngineStorageScope("user-a");
    clearTokenCache();

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") {
        return new Response(JSON.stringify({ ok: true, synced: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "/api/kollabor/token") {
        return new Response(JSON.stringify({ token: "engine-token", baseUrl: "http://engine.test" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "http://engine.test/sessions" && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "new-scoped-session" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await getOrCreateSession({ profile: "kollab" });

    expect(result.sessionId).toBe("new-scoped-session");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://engine.test/sessions/old-origin-session",
      expect.anything(),
    );
    expect(localStorage.getItem("mentiko-kollabor-session-id-v2")).toBe("old-origin-session");
    expect(localStorage.getItem("mentiko-kollabor-session-id-v2:user-a")).toBe("new-scoped-session");
  });
});
