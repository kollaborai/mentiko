/**
 * @jest-environment node
 */

import { createHmac } from "node:crypto";

let mockedHome: string | null = null;

jest.mock("node:os", () => {
  const actual = jest.requireActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => mockedHome ?? actual.homedir(),
  };
});

import {
  buildMentikoProfileConfig,
  ENGINE_POLL_INTERVAL_MS,
  ENGINE_WAIT_MS,
  getInternalGatewayBearer,
  registerMentikoProfile,
} from "@/lib/mentiko-engine-profile";

describe("mentiko-engine-profile", () => {
  const baseEnv = {
    MENTIKO_AI_GATEWAY_ENABLED: "true",
    BETTER_AUTH_SECRET: "test-better-auth-secret",
  };

  describe("engine wait constants", () => {
    it("waits 90 seconds with a 1 second poll interval", () => {
      expect(ENGINE_WAIT_MS).toBe(90_000);
      expect(ENGINE_POLL_INTERVAL_MS).toBe(1_000);
    });
  });

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

  describe("idempotency", () => {
    // these tests exercise registerMentikoProfile end-to-end with mocked
    // fetch + fs/promises. they pin two regressions:
    //   1. don't clobber a user-customized active_profile in ~/.kollab/config.json
    //   2. don't clobber a user-customized base_url on the existing mentiko engine profile
    let tmpDir: string;

    beforeEach(async () => {
      Object.assign(process.env, baseEnv);
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = jest.requireActual<typeof import("node:os")>("node:os");
      const path = await import("node:path");
      tmpDir = await mkdtemp(path.join(tmpdir(), "mentiko-engine-profile-"));
      mockedHome = tmpDir;
    });

    afterEach(async () => {
      mockedHome = null;
      const { rm } = await import("node:fs/promises");
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    });

    async function seedEngineToken(): Promise<void> {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      await mkdir(path.join(tmpDir, ".kollab"), { recursive: true });
      await writeFile(path.join(tmpDir, ".kollab", "engine.token"), "test-token", "utf8");
    }

    async function readKollabConfig(): Promise<{
      kollabor?: { llm?: { active_profile?: string; default_profile?: { name: string } } };
    } | null> {
      const { readFile } = await import("node:fs/promises");
      const path = await import("node:path");
      try {
        const raw = await readFile(path.join(tmpDir, ".kollab", "config.json"), "utf8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }

    async function seedKollabConfig(content: object): Promise<void> {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      await mkdir(path.join(tmpDir, ".kollab"), { recursive: true });
      await writeFile(
        path.join(tmpDir, ".kollab", "config.json"),
        JSON.stringify(content, null, 2),
        "utf8",
      );
    }

    function buildFetchMock(opts: {
      existingProfile?: { base_url?: string } | null;
      postStatus?: number;
      postBody?: string;
    } = {}): jest.Mock {
      const { existingProfile = null, postStatus = 409, postBody = "exists" } = opts;
      return jest.fn(async (url: string, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        if (url.endsWith("/health")) {
          return { ok: true, status: 200, text: async () => "ok" };
        }
        if (url.endsWith("/profiles") && method === "POST") {
          return { ok: false, status: postStatus, text: async () => postBody };
        }
        if (url.endsWith("/profiles/mentiko") && method === "GET") {
          if (!existingProfile) {
            return { ok: false, status: 404, text: async () => "not found" };
          }
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify(existingProfile),
          };
        }
        if (url.endsWith("/profiles/mentiko") && method === "PUT") {
          return { ok: true, status: 200, text: async () => "updated" };
        }
        if (url.endsWith("/profiles") && method === "POST") {
          return { ok: true, status: 201, text: async () => "created" };
        }
        throw new Error(`unmocked fetch: ${method} ${url}`);
      });
    }

    it("preserves a user-changed active_profile", async () => {
      await seedEngineToken();
      await seedKollabConfig({
        kollabor: {
          llm: {
            active_profile: "claude-sonnet",
            default_profile: { name: "claude-sonnet", level: "global" },
          },
        },
      });
      const fetchMock = buildFetchMock({
        postStatus: 201,
        postBody: "created",
      });
      // override POST to succeed (fresh profile creation)
      fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        if (url.endsWith("/health")) return { ok: true, status: 200, text: async () => "ok" };
        if (url.endsWith("/profiles") && method === "POST") {
          return { ok: true, status: 201, text: async () => "created" };
        }
        throw new Error(`unmocked: ${method} ${url}`);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await registerMentikoProfile();
      expect(result).toBe(true);

      const config = await readKollabConfig();
      expect(config?.kollabor?.llm?.active_profile).toBe("claude-sonnet");
      expect(config?.kollabor?.llm?.default_profile?.name).toBe("claude-sonnet");
    });

    it("preserves an existing customized mentiko base_url (skips PUT)", async () => {
      await seedEngineToken();
      const fetchMock = buildFetchMock({
        existingProfile: { base_url: "https://api.featherless.ai/v1" },
        postStatus: 409,
        postBody: "exists",
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await registerMentikoProfile();
      expect(result).toBe(true);

      const calls = fetchMock.mock.calls.map((c) => `${c[1]?.method ?? "GET"} ${c[0]}`);
      const putCalls = calls.filter((c) => c.startsWith("PUT "));
      expect(putCalls).toEqual([]);
    });

    it("PUTs to refresh when existing profile still has default base_url", async () => {
      await seedEngineToken();
      const fetchMock = buildFetchMock({
        existingProfile: { base_url: "http://127.0.0.1:3000/api/ai-gateway/local/v1" },
        postStatus: 409,
        postBody: "exists",
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await registerMentikoProfile();
      expect(result).toBe(true);

      const calls = fetchMock.mock.calls.map((c) => `${c[1]?.method ?? "GET"} ${c[0]}`);
      const putCalls = calls.filter((c) => c.startsWith("PUT "));
      expect(putCalls).toHaveLength(1);
    });

    it("creates active_profile when config.json is missing", async () => {
      await seedEngineToken();
      const fetchMock = buildFetchMock();
      fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        if (url.endsWith("/health")) return { ok: true, status: 200, text: async () => "ok" };
        if (url.endsWith("/profiles") && method === "POST") {
          return { ok: true, status: 201, text: async () => "created" };
        }
        throw new Error(`unmocked: ${method} ${url}`);
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await registerMentikoProfile();
      expect(result).toBe(true);

      const config = await readKollabConfig();
      expect(config?.kollabor?.llm?.active_profile).toBe("mentiko");
    });
  });
});
