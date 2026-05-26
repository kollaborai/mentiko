/**
 * @jest-environment node
 */

import { clearTokenCache, respondToPermission } from "@/lib/kollabor-engine-client";

describe("kollabor-engine-client", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    clearTokenCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearTokenCache();
    jest.clearAllMocks();
  });

  it("maps approve_always to a session-scoped permission", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/token") {
        return new Response(
          JSON.stringify({ token: "engine-token", baseUrl: "http://engine.test" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://engine.test/sessions/session-1/permission") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await respondToPermission("session-1", "tool-1", "approve_always");

    const permissionCall = fetchMock.mock.calls.find(
      ([url]) => String(url) === "http://engine.test/sessions/session-1/permission",
    );
    expect(permissionCall).toBeDefined();
    expect(JSON.parse(String(permissionCall?.[1]?.body))).toEqual({
      tool_id: "tool-1",
      decision: "approve",
      scope: "session",
    });
  });
});
