jest.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    _body: unknown;
    headers: Headers;
    constructor(body?: unknown, init?: { status?: number; headers?: Headers }) {
      this.status = init?.status ?? 200;
      this._body = body;
      this.headers = init?.headers ?? new Headers();
    }
    async json() { return this._body; }
    async text() { return typeof this._body === "string" ? this._body : JSON.stringify(this._body); }
    static json(body: unknown, init?: { status?: number; headers?: Headers }) {
      return new MockNextResponse(body, init);
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock("fs/promises", () => ({
  readFile: jest.fn(),
}));

jest.mock("@/lib/api-auth", () => ({
  checkAuth: jest.fn(),
}));

jest.mock("@/lib/auth-bridge", () => ({
  getSessionUser: jest.fn(),
}));

jest.mock("@/lib/session-token", () => ({
  mintSessionToken: jest.fn(),
}));

import { readFile } from "fs/promises";
import { POST } from "./route";
import { checkAuth } from "@/lib/api-auth";
import { getSessionUser } from "@/lib/auth-bridge";
import { mintSessionToken } from "@/lib/session-token";

function makePostRequest(body: Record<string, unknown>) {
  return {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    nextUrl: { search: "" },
    arrayBuffer: async () => {
      const bytes = Buffer.from(JSON.stringify(body));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  } as never;
}

describe("/api/kollabor/engine/[...path]", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ session_id: "sess-created" }),
    });
    (checkAuth as jest.Mock).mockResolvedValue(true);
    (readFile as jest.Mock).mockResolvedValue("engine-token");
    (getSessionUser as jest.Mock).mockResolvedValue({
      id: "user-1",
      namespaceId: "default",
      orgId: "default",
      role: "owner",
    });
  });

  test("does not create a mentiko MCP session when the web session token cannot be minted", async () => {
    (mintSessionToken as jest.Mock).mockRejectedValue(new Error("BETTER_AUTH_SECRET missing"));

    const res = await POST(
      makePostRequest({
        profile: "mentiko",
        agent: "mentiko",
        mcp_servers: ["mentiko"],
      }),
      { params: Promise.resolve({ path: ["sessions"] }) },
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "session token unavailable: BETTER_AUTH_SECRET missing",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
