/**
 * @jest-environment node
 */

const mockEnforceGuestWrites = jest.fn();
jest.mock("@/lib/middleware", () => ({
  enforceGuestWrites: (...args: unknown[]) => mockEnforceGuestWrites(...args),
}));

const mockRequirePermission = jest.fn();
jest.mock("@/lib/auth/rbac-auth", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

jest.mock("@/lib/namespace-config", () => ({
  getNamespaceIdFromRequest: jest.fn().mockResolvedValue("default"),
  getOrgIdFromRequest: jest.fn().mockResolvedValue("default"),
}));

const mockStartChainRun = jest.fn();
jest.mock("@/lib/runs/chain-run-service", () => ({
  startChainRun: (...args: unknown[]) => mockStartChainRun(...args),
}));

import { ValidationError } from "@/lib/api-errors";
import { POST } from "./route";

describe("POST /api/chains/run", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnforceGuestWrites.mockResolvedValue(null);
    mockRequirePermission.mockResolvedValue(null);
  });

  it("returns typed 422 details when the resolved generated chain violates its runtime contract", async () => {
    const errors = [
      "agents[0] violates TASK_LINKED_CHAIN_RUNTIME: in-run agents execute after admission",
    ];
    mockStartChainRun.mockRejectedValue(new ValidationError(
      "Invalid generated chain delivery contract",
      { errors },
    ));

    const request = new Request("http://localhost:3000/api/chains/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain: { name: "generated-chain" } }),
    });
    const response = await POST(request as never, { params: Promise.resolve({}) });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid generated chain delivery contract",
        details: { errors },
      },
    });
    expect(mockStartChainRun).toHaveBeenCalledWith(expect.objectContaining({
      namespaceId: "default",
      orgId: "default",
      body: { chain: { name: "generated-chain" } },
    }));
  });
});
