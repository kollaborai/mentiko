jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    constructor(body?: unknown, init?: { status?: number }) {
      this.status = init?.status ?? 200;
      this._body = body;
    }
    async json() { return this._body; }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: jest.fn(),
}));

jest.mock("@/lib/agents/mentiko-engine-profile", () => ({
  registerMentikoProfile: jest.fn(),
}));

import { readFile, writeFile } from "fs/promises";
import { POST } from "./route";
import { checkAuth } from "@/lib/auth/api-auth";

function makeRequest(body?: Record<string, unknown>) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body ?? {},
  } as never;
}

describe("/api/kollabor/profiles/active", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn();
    (checkAuth as jest.Mock).mockResolvedValue(true);
    (readFile as jest.Mock).mockImplementation((path: string) => {
      if (path.endsWith("engine.token")) return Promise.resolve("engine-token");
      return Promise.resolve(JSON.stringify({ kollabor: { llm: { profiles: {} } } }));
    });
  });

  test("rejects active profiles that are not present in the engine profile list", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        active: "glm",
        profiles: [
          { name: "glm", supports_tools: true },
        ],
      }),
    });

    const res = await POST(makeRequest({ name: "missing-profile" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "profile not found: missing-profile",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  test("rejects profiles that cannot run tools", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        active: "weak",
        profiles: [
          { name: "weak", supports_tools: false },
        ],
      }),
    });

    const res = await POST(makeRequest({ name: "weak" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "profile cannot run Mentiko tools: weak",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  describe("GET lazy retry", () => {
    // each test re-imports the route module to reset the module-level
    // lazyRetryAttempted guard. jest.isolateModulesAsync re-runs the
    // jest.mock factory for @/lib/mentiko-engine-profile too, so we
    // also re-import the mock and bind to it inside the same isolation.
    type GetFn = (req: never) => Promise<{ status: number; json: () => Promise<unknown> }>;

    async function loadGet(): Promise<{ GET: GetFn; mockRegister: jest.Mock }> {
      let GET: GetFn | undefined;
      let mockRegister: jest.Mock | undefined;
      await jest.isolateModulesAsync(async () => {
        const routeMod = (await import("./route")) as unknown as { GET: GetFn };
        const engineMod = (await import("@/lib/agents/mentiko-engine-profile")) as unknown as {
          registerMentikoProfile: jest.Mock;
        };
        GET = routeMod.GET;
        mockRegister = engineMod.registerMentikoProfile;
      });
      if (!GET || !mockRegister) throw new Error("failed to load route module");
      return { GET, mockRegister };
    }

    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = { ...originalEnv };
    });

    test("retry fires when gateway enabled and active is not mentiko", async () => {
      process.env.MENTIKO_AI_GATEWAY_ENABLED = "true";
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          active: "glm",
          profiles: [{ name: "glm", supports_tools: true }],
        }),
      });

      const { GET, mockRegister } = await loadGet();
      mockRegister.mockResolvedValue(true);
      const res = await GET(makeRequest());

      expect(res.status).toBe(200);
      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    test("retry does not fire on second call after first success", async () => {
      process.env.MENTIKO_AI_GATEWAY_ENABLED = "true";
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          active: "glm",
          profiles: [{ name: "glm", supports_tools: true }],
        }),
      });

      const { GET, mockRegister } = await loadGet();
      mockRegister.mockResolvedValue(true);
      await GET(makeRequest());
      await GET(makeRequest());

      expect(mockRegister).toHaveBeenCalledTimes(1);
    });

    test("retry does not fire when gateway disabled", async () => {
      delete process.env.MENTIKO_AI_GATEWAY_ENABLED;
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          active: "glm",
          profiles: [{ name: "glm", supports_tools: true }],
        }),
      });

      const { GET, mockRegister } = await loadGet();
      const res = await GET(makeRequest());

      expect(res.status).toBe(200);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    test("guard stays false when registerMentikoProfile returns false, so a later GET retries", async () => {
      process.env.MENTIKO_AI_GATEWAY_ENABLED = "true";
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          active: "glm",
          profiles: [{ name: "glm", supports_tools: true }],
        }),
      });
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const { GET, mockRegister } = await loadGet();
      mockRegister.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await GET(makeRequest());
      await GET(makeRequest());

      expect(mockRegister).toHaveBeenCalledTimes(2);
      warnSpy.mockRestore();
    });

    test("retry that throws is swallowed and logged, guard stays false", async () => {
      process.env.MENTIKO_AI_GATEWAY_ENABLED = "true";
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          active: "glm",
          profiles: [{ name: "glm", supports_tools: true }],
        }),
      });
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

      const { GET, mockRegister } = await loadGet();
      mockRegister
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(true);
      const res1 = await GET(makeRequest());
      const res2 = await GET(makeRequest());

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(mockRegister).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[mentiko-profile] lazy retry failed: boom"),
      );

      warnSpy.mockRestore();
    });
  });
});
