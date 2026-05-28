/**
 * @jest-environment node
 */

import type { NextRequest } from "next/server";

jest.mock("@/lib/api-auth", () => ({
  checkAuth: jest.fn(),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn(async () => "default"),
  getOrgIdFromRequest: jest.fn(async () => "default"),
}));

const mockCreateProfile = jest.fn();
const mockListProfiles = jest.fn();
const mockUpdateProfile = jest.fn();

jest.mock("@/lib/agent-profile-storage", () => ({
  createProfile: (...args: unknown[]) => mockCreateProfile(...args),
  listProfiles: (...args: unknown[]) => mockListProfiles(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

import { POST } from "./route";
import { checkAuth } from "@/lib/api-auth";

function makeRequest(provider: string): NextRequest {
  return new Request("http://localhost/api/agent-profiles/install-bundle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider }),
  }) as unknown as NextRequest;
}

describe("POST /api/agent-profiles/install-bundle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (checkAuth as jest.Mock).mockResolvedValue(true);
  });

  it("sets the preferred advisor profile when no advisor default exists", async () => {
    mockListProfiles.mockReturnValue([]);

    const response = await POST(makeRequest("kollab"));

    expect(response.status).toBe(200);
    expect(mockCreateProfile).toHaveBeenCalledWith(
      "default",
      "default",
      expect.objectContaining({
        id: "kollab",
        isAdvisorDefault: true,
      }),
    );
  });

  it("does not overwrite an existing advisor default when installing a bundle", async () => {
    mockListProfiles.mockReturnValue([
      {
        id: "codex-default",
        isDefault: true,
        isAdvisorDefault: true,
      },
    ]);

    const response = await POST(makeRequest("kollab"));

    expect(response.status).toBe(200);
    expect(mockCreateProfile).toHaveBeenCalledWith(
      "default",
      "default",
      expect.objectContaining({
        id: "kollab",
        isAdvisorDefault: false,
      }),
    );
  });
});
