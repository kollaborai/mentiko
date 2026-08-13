/**
 * @jest-environment jsdom
 *
 * Regression lock for the per-boot daemon leak.
 *
 * Every bar boot used to spawn a fresh kollab daemon and orphan the previous
 * one (55 daemons from a single 14.5h engine run). Two causes, both here:
 *
 *  1. sessionMatchesRequest gated reuse on info.mcp_connected, which the engine
 *     hardcodes to [] — so the check could never pass.
 *  2. a failed token refresh abandoned a session that had already matched.
 *
 * Both tests assert the same thing: POST /sessions is never called, i.e. no new
 * daemon. They fail on the pre-fix client.
 */

const SESSION_KEY = "mentiko-kollabor-session-id-v2:user-a";
const REQUIREMENTS_KEY = "mentiko-kollabor-session-requirements-v2:user-a";

const OPTS = {
  profile: "openai-oauth",
  agent: "mentiko",
  mcp_servers: ["mentiko"],
  metadata: { source: "test", mentiko_agent_fingerprint: "fp-1" },
};

// Must match requiredSessionSignature()'s shape exactly, or the storage gate
// clears the session before the reuse path is ever reached.
const SIGNATURE = JSON.stringify({
  profile: "openai-oauth",
  agent: "mentiko",
  mcp_servers: ["mentiko"],
  mentiko_agent_fingerprint: "fp-1",
});

// The exact shape the live engine returns: configured with mentiko, and
// mcp_connected always empty (session.py hardcodes it).
const LIVE_SESSION_SHAPE = {
  session_id: "sess_existing",
  profile: "openai-oauth",
  mcp_servers: ["mentiko"],
  mcp_connected: [],
  active: true,
};

function buildFetchMock(opts: { refreshTokenOk: boolean; active?: boolean }) {
  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url === "/api/kollabor/setup/mentiko") return json({ ok: true, synced: true });
    if (url === "/api/kollabor/token") {
      return json({ token: "engine-token", baseUrl: "http://engine.test" });
    }
    if (url === "http://engine.test/sessions/sess_existing") {
      return json({ ...LIVE_SESSION_SHAPE, active: opts.active ?? true });
    }
    if (url.endsWith("/sessions/sess_existing/refresh-token")) {
      return opts.refreshTokenOk
        ? json({ session_token: "fresh-token" })
        : json({ error: "unauthorized" }, 401);
    }
    if (url === "http://engine.test/sessions" && init?.method === "POST") {
      // Reaching here means a daemon was spawned — the bug.
      return json({ session_id: "LEAKED_NEW_SESSION" });
    }
    return new Response("not found", { status: 404 });
  });
}

async function loadClient() {
  const mod = await import("../ai-engine/kollabor-engine-client");
  mod.setKollaborEngineStorageScope("user-a");
  mod.clearTokenCache();
  return mod;
}

describe("kollabor session reuse (daemon leak regression)", () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(SESSION_KEY, "sess_existing");
    localStorage.setItem(REQUIREMENTS_KEY, SIGNATURE);
  });

  it("reuses the stored session when mcp_connected is empty but mcp_servers matches", async () => {
    const fetchMock = buildFetchMock({ refreshTokenOk: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getOrCreateSession } = await loadClient();
    const result = await getOrCreateSession(OPTS);

    expect(result.sessionId).toBe("sess_existing");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://engine.test/sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.getItem(SESSION_KEY)).toBe("sess_existing");
  });

  // The engine never evicts sessions whose daemon has died, so a stored id can
  // resolve to a dead session that otherwise matches perfectly. Reusing it
  // yields HTTP 409 "Session daemon is not running" on the first turn.
  it("does NOT reuse a session whose daemon is dead", async () => {
    const fetchMock = buildFetchMock({ refreshTokenOk: true, active: false });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getOrCreateSession } = await loadClient();
    const result = await getOrCreateSession(OPTS);

    expect(result.sessionId).toBe("LEAKED_NEW_SESSION");
    expect(localStorage.getItem(SESSION_KEY)).toBe("LEAKED_NEW_SESSION");
  });

  it("reuses a matching session even when its token refresh fails", async () => {
    const fetchMock = buildFetchMock({ refreshTokenOk: false });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getOrCreateSession } = await loadClient();
    const result = await getOrCreateSession(OPTS);

    expect(result.sessionId).toBe("sess_existing");
    expect(result.sessionToken).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://engine.test/sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.getItem(SESSION_KEY)).toBe("sess_existing");
  });
});
