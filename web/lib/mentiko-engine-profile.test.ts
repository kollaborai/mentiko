/**
 * @jest-environment node
 */

import { createHmac } from "node:crypto";

import {
  buildMentikoProfileConfig,
  getInternalGatewayBearer,
  registerMentikoProfile,
} from "@/lib/mentiko-engine-profile";

describe("mentiko-engine-profile", () => {
  const baseEnv = {
    MENTIKO_AI_GATEWAY_ENABLED: "true",
    BETTER_AUTH_SECRET: "test-better-auth-secret",
  };

  describe("buildMentikoProfileConfig", () => {
    it("returns null when gateway is not enabled", () => {
      expect(
        buildMentikoProfileConfig({
          BETTER_AUTH_SECRET: "anything",
        }),
      ).toBeNull();

      expect(
        buildMentikoProfileConfig({
          MENTIKO_AI_GATEWAY_ENABLED: "false",
          BETTER_AUTH_SECRET: "anything",
        }),
      ).toBeNull();
    });

    it("returns the expected shape when enabled", () => {
      const expectedKey = createHmac("sha256", baseEnv.BETTER_AUTH_SECRET)
        .update("mentiko-internal-api:ai-gateway-local-proxy", "utf8")
        .digest("hex");

      expect(buildMentikoProfileConfig(baseEnv)).toEqual({
        name: "mentiko",
        provider: "openai",
        model: "glm-5.1",
        base_url: "http://127.0.0.1:3000/api/ai-gateway/local/v1",
        api_key: expectedKey,
        description: "Mentiko AI gateway (included AI)",
      });
    });

    it("returns null when BETTER_AUTH_SECRET is missing", () => {
      expect(
        buildMentikoProfileConfig({
          MENTIKO_AI_GATEWAY_ENABLED: "true",
        }),
      ).toBeNull();
    });
  });

  describe("getInternalGatewayBearer", () => {
    it("matches HMAC-SHA256(secret, 'mentiko-internal-api:ai-gateway-local-proxy') hex", () => {
      const secret = "the-tenant-better-auth-secret";
      const expected = createHmac("sha256", secret)
        .update("mentiko-internal-api:ai-gateway-local-proxy", "utf8")
        .digest("hex");

      expect(getInternalGatewayBearer({ BETTER_AUTH_SECRET: secret })).toBe(expected);
    });

    it("throws when no root secret is set", () => {
      expect(() => getInternalGatewayBearer({})).toThrow();
    });
  });

  describe("registerMentikoProfile", () => {
    const originalEnv = { ...process.env };
    const originalFetch = global.fetch;

    afterEach(() => {
      process.env = { ...originalEnv };
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    });

    it("is a no-op when gateway is not enabled", async () => {
      delete process.env.MENTIKO_AI_GATEWAY_ENABLED;
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      const result = await registerMentikoProfile();

      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
