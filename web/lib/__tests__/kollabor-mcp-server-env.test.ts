import { getKollabMentikoMcpServerEnv } from "../kollabor-mcp-server-env";

describe("getKollabMentikoMcpServerEnv", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it("includes defaults and optional keys when set", () => {
    process.env.PORT = "3001";
    delete process.env.MENTIKO_WEB_URL;
    process.env.MENTIKO_INBOX_KEY = "secret-key";
    process.env.MENTIKO_NAMESPACE_ID = "ns1";
    process.env.MENTIKO_ORG_ID = "org1";

    const env = getKollabMentikoMcpServerEnv();

    expect(env.MENTIKO_WEB_URL).toBe("http://127.0.0.1:3001");
    expect(env.KOLLABOR_ENGINE_URL).toBe("http://127.0.0.1:7433");
    expect(env.MENTIKO_MCP_TOOL_SCOPE).toBe("bar");
    expect(env.MENTIKO_INBOX_KEY).toBe("secret-key");
    expect(env.MENTIKO_NAMESPACE_ID).toBe("ns1");
    expect(env.MENTIKO_ORG_ID).toBe("org1");
  });

  it("omits inbox when unset", () => {
    delete process.env.MENTIKO_INBOX_KEY;
    const env = getKollabMentikoMcpServerEnv();
    expect(env.MENTIKO_INBOX_KEY).toBeUndefined();
  });
});

describe("getKollabMentikoMcpServerEnv - cross-spawn leakage prevention", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it("uses explicit params instead of process.env when provided", () => {
    // Set process.env to different values than params
    process.env.MENTIKO_WEB_URL = "http://env-example.com";
    process.env.KOLLABOR_ENGINE_URL = "http://env-engine.com";
    process.env.MENTIKO_INBOX_KEY = "env-key";
    process.env.MENTIKO_NAMESPACE_ID = "env-ns";
    process.env.MENTIKO_ORG_ID = "env-org";

    // Call with explicit params - these should take precedence
    const env = getKollabMentikoMcpServerEnv({
      webUrl: "http://param-example.com",
      kollaborEngineUrl: "http://param-engine.com",
      inboxKey: "param-key",
      namespaceId: "param-ns",
      orgId: "param-org",
    });

    // Verify params are used, not process.env
    expect(env.MENTIKO_WEB_URL).toBe("http://param-example.com");
    expect(env.KOLLABOR_ENGINE_URL).toBe("http://param-engine.com");
    expect(env.MENTIKO_INBOX_KEY).toBe("param-key");
    expect(env.MENTIKO_NAMESPACE_ID).toBe("param-ns");
    expect(env.MENTIKO_ORG_ID).toBe("param-org");

    // Fails if leakage occurred - values should NOT come from process.env
    expect(env.MENTIKO_WEB_URL).not.toBe("http://env-example.com");
    expect(env.KOLLABOR_ENGINE_URL).not.toBe("http://env-engine.com");
    expect(env.MENTIKO_INBOX_KEY).not.toBe("env-key");
    expect(env.MENTIKO_NAMESPACE_ID).not.toBe("env-ns");
    expect(env.MENTIKO_ORG_ID).not.toBe("env-org");
  });

  it("prevents leakage between sequential spawn calls with different params", () => {
    // Spawn session A with specific values
    const envA = getKollabMentikoMcpServerEnv({
      webUrl: "http://session-a.example.com",
      kollaborEngineUrl: "http://engine-a.example.com",
      inboxKey: "inbox-key-a",
      namespaceId: "namespace-a",
      orgId: "org-a",
      port: "3001",
      mcpToolScope: "scope-a",
    });

    // Spawn session B with different values
    const envB = getKollabMentikoMcpServerEnv({
      webUrl: "http://session-b.example.com",
      kollaborEngineUrl: "http://engine-b.example.com",
      inboxKey: "inbox-key-b",
      namespaceId: "namespace-b",
      orgId: "org-b",
      port: "3002",
      mcpToolScope: "scope-b",
    });

    // Verify session A has its own scoped values
    expect(envA.MENTIKO_WEB_URL).toBe("http://session-a.example.com");
    expect(envA.KOLLABOR_ENGINE_URL).toBe("http://engine-a.example.com");
    expect(envA.MENTIKO_INBOX_KEY).toBe("inbox-key-a");
    expect(envA.MENTIKO_NAMESPACE_ID).toBe("namespace-a");
    expect(envA.MENTIKO_ORG_ID).toBe("org-a");
    expect(envA.MENTIKO_MCP_TOOL_SCOPE).toBe("scope-a");

    // Verify session B has its own scoped values
    expect(envB.MENTIKO_WEB_URL).toBe("http://session-b.example.com");
    expect(envB.KOLLABOR_ENGINE_URL).toBe("http://engine-b.example.com");
    expect(envB.MENTIKO_INBOX_KEY).toBe("inbox-key-b");
    expect(envB.MENTIKO_NAMESPACE_ID).toBe("namespace-b");
    expect(envB.MENTIKO_ORG_ID).toBe("org-b");
    expect(envB.MENTIKO_MCP_TOOL_SCOPE).toBe("scope-b");

    // Fails if cross-contamination occurred - sessions must be isolated
    expect(envA.MENTIKO_WEB_URL).not.toBe(envB.MENTIKO_WEB_URL);
    expect(envA.KOLLABOR_ENGINE_URL).not.toBe(envB.KOLLABOR_ENGINE_URL);
    expect(envA.MENTIKO_INBOX_KEY).not.toBe(envB.MENTIKO_INBOX_KEY);
    expect(envA.MENTIKO_NAMESPACE_ID).not.toBe(envB.MENTIKO_NAMESPACE_ID);
    expect(envA.MENTIKO_ORG_ID).not.toBe(envB.MENTIKO_ORG_ID);
    expect(envA.MENTIKO_MCP_TOOL_SCOPE).not.toBe(envB.MENTIKO_MCP_TOOL_SCOPE);
  });

  it("prevents leakage from ambient process.env when params are provided", () => {
    // Set ambient process.env values
    process.env.MENTIKO_WEB_URL = "http://ambient.com";
    process.env.KOLLABOR_ENGINE_URL = "http://ambient-engine.com";
    process.env.MENTIKO_INBOX_KEY = "ambient-key";
    process.env.MENTIKO_NAMESPACE_ID = "ambient-ns";
    process.env.MENTIKO_ORG_ID = "ambient-org";
    process.env.PORT = "9999";

    // Multiple sequential calls with explicit params should not be affected by ambient values
    const env1 = getKollabMentikoMcpServerEnv({
      webUrl: "http://spawn1.com",
      port: "8001",
    });

    const env2 = getKollabMentikoMcpServerEnv({
      webUrl: "http://spawn2.com",
      port: "8002",
    });

    const env3 = getKollabMentikoMcpServerEnv({
      webUrl: "http://spawn3.com",
      port: "8003",
    });

    // Each spawn should use its explicit params, not ambient process.env
    expect(env1.MENTIKO_WEB_URL).toBe("http://spawn1.com");
    expect(env2.MENTIKO_WEB_URL).toBe("http://spawn2.com");
    expect(env3.MENTIKO_WEB_URL).toBe("http://spawn3.com");

    // Fails if ambient leakage occurred - should NOT use ambient values
    expect(env1.MENTIKO_WEB_URL).not.toBe("http://ambient.com");
    expect(env2.MENTIKO_WEB_URL).not.toBe("http://ambient.com");
    expect(env3.MENTIKO_WEB_URL).not.toBe("http://ambient.com");

    // Each spawn should be isolated from the others
    expect(env1.MENTIKO_WEB_URL).not.toBe(env2.MENTIKO_WEB_URL);
    expect(env2.MENTIKO_WEB_URL).not.toBe(env3.MENTIKO_WEB_URL);
    expect(env1.MENTIKO_WEB_URL).not.toBe(env3.MENTIKO_WEB_URL);
  });

  it("handles partial params without cross-contamination", () => {
    // First call with some params
    const env1 = getKollabMentikoMcpServerEnv({
      webUrl: "http://first.com",
      namespaceId: "ns-first",
      orgId: "org-first",
    });

    // Second call with different params that don't overlap with first call's params
    const env2 = getKollabMentikoMcpServerEnv({
      webUrl: "http://second.com",
      inboxKey: "inbox-second",
      mcpToolScope: "scope-second",
    });

    // Verify each call has its own scoped values
    expect(env1.MENTIKO_WEB_URL).toBe("http://first.com");
    expect(env1.MENTIKO_NAMESPACE_ID).toBe("ns-first");
    expect(env1.MENTIKO_ORG_ID).toBe("org-first");

    expect(env2.MENTIKO_WEB_URL).toBe("http://second.com");
    expect(env2.MENTIKO_INBOX_KEY).toBe("inbox-second");
    expect(env2.MENTIKO_MCP_TOOL_SCOPE).toBe("scope-second");

    // Verify no cross-contamination between the two calls
    expect(env1.MENTIKO_WEB_URL).not.toBe(env2.MENTIKO_WEB_URL);

    // Second call should not have first call's specific values
    expect(env2.MENTIKO_NAMESPACE_ID).not.toBe("ns-first");
    expect(env2.MENTIKO_ORG_ID).not.toBe("org-first");

    // First call should not have second call's specific values
    expect(env1.MENTIKO_MCP_TOOL_SCOPE).not.toBe("scope-second");

    // Verify that when we pass explicit params, they override process.env
    // even when both env1 and env2 could have fallback values
    const env3 = getKollabMentikoMcpServerEnv({
      webUrl: "http://third.com",
      namespaceId: "ns-third",
    });

    expect(env3.MENTIKO_WEB_URL).toBe("http://third.com");
    expect(env3.MENTIKO_NAMESPACE_ID).toBe("ns-third");
    // Third call should not have values from previous calls
    expect(env3.MENTIKO_WEB_URL).not.toBe(env1.MENTIKO_WEB_URL);
    expect(env3.MENTIKO_WEB_URL).not.toBe(env2.MENTIKO_WEB_URL);
  });
});
