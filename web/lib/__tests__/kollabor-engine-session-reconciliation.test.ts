import {
  cancelTurn,
  clearTokenCache,
  fetchToken,
  getOrCreateSession,
  setKollaborEngineStorageScope,
} from "@/lib/ai-engine/kollabor-engine-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("kollabor engine cancellation and session reconciliation contracts", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    localStorage.clear();
    clearTokenCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    localStorage.clear();
    clearTokenCache();
  });

  it("does not treat a bodyless or cancelled:true receipt as accepted terminal evidence", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions/session-a/cancel") {
        expect(init?.body).toBeUndefined();
        return jsonResponse({ ok: true, session_id: "session-a", cancelled: true });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(cancelTurn("session-a")).resolves.toEqual({
      accepted: false,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: false,
    });
  });

  it("aborts cancellation while token lookup is still pending", async () => {
    let resolveToken!: (response: Response) => void;
    const pendingToken = new Promise<Response>((resolve) => { resolveToken = resolve; });
    const fetchMock = jest.fn(() => pendingToken);
    global.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();

    const cancellation = cancelTurn("session-a", controller.signal);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/kollabor/token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    controller.abort(new Error("cancel timeout"));
    await expect(cancellation).rejects.toThrow("cancel timeout");

    // The token request may finish later; it must not resume the abandoned
    // cancellation or provide evidence that the server stopped a turn.
    resolveToken(jsonResponse({ token: "late", baseUrl: "http://engine.test" }));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when the cancellation fetch ignores its abort signal", async () => {
    let resolveCancel!: (response: Response) => void;
    const pendingCancel = new Promise<Response>((resolve) => { resolveCancel = resolve; });
    let postedCancelBody: string | undefined;
    const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/token") {
        return Promise.resolve(jsonResponse({ token: "proxied", baseUrl: "http://engine.test" }));
      }
      if (url === "http://engine.test/sessions/session-a/cancel") {
        postedCancelBody = String(init?.body);
        return pendingCancel;
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();

    const cancellation = cancelTurn("session-a", controller.signal, {
      turnId: "turn-delayed",
      cancelRequestId: "cancel-delayed",
    });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(postedCancelBody ?? "null")).toEqual({
      turn_id: "turn-delayed",
      cancel_request_id: "cancel-delayed",
    });

    controller.abort(new Error("cancel timeout"));
    await expect(cancellation).rejects.toThrow("cancel timeout");

    // Abort stops the client's wait; it is not evidence that server-side
    // cancellation stopped. Even a matching late receipt cannot revive this
    // already-aborted client operation.
    resolveCancel(jsonResponse({
      ok: true,
      turn_id: "turn-delayed",
      turn_terminal: true,
      tools_terminal: true,
      cancel_request_id: "cancel-delayed",
    }));
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sets client verification flags only for an exact-ID response fixture", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions/session-a/cancel") {
        expect(JSON.parse(String(init?.body))).toEqual({
          turn_id: "turn-7",
          cancel_request_id: "cancel-7",
        });
        return jsonResponse({
          ok: true,
          turn_id: "turn-7",
          turn_terminal: true,
          tools_terminal: true,
          cancel_request_id: "cancel-7",
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(cancelTurn("session-a", undefined, {
      turnId: "turn-7",
      cancelRequestId: "cancel-7",
    })).resolves.toEqual({
      accepted: true,
      authoritativeTerminal: true,
      turnScoped: true,
      idempotentFence: true,
    });
  });

  it("rejects mismatched cancellation identities even when terminal flags are true", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions/session-a/cancel") {
        return jsonResponse({
          ok: true,
          turn_id: "different-turn",
          turn_terminal: true,
          tools_terminal: true,
          cancel_request_id: "different-cancel",
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(cancelTurn("session-a", undefined, {
      turnId: "turn-requested",
      cancelRequestId: "cancel-requested",
    })).resolves.toEqual({
      accepted: false,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: false,
    });
  });

  it("rejects a cancellation response when only its cancellation request id mismatches", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions/session-a/cancel") {
        return jsonResponse({
          ok: true,
          turn_id: "turn-requested",
          turn_terminal: true,
          tools_terminal: true,
          cancel_request_id: "different-cancel",
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(cancelTurn("session-a", undefined, {
      turnId: "turn-requested",
      cancelRequestId: "cancel-requested",
    })).resolves.toEqual({
      accepted: false,
      authoritativeTerminal: false,
      turnScoped: true,
      idempotentFence: false,
    });
  });

  it("rejects a cancellation response when only its target turn id mismatches", async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions/session-a/cancel") {
        return jsonResponse({
          ok: true,
          turn_id: "different-turn",
          turn_terminal: true,
          tools_terminal: true,
          cancel_request_id: "cancel-requested",
        });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(cancelTurn("session-a", undefined, {
      turnId: "turn-requested",
      cancelRequestId: "cancel-requested",
    })).resolves.toEqual({
      accepted: false,
      authoritativeTerminal: false,
      turnScoped: false,
      idempotentFence: true,
    });
  });

  it("does not let a late token response from scope A populate scope B", async () => {
    setKollaborEngineStorageScope("token:scope-a");
    const resolveToken: Array<(response: Response) => void> = [];
    const fetchMock = jest.fn(() => new Promise<Response>((resolve) => {
      resolveToken.push(resolve);
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const scopeAToken = fetchToken();
    await Promise.resolve();
    setKollaborEngineStorageScope("token:scope-b");
    const scopeBToken = fetchToken();
    await Promise.resolve();

    resolveToken[1](jsonResponse({ token: "token-b", baseUrl: "http://engine-b.test" }));
    await expect(scopeBToken).resolves.toEqual({ token: "token-b", baseUrl: "http://engine-b.test" });
    resolveToken[0](jsonResponse({ token: "token-a", baseUrl: "http://engine-a.test" }));
    await expect(scopeAToken).resolves.toEqual({ token: "token-a", baseUrl: "http://engine-a.test" });

    await expect(fetchToken()).resolves.toEqual({ token: "token-b", baseUrl: "http://engine-b.test" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch a session create when scope changes during token lookup", async () => {
    const scopeA = "reconcile:token-dispatch-scope-a";
    setKollaborEngineStorageScope(scopeA);
    let resolveToken!: (response: Response) => void;
    let tokenRequested = false;
    const pendingToken = new Promise<Response>((resolve) => { resolveToken = resolve; });
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url === "/api/kollabor/token") {
        tokenRequested = true;
        return pendingToken;
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const staleBootstrap = getOrCreateSession({});
    for (let index = 0; index < 20 && !tokenRequested; index += 1) await Promise.resolve();
    expect(tokenRequested).toBe(true);
    const pendingKey = `mentiko-kollabor-session-pending-create-v1:${scopeA}`;
    expect(localStorage.getItem(pendingKey)).not.toBeNull();

    setKollaborEngineStorageScope("reconcile:token-dispatch-scope-b");
    resolveToken(jsonResponse({ token: "scope-a-token", baseUrl: "http://engine-a.test" }));

    await expect(staleBootstrap).rejects.toThrow("superseded by storage-scope change");
    expect(fetchMock.mock.calls.filter(([url]) =>
      /^http:\/\/engine-a\.test\/sessions(?:\/|$)/.test(String(url)),
    )).toHaveLength(0);
    expect(localStorage.getItem(`mentiko-kollabor-session-id-v2:${scopeA}`)).toBeNull();
    expect(localStorage.getItem(pendingKey)).not.toBeNull();
  });

  it("keeps one shared creation alive when one caller aborts", async () => {
    setKollaborEngineStorageScope("reconcile:abort");
    let resolveCreate!: () => void;
    let createStarted = false;
    const createFinished = new Promise<void>((resolve) => { resolveCreate = resolve; });
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") return jsonResponse({ ok: true });
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions" && init?.method === "POST") {
        createStarted = true;
        await createFinished;
        return jsonResponse({ session_id: "sess-shared", active: true, session_token: "token" });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const firstAbort = new AbortController();
    const first = getOrCreateSession({}, firstAbort.signal);
    for (let i = 0; i < 20 && !createStarted; i += 1) await Promise.resolve();
    expect(createStarted).toBe(true);
    const second = getOrCreateSession({});
    firstAbort.abort(new Error("caller left the page"));
    resolveCreate();

    await expect(first).rejects.toThrow("caller left the page");
    await expect(second).resolves.toEqual({ sessionId: "sess-shared", sessionToken: "token" });
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "http://engine.test/sessions" && init?.method === "POST")).toHaveLength(1);
  });

  it("does not expose or persist an accepted late session after its storage-scope generation becomes stale", async () => {
    const scope = "reconcile:late-scope-owner";
    setKollaborEngineStorageScope(scope);
    sessionStorage.clear();
    let resolveCreate!: (response: Response) => void;
    let createStarted = false;
    let stableSessionId = "";
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") return jsonResponse({ ok: true });
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions" && init?.method === "POST") {
        stableSessionId = JSON.parse(String(init.body)).session_id;
        createStarted = true;
        return new Promise<Response>((resolve) => { resolveCreate = resolve; });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const firstAbort = new AbortController();
    const first = getOrCreateSession({}, firstAbort.signal);
    for (let i = 0; i < 20 && !createStarted; i += 1) await Promise.resolve();
    expect(createStarted).toBe(true);
    const stillWaitingOnOldBootstrap = getOrCreateSession({});
    firstAbort.abort(new Error("bar runtime was disabled"));

    // A -> B -> A has the same textual scope but a different ownership epoch.
    setKollaborEngineStorageScope(`${scope}:other`);
    setKollaborEngineStorageScope(scope);
    resolveCreate(jsonResponse({
      session_id: stableSessionId,
      active: true,
      session_token: "late-token",
    }));

    await expect(first).rejects.toThrow("bar runtime was disabled");
    await expect(stillWaitingOnOldBootstrap).rejects.toThrow(
      "superseded by storage-scope change",
    );
    expect(localStorage.getItem(`mentiko-kollabor-session-id-v2:${scope}`)).toBeNull();
    expect(localStorage.getItem(`mentiko-kollabor-session-pending-create-v1:${scope}`)).toContain(stableSessionId);
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === "http://engine.test/sessions" && init?.method === "POST",
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("reconciles a server-accepted creation after the response is lost before retrying", async () => {
    setKollaborEngineStorageScope("reconcile:lost-response");
    let stableSessionId = "";
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") return jsonResponse({ ok: true });
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions" && init?.method === "POST") {
        stableSessionId = JSON.parse(String(init.body)).session_id;
        throw new Error("response lost after server accepted create");
      }
      if (url === `http://engine.test/sessions/${stableSessionId}` && init?.method === "GET") {
        return jsonResponse({ session_id: stableSessionId, active: true, mcp_servers: [] });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getOrCreateSession({})).resolves.toEqual({ sessionId: expect.any(String) });
    expect(stableSessionId).toMatch(/^sess_/);
    expect(localStorage.getItem("mentiko-kollabor-session-id-v2:reconcile:lost-response")).toBe(stableSessionId);
    expect(localStorage.getItem("mentiko-kollabor-session-pending-create-v1:reconcile:lost-response")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "http://engine.test/sessions" && init?.method === "POST")).toHaveLength(1);
  });

  it("returns an inert reconciled session and retains its marker when session-record persistence fails", async () => {
    const scope = "reconcile:inert-storage-failure";
    setKollaborEngineStorageScope(scope);
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === `mentiko-kollabor-session-id-v2:${scope}`) {
        throw new DOMException("storage quota exceeded", "QuotaExceededError");
      }
      originalSetItem(key, value);
    });
    let stableSessionId = "";
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") return jsonResponse({ ok: true });
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions" && init?.method === "POST") {
        stableSessionId = JSON.parse(String(init.body)).session_id;
        throw new Error("response lost after server accepted create");
      }
      if (url === `http://engine.test/sessions/${stableSessionId}` && init?.method === "GET") {
        return jsonResponse({ session_id: stableSessionId, active: true, mcp_servers: [] });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(getOrCreateSession({})).resolves.toEqual({ sessionId: expect.any(String) });
      expect(setItem).toHaveBeenCalledWith(
        `mentiko-kollabor-session-id-v2:${scope}`,
        stableSessionId,
      );
      expect(stableSessionId).toMatch(/^sess_/);
      expect(localStorage.getItem(`mentiko-kollabor-session-pending-create-v1:${scope}`)).not.toBeNull();
      expect(localStorage.getItem(`mentiko-kollabor-session-id-v2:${scope}`)).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it("keeps an accepted create usable when later session-record persistence fails", async () => {
    const scope = "reconcile:accepted-storage-failure";
    setKollaborEngineStorageScope(scope);
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === `mentiko-kollabor-session-id-v2:${scope}`) {
        throw new DOMException("storage quota exceeded", "QuotaExceededError");
      }
      originalSetItem(key, value);
    });
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") return jsonResponse({ ok: true });
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions" && init?.method === "POST") {
        const sessionId = JSON.parse(String(init.body)).session_id;
        return jsonResponse({ session_id: sessionId, active: true, session_token: "active-token" });
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(getOrCreateSession({})).resolves.toEqual({
        sessionId: expect.stringMatching(/^sess_/),
        sessionToken: "active-token",
      });
      expect(localStorage.getItem(`mentiko-kollabor-session-pending-create-v1:${scope}`)).not.toBeNull();
      expect(localStorage.getItem(`mentiko-kollabor-session-id-v2:${scope}`)).toBeNull();
    } finally {
      setItem.mockRestore();
    }
  });

  it("retains the same durable create id when an in-flight reservation returns 409 and GET cannot see it", async () => {
    const scope = "reconcile:in-flight-reservation";
    setKollaborEngineStorageScope(scope);
    const postIds: string[] = [];
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") return jsonResponse({ ok: true });
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      if (url === "http://engine.test/sessions" && init?.method === "POST") {
        postIds.push(JSON.parse(String(init.body)).session_id);
        return jsonResponse({ detail: "session id is reserved while initialization is in flight" }, 409);
      }
      if (/^http:\/\/engine\.test\/sessions\/sess_/.test(url) && init?.method === "GET") {
        return jsonResponse({ detail: "session not found" }, 404);
      }
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(getOrCreateSession({})).rejects.toThrow("createSession: 409");
    const pendingKey = `mentiko-kollabor-session-pending-create-v1:${scope}`;
    const firstMarker = localStorage.getItem(pendingKey);
    expect(firstMarker).not.toBeNull();
    await expect(getOrCreateSession({})).rejects.toThrow("createSession: 409");

    expect(postIds).toHaveLength(2);
    expect(postIds[0]).toMatch(/^sess_/);
    expect(postIds[1]).toBe(postIds[0]);
    expect(localStorage.getItem(pendingKey)).toBe(firstMarker);
    expect(localStorage.getItem(`mentiko-kollabor-session-id-v2:${scope}`)).toBeNull();
  });

  it("does not create an engine session when its pending reconciliation marker cannot be persisted", async () => {
    setKollaborEngineStorageScope("reconcile:marker-write-failure");
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key.startsWith("mentiko-kollabor-session-pending-create-v1:")) {
        throw new DOMException("storage quota exceeded", "QuotaExceededError");
      }
      originalSetItem(key, value);
    });
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/kollabor/setup/mentiko") return jsonResponse({ ok: true });
      if (url === "/api/kollabor/token") return jsonResponse({ token: "proxied", baseUrl: "http://engine.test" });
      return jsonResponse({}, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    try {
      await expect(getOrCreateSession()).rejects.toThrow(
        "pending creation marker could not be persisted",
      );

      expect(setItem).toHaveBeenCalledWith(
        expect.stringContaining("mentiko-kollabor-session-pending-create-v1:"),
        expect.any(String),
      );
      expect(fetchMock.mock.calls.filter(([url, init]) =>
        String(url) === "http://engine.test/sessions" && init?.method === "POST",
      )).toHaveLength(0);
    } finally {
      setItem.mockRestore();
    }
  });
});
