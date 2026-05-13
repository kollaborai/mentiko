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

jest.mock("@/lib/api-auth", () => ({
  checkAuth: jest.fn(),
}));

import { readFile, writeFile } from "fs/promises";
import { POST } from "./route";
import { checkAuth } from "@/lib/api-auth";

function makeRequest(body: Record<string, unknown>) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
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
});
