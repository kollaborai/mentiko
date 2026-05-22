/**
 * @jest-environment node
 */

describe("ai-gateway-agent-env.mjs", () => {
  async function loadModule() {
    return import(new URL("../../lib/ai-gateway-agent-env.mjs", import.meta.url).href);
  }

  it("strips inherited provider credentials and applies the local proxy", async () => {
    const { buildAiGatewayAgentEnv } = await loadModule();
    const env = buildAiGatewayAgentEnv(
      {
        PATH: "/bin",
        OPENAI_API_KEY: "server-openai",
        GLM_TOKEN: "server-glm",
        MENTIKO_AI_GATEWAY_LOCAL_TOKEN: "control-token",
      },
      {},
      {
        MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
        MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:3000/api/ai-gateway/local/v1",
        MENTIKO_AI_GATEWAY_LOCAL_TOKEN: "local-proxy-token",
      },
    );

    expect(env.OPENAI_API_KEY).toBe("local-proxy-token");
    expect(env.OPENAI_BASE_URL).toBe("http://127.0.0.1:3000/api/ai-gateway/local/v1");
    expect(env.OPENAI_API_BASE).toBe("http://127.0.0.1:3000/api/ai-gateway/local/v1");
    expect(env.GLM_TOKEN).toBeUndefined();
    expect(env.MENTIKO_AI_GATEWAY_LOCAL_TOKEN).toBeUndefined();
    expect(env.MENTIKO_AI_GATEWAY_PROXY).toBe("local");
  });

  it("keeps explicit profile provider credentials ahead of the local proxy", async () => {
    const { buildAiGatewayAgentEnv } = await loadModule();
    const env = buildAiGatewayAgentEnv(
      { PATH: "/bin", OPENAI_API_KEY: "server-openai" },
      { OPENAI_API_KEY: "profile-openai" },
      {
        MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
        MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:3000/api/ai-gateway/local/v1",
        MENTIKO_AI_GATEWAY_LOCAL_TOKEN: "local-proxy-token",
      },
    );

    expect(env.OPENAI_API_KEY).toBe("profile-openai");
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.MENTIKO_AI_GATEWAY_PROXY).toBeUndefined();
  });

  it("blanks denied inherited keys for pty-manager merge semantics", async () => {
    const { buildPtyAiGatewayAgentEnv } = await loadModule();
    const env = buildPtyAiGatewayAgentEnv(
      { PATH: "/bin" },
      {},
      {
        MENTIKO_AI_GATEWAY_LOCAL_PROXY_ENABLED: "true",
        MENTIKO_AI_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:3000/api/ai-gateway/local/v1",
        MENTIKO_AI_GATEWAY_LOCAL_TOKEN: "local-proxy-token",
      },
    );

    expect(env.GLM_TOKEN).toBe("");
    expect(env.MENTIKO_AI_GATEWAY_LOCAL_TOKEN).toBe("");
    expect(env.OPENAI_API_KEY).toBe("local-proxy-token");
  });
});
