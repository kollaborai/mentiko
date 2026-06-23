/**
 * @jest-environment node
 */

import { clearTokenCache, respondToPermission, sendMessage } from "@/lib/ai-engine/kollabor-engine-client";

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

  it("surfaces an error when a message stream closes before turn_complete", async () => {
    const encoder = new TextEncoder();
    const fetchMock = jest.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/token") {
        return new Response(
          JSON.stringify({ token: "engine-token", baseUrl: "http://engine.test" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://engine.test/sessions/session-1/message") {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "token",
                  session_id: "session-1",
                  ts: 1,
                  text: "working",
                })}\n\n`,
              ),
            );
            controller.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const events = [];
    for await (const event of sendMessage("session-1", "hello")) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({ type: "token", text: "working" }),
      expect.objectContaining({
        type: "error",
        code: "stream_closed",
        message: expect.stringContaining("turn_complete"),
      }),
    ]);
  });
});
