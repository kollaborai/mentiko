/**
 * @jest-environment node
 */

import {
  buildTenantAiGatewayRequest,
  canonicalizeTenantAiGatewayRequest,
  getTenantAiGatewayConfig,
  invokeTenantAiGatewayChatCompletions,
} from "@/lib/ai-gateway/client";

const config = {
  gatewayUrl: "https://ai.mentiko.com/v1",
  token: "mtk_ai_test_token",
  tokenId: "tok_test_token",
  tenantId: "550e8400-e29b-41d4-a716-446655440000",
};

describe("tenant AI gateway client", () => {
  it("builds the signed control-plane gateway request without provider keys", () => {
    const body = JSON.stringify({
      model: "glm-5.1",
      messages: [{ role: "user", content: "hi" }],
    });

    const request = buildTenantAiGatewayRequest({
      endpoint: "chat/completions",
      body,
      config,
      now: new Date("2026-05-21T09:00:00.000Z"),
      nonce: "nonce-123",
    });

    expect(request.url).toBe("https://ai.mentiko.com/v1/chat/completions");
    expect(request.headers.authorization).toBe(`Bearer ${config.token}`);
    expect(request.headers["x-mentiko-ai-token-id"]).toBe(config.tokenId);
    expect(request.headers).not.toHaveProperty("OPENAI_API_KEY");
    expect(request.headers).not.toHaveProperty("GLM_TOKEN");

    expect(request.headers["x-mentiko-ai-signature"]).toBe(
      "3c52e47042892e7dfcd1b978f286d4862d7e3e6706e12d39682e49727825a4b4",
    );
  });

  it("returns null unless the tenant has the full gateway env", () => {
    expect(getTenantAiGatewayConfig({
      MENTIKO_AI_GATEWAY_ENABLED: "true",
      MENTIKO_AI_GATEWAY_URL: config.gatewayUrl,
      MENTIKO_AI_GATEWAY_TOKEN: config.token,
      TENANT_ID: config.tenantId,
    })).toBeNull();

    expect(getTenantAiGatewayConfig({
      MENTIKO_AI_GATEWAY_ENABLED: "true",
      MENTIKO_AI_GATEWAY_URL: config.gatewayUrl,
      MENTIKO_AI_GATEWAY_TOKEN: config.token,
      MENTIKO_AI_GATEWAY_TOKEN_ID: config.tokenId,
      TENANT_ID: config.tenantId,
      MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN: "https://ai.mentiko.com",
    })).toEqual(config);
  });

  it("rejects tenant gateway URLs that can leak the token off-origin", () => {
    expect(getTenantAiGatewayConfig({
      MENTIKO_AI_GATEWAY_ENABLED: "true",
      MENTIKO_AI_GATEWAY_URL: "https://evil.example/v1",
      MENTIKO_AI_GATEWAY_TOKEN: config.token,
      MENTIKO_AI_GATEWAY_TOKEN_ID: config.tokenId,
      TENANT_ID: config.tenantId,
      MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN: "https://ai.mentiko.com",
    })).toBeNull();

    expect(getTenantAiGatewayConfig({
      MENTIKO_AI_GATEWAY_ENABLED: "true",
      MENTIKO_AI_GATEWAY_URL: "https://ai.mentiko.com/v1?steal=true",
      MENTIKO_AI_GATEWAY_TOKEN: config.token,
      MENTIKO_AI_GATEWAY_TOKEN_ID: config.tokenId,
      TENANT_ID: config.tenantId,
      MENTIKO_AI_GATEWAY_ALLOWED_ORIGIN: "https://ai.mentiko.com",
    })).toBeNull();
  });

  it("posts chat completions through the signed gateway request", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response("{}"));

    await invokeTenantAiGatewayChatCompletions({
      model: "glm-5.1",
      messages: [{ role: "user", content: "hi" }],
    }, {
      config,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ai.mentiko.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: `Bearer ${config.token}`,
          "x-mentiko-ai-tenant-id": config.tenantId,
          "x-mentiko-ai-token-id": config.tokenId,
        }),
      }),
    );
  });

  it("keeps canonicalization compatible with the external gateway route", () => {
    const canonical = canonicalizeTenantAiGatewayRequest({
      method: "POST",
      path: "/v1/chat/completions",
      tenantId: config.tenantId,
      tokenId: config.tokenId,
      timestamp: "2026-05-21T09:00:00.000Z",
      nonce: "nonce-123",
      body: "{}",
    });

    expect(canonical).toContain("POST\n/v1/chat/completions");
    expect(canonical).toContain(`\n${config.tenantId}\n${config.tokenId}\n`);
    expect(canonical).not.toContain("mtk_ai_test_token");
  });
});
