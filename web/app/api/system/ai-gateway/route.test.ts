/**
 * @jest-environment node
 */

import type { NextRequest } from "next/server";

jest.mock("@/lib/auth/api-auth", () => ({
  checkAuth: jest.fn(),
}));

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();

jest.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import { GET } from "@/app/api/system/ai-gateway/route";
import { checkAuth } from "@/lib/auth/api-auth";

function makeRequest(): NextRequest {
  return new Request("http://localhost/api/system/ai-gateway") as unknown as NextRequest;
}

describe("GET /api/system/ai-gateway", () => {
  const originalEnv = process.env.MENTIKO_AI_GATEWAY_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    (checkAuth as jest.Mock).mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("");
    delete process.env.MENTIKO_AI_GATEWAY_ENABLED;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.MENTIKO_AI_GATEWAY_ENABLED;
    } else {
      process.env.MENTIKO_AI_GATEWAY_ENABLED = originalEnv;
    }
  });

  it("returns 401 when auth fails", async () => {
    (checkAuth as jest.Mock).mockResolvedValue(false);
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
  });

  it("returns gatewayEnabled=false when env var is unset", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.gatewayEnabled).toBe(false);
    expect(body.data.mentikoProfileActive).toBe(false);
  });

  it("returns gatewayEnabled=true when env var is 'true'", async () => {
    process.env.MENTIKO_AI_GATEWAY_ENABLED = "true";
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.data.gatewayEnabled).toBe(true);
  });

  it("ignores non-'true' truthy values for the env var", async () => {
    process.env.MENTIKO_AI_GATEWAY_ENABLED = "1";
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.data.gatewayEnabled).toBe(false);
  });

  it("returns mentikoProfileActive=false when config.json is missing", async () => {
    mockExistsSync.mockReturnValue(false);
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.data.mentikoProfileActive).toBe(false);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns mentikoProfileActive=true when active_profile is 'mentiko'", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ kollabor: { llm: { active_profile: "mentiko" } } }),
    );
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.data.mentikoProfileActive).toBe(true);
  });

  it("returns mentikoProfileActive=false when active_profile is something else", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ kollabor: { llm: { active_profile: "anthropic" } } }),
    );
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.data.mentikoProfileActive).toBe(false);
  });

  it("returns mentikoProfileActive=false when config.json is malformed JSON", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{ not json");
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.data.mentikoProfileActive).toBe(false);
  });

  it("returns mentikoProfileActive=false when kollabor.llm is missing", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ kollabor: {} }));
    const response = await GET(makeRequest());
    const body = await response.json();
    expect(body.data.mentikoProfileActive).toBe(false);
  });
});
