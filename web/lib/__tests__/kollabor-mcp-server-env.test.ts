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
