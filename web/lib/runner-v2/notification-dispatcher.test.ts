import { describe, expect, it } from "@jest/globals";

import {
  buildDispatchPayload,
  dispatchNotification,
  parseDispatchResponse,
  resolveDispatchEndpoint,
  type DispatchInput,
  type FetchLike,
} from "@/lib/runner-v2/notification-dispatcher";

describe("buildDispatchPayload", () => {
  it("produces the dispatch payload shape", () => {
    const payload = buildDispatchPayload({
      eventType: "chain-completed",
      chainId: "chain-1",
      runId: "run-1",
      agentId: "",
      message: "",
      namespaceId: "ns-1",
    });
    expect(JSON.parse(payload)).toEqual({
      event: "chain-completed",
      chainId: "chain-1",
      runId: "run-1",
      agentId: "",
      message: "",
      namespaceId: "ns-1",
    });
  });
});

describe("parseDispatchResponse", () => {
  it("counts dispatched channels", () => {
    expect(parseDispatchResponse('{"dispatched":["in-app","push","email"]}').dispatchedCount).toBe(3);
  });

  it("rejects a response with no dispatched channels", () => {
    expect(() => parseDispatchResponse('{"ok":true}')).toThrow(/missing dispatched channels/);
  });

  it("rejects a non-array dispatched field", () => {
    expect(() => parseDispatchResponse('{"dispatched":3}')).toThrow(/missing dispatched channels/);
  });

  it("rejects non-JSON bodies", () => {
    expect(() => parseDispatchResponse("nope")).toThrow(/invalid JSON/);
    expect(() => parseDispatchResponse("")).toThrow(/invalid JSON/);
  });
});

describe("resolveDispatchEndpoint", () => {
  it("uses the explicit dispatch endpoint when set", () => {
    expect(resolveDispatchEndpoint({ MENTIKO_DISPATCH_ENDPOINT: "https://host/api/notifications/dispatch" })).toBe(
      "https://host/api/notifications/dispatch",
    );
  });

  it("derives from the web url when only that is set", () => {
    expect(resolveDispatchEndpoint({ MENTIKO_WEB_URL: "https://app.mentiko.dev" })).toBe(
      "https://app.mentiko.dev/api/notifications/dispatch",
    );
  });

  it("falls back to localhost with the resolved port", () => {
    expect(resolveDispatchEndpoint({ WEB_PORT: "4321" })).toBe("http://localhost:4321/api/notifications/dispatch");
    expect(resolveDispatchEndpoint({ PORT: "9999" })).toBe("http://localhost:9999/api/notifications/dispatch");
    expect(resolveDispatchEndpoint({})).toBe("http://localhost:3000/api/notifications/dispatch");
  });

  it("honors BETTER_AUTH_URL before MENTIKO_WEB_URL (legacy chain-runner precedence)", () => {
    expect(resolveDispatchEndpoint({ BETTER_AUTH_URL: "https://app.mentiko.com", MENTIKO_WEB_URL: "https://other" })).toBe(
      "https://app.mentiko.com/api/notifications/dispatch",
    );
    expect(resolveDispatchEndpoint({ MENTIKO_WEB_URL: "https://other" })).toBe("https://other/api/notifications/dispatch");
  });
});

describe("dispatchNotification", () => {
  const baseInput: DispatchInput = { eventType: "chain-failed", chainId: "c", runId: "r", agentId: "", message: "boom", namespaceId: "" };

  const fakeFetch = (status: number, body: string): { fetch: FetchLike; seen: () => { url: string; init: unknown } | undefined } => {
    let seen: { url: string; init: unknown } | undefined;
    const fetch: FetchLike = async (url, init) => {
      seen = { url, init };
      return { status, text: async () => body };
    };
    return { fetch, seen: () => seen };
  };

  it("skips without dispatching when notifications are disabled", async () => {
    const { fetch } = fakeFetch(200, '{"dispatched":[]}');
    const outcome = await dispatchNotification(baseInput, {
      env: { MENTIKO_NOTIFICATIONS_ENABLED: "false" },
      fetch,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.httpCode).toBe(0);
    expect(outcome.message).toMatch(/skipped \(disabled\)/);
  });

  it("reports the dispatched channel count on a 2xx response", async () => {
    const { fetch, seen } = fakeFetch(200, '{"dispatched":["in-app","email"]}');
    const outcome = await dispatchNotification(baseInput, { env: { NAMESPACE_ID: "ns-9" }, fetch });
    expect(outcome).toEqual({ ok: true, httpCode: 200, message: "notification: chain-failed dispatched to 2 channels" });
    const call = seen();
    expect(call?.url).toBe("http://localhost:3000/api/notifications/dispatch");
    const body = JSON.parse((call!.init as { body: string }).body);
    expect(body.namespaceId).toBe("ns-9");
    expect((call!.init as { headers: Record<string, string> }).headers.Authorization).toBeUndefined();
  });

  it("sends the bearer secret when configured", async () => {
    const { fetch, seen } = fakeFetch(200, '{"dispatched":[]}');
    await dispatchNotification(baseInput, { env: { MENTIKO_DISPATCH_SECRET: "s3cr3t" }, fetch });
    expect((seen()!.init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer s3cr3t");
  });

  it("reports a failure line on a non-2xx response", async () => {
    const { fetch } = fakeFetch(503, '{"dispatched":[]}');
    const outcome = await dispatchNotification(baseInput, { env: {}, fetch });
    expect(outcome).toEqual({ ok: false, httpCode: 503, message: "notification: failed to dispatch chain-failed (HTTP 503)" });
  });

  it("rejects a malformed 2xx response instead of reporting zero channels", async () => {
    const { fetch } = fakeFetch(200, '{"ok":true}');
    const outcome = await dispatchNotification(baseInput, { env: {}, fetch });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/invalid dispatch response/);
  });

  it("keeps event-specific failure text in the typed payload", async () => {
    const { fetch, seen } = fakeFetch(200, '{"dispatched":[]}');
    await dispatchNotification({ ...baseInput, message: "" }, { env: {}, fetch });
    expect(JSON.parse((seen()!.init as { body: string }).body).message).toBe("Chain stopped due to an error");
  });

  it("accepts chain-started without defaulting it to completion", async () => {
    const { fetch, seen } = fakeFetch(200, '{"dispatched":[]}');
    await dispatchNotification({ ...baseInput, eventType: "chain-started", message: "" }, { env: {}, fetch });
    expect(JSON.parse((seen()!.init as { body: string }).body).event).toBe("chain-started");
  });

  it("uses the explicit --endpoint primitive instead of resolving from env", async () => {
    const { fetch, seen } = fakeFetch(200, '{"dispatched":[]}');
    await dispatchNotification(
      { ...baseInput, endpoint: "https://explicit.example/api/notifications/dispatch" },
      { env: { MENTIKO_WEB_URL: "https://ignored" }, fetch },
    );
    expect(seen()?.url).toBe("https://explicit.example/api/notifications/dispatch");
  });

  it("never throws on a network error", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const outcome = await dispatchNotification(baseInput, { env: {}, fetch });
    expect(outcome.ok).toBe(false);
    expect(outcome.httpCode).toBe(0);
    expect(outcome.message).toMatch(/ECONNREFUSED/);
  });

  it("defaults the namespace to default when unset", async () => {
    const { fetch, seen } = fakeFetch(200, '{"dispatched":[]}');
    await dispatchNotification({ ...baseInput, namespaceId: "" }, { env: {}, fetch });
    expect(JSON.parse((seen()!.init as { body: string }).body).namespaceId).toBe("default");
  });
});
